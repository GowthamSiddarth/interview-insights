import { ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { ModerationService } from '../moderation/moderation.service';

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationService: ModerationService,
  ) {}

  // GitHub issue #369 (Phase 35) — company creation now goes through
  // moderation, same as every other write path in this app (CLAUDE.md
  // hard constraint #2): the row is created with status: pending (the
  // schema default) and enqueued, rather than indexed to OpenSearch
  // immediately. Indexing happens at approval time instead (see
  // ModerationService.review()'s 'company' case).
  //
  // GitHub issue #696 (Phase 50, D104) — candidateId is now attributed
  // (#146's "every write path derives candidateId from the session, never
  // the body" convention, same as every other create() in this app), and
  // the pending-duplicate pre-check uses findFirst() scoped to
  // status: 'pending' rather than findUnique({ where: { slug } }) — slug
  // is no longer a schema-level @unique field (see Company.slug's own
  // comment: the real constraint is now a partial unique index, only
  // pending/approved rows are constrained). An *approved* duplicate still
  // falls through to that real constraint's 409; a *rejected* one no
  // longer collides at all — the whole point of this issue. candidateId
  // is optional here (never for the real HTTP endpoint, which always has
  // an authenticated caller) only because seed-demo-data.ts creates
  // companies ahead of any candidate existing in its own generation loop
  // — the same "seed/admin-created company has no requester" case
  // Company.candidateId's own schema comment already anticipates.
  async create(dto: CreateCompanyDto, candidateId?: string) {
    const pendingDuplicate = await this.prisma.company.findFirst({
      where: { slug: dto.slug, status: 'pending' },
    });
    if (pendingDuplicate) {
      throw new ConflictException(
        'This company has already been requested and is pending review — please check back later.',
      );
    }

    // GitHub issue #789 (Phase 53, D12) — the write and its moderation
    // enqueue must commit or fail together, same as every other write
    // path (and this method's own update() three lines below) — a crash
    // between two separate calls used to leave a company permanently
    // stuck at status: pending with no moderation_queue entry: invisible,
    // unapprovable, and not caught by the existing orphan self-heal
    // (which only cleans up the reverse case).
    const company = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { ...dto, candidateId } });
      await this.moderationService.enqueue('company', company.id, tx);
      return company;
    });
    // GitHub issue #370 — after commit, best-effort, same D16/D17 shape.
    await this.moderationService.indexForSearch('company', company.id);
    // GitHub issue #698 (Phase 50, D104) — domain event, after commit,
    // same best-effort shape as every other write path's own call. A
    // no-op inside ModerationService itself when candidateId is
    // undefined (a seed/admin-created company) — nothing to notify.
    await this.moderationService.publishCreatedEvent('company', company.id);
    return company;
  }

  // GitHub issue #697 (Phase 50, D104) — same reset-to-pending +
  // reenqueue() shape as RoundRatingsService.update(), with one
  // deliberate difference: an *approved* company can't be edited back to
  // a draft state through this endpoint at all (a 403, same as the
  // ownership check below) — companies are public/canonical once
  // approved, unlike a rating/review, where the candidate's own content
  // can always be revised. Only the requesting candidate may edit at any
  // status short of that; a non-owner (or an unattributed, e.g.
  // seed/admin-created, company with no candidateId at all) always gets
  // the same 403.
  async update(id: string, candidateId: string, dto: UpdateCompanyDto) {
    const company = await this.prisma.company.findFirstOrThrow({ where: { id } });
    if (company.candidateId !== candidateId) {
      throw new ForbiddenException('You can only edit your own company request.');
    }
    if (company.status === 'approved') {
      throw new ForbiddenException('An approved company can no longer be edited.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.company.update({
        where: { id },
        data: { ...dto, status: 'pending' },
      });
      await this.moderationService.reenqueue('company', id, tx);
      return updated;
    });
    // GitHub issue #370 — same after-commit, best-effort shape as
    // create()'s own call.
    await this.moderationService.indexForSearch('company', id);
    // No publishCreatedEvent() call here — 'company' is out of scope for
    // #692's resubmission-ack event too, same as it already was for
    // publishCreatedEvent()'s original create()-time call (never one of
    // the three "moderated entity types" #331/#332 were scoped to).
    return updated;
  }

  // GitHub issue #822 (Phase 57) — this ran an unbounded query, the same
  // shape #415 already fixed for the sibling findTop() below after a
  // live complaint. Paginated the same way findApprovedReviews() already
  // is; the one real consumer today (the moderation queue's company
  // filter dropdown) requests a large-enough pageSize to still see
  // "effectively all of them" in one call.
  async findAll(page = 1, pageSize = 200) {
    const where = { status: 'approved' } as const;
    const [items, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.company.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  // GitHub issue #415 — backs the landing page's quick-select company
  // grid, which used to render every approved company (findAll(), no
  // cap) — a real problem flagged directly against the live app once the
  // company list grew past a screenful. Random selection is a deliberate
  // placeholder, not a final ranking: there's no volume/popularity signal
  // on Company yet to rank by (see docs/DECISIONS.md D68), so an unbiased
  // random sample is the honest choice until one exists. Shuffles in
  // application code rather than `ORDER BY RANDOM()` — same "fine at
  // today's volume" full-table-scan tradeoff findAll()/
  // findApprovedReviews() already accept below.
  async findTop(limit = 5) {
    const approved = await this.prisma.company.findMany({ where: { status: 'approved' } });
    return this.shuffle(approved).slice(0, limit);
  }

  // Fisher-Yates, in place — used only by findTop() above.
  private shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  findOne(id: string) {
    return this.prisma.company.findFirstOrThrow({ where: { id, status: 'approved' } });
  }

  // Profile pages are addressed by slug (unique since Phase 1), not UUID.
  // A pending/rejected company doesn't publicly exist yet — 404, not the
  // real row, so its existence isn't leaked before approval.
  findBySlug(slug: string) {
    return this.prisma.company.findFirstOrThrow({ where: { slug, status: 'approved' } });
  }

  // A company's approved round ratings, grouped by their InterviewProcess
  // ("submission") — GitHub issue #347: a candidate's own multi-round loop
  // was previously listed as one flat row per round, inflating the visible
  // review count and repeating the same role-title context per row (the
  // same flat-list problem Phase 29 issue #315 already fixed for the
  // moderation queue). `total`/`page`/`pageSize` describe submissions, not
  // raw rows, so a submission's rounds are never split across a page
  // boundary. Reads Postgres, not OpenSearch — the search index is
  // derived/best-effort (D16/D17) and can silently miss documents; a
  // profile page listing a company's reviews is a source-of-truth read,
  // not a search. Never includes candidateId or any interviewer identity
  // (hard constraint #1).
  //
  // GitHub issue #824 (Phase 57) — every approved rating for the company
  // is loaded and grouped in application memory before the requested page
  // is sliced off, so a popular company pays the full query/serialization/
  // grouping cost on every page, not just page 1 — an acknowledged
  // tradeoff, deliberately not fixed here. Pushing LIMIT/OFFSET to
  // Postgres directly isn't a small change: the grouping is by process,
  // not by row (same reasoning #315 already established for the
  // moderation queue), so a naive row-level LIMIT/OFFSET would risk
  // splitting one submission's rounds across a page boundary — the exact
  // bug #347 fixed. Correctly fixing this needs either a window-function
  // query (rank groups, then filter) or a precomputed materialized view
  // like the aggregation layer already uses elsewhere — both real,
  // separate pieces of work. Revisit once a specific company's review
  // volume makes this measurably slow, per this file's own established
  // "fine at today's volume" precedent (see findAll()/findTop() above).
  async findApprovedReviews(companyId: string, page: number, pageSize: number) {
    // 404 (not an empty page) for a company that doesn't exist or isn't
    // approved yet — a pending/rejected company's reviews endpoint must
    // never leak that the company exists at all.
    await this.prisma.company.findFirstOrThrow({ where: { id: companyId, status: 'approved' } });

    // Grouped in application code, same pattern as ModerationService's
    // Map-keyed grouping (#315) and D13's accepted full-table-scan
    // tradeoff — fine at today's volume, revisit if a company's review
    // count ever makes this measurably slow.
    const ratings = await this.prisma.roundRating.findMany({
      where: { status: 'approved', round: { process: { companyId } } },
      orderBy: { createdAt: 'desc' },
      include: {
        round: {
          select: {
            title: true,
            roundType: true,
            processId: true,
            process: { select: { roleTitle: true } },
          },
        },
      },
    });

    const groupsByProcess = new Map<
      string,
      { processId: string; roleTitle: string; entries: unknown[] }
    >();
    for (const r of ratings) {
      const processId = r.round.processId;
      let group = groupsByProcess.get(processId);
      if (!group) {
        group = { processId, roleTitle: r.round.process.roleTitle, entries: [] };
        groupsByProcess.set(processId, group);
      }
      group.entries.push({
        id: r.id,
        createdAt: r.createdAt,
        roundTitle: r.round.title,
        roundType: r.round.roundType,
        difficulty: r.difficulty,
        fluency: r.fluency,
        clarity: r.clarity,
        focus: r.focus,
        technicalDepth: r.technicalDepth,
        freeText: r.freeText,
      });
    }

    // `ratings` is already createdAt-desc and Map preserves insertion
    // order, so groups are already ordered by their most-recent rating.
    const groups = Array.from(groupsByProcess.values());
    const total = groups.length;
    const items = groups.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

    return { total, page, pageSize, items };
  }
}

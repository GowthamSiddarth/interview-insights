import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
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
  async create(dto: CreateCompanyDto) {
    // A friendlier response for the specific case of a duplicate slug
    // that's already pending review — direct user feedback. An existing
    // *approved* row still falls through to the generic unique-constraint
    // 409 below (the company genuinely already exists); a *rejected* row
    // does too for now (unresolved, see the issue's own note).
    const existing = await this.prisma.company.findUnique({ where: { slug: dto.slug } });
    if (existing?.status === 'pending') {
      throw new ConflictException(
        'This company has already been requested and is pending review — please check back later.',
      );
    }

    const company = await this.prisma.company.create({ data: dto });
    await this.moderationService.enqueue('company', company.id);
    // GitHub issue #370 — after commit, best-effort, same D16/D17 shape.
    await this.moderationService.indexForSearch('company', company.id);
    return company;
  }

  findAll() {
    return this.prisma.company.findMany({
      where: { status: 'approved' },
      orderBy: { createdAt: 'desc' },
    });
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

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { CompanySearchService } from '../search/company-search.service';

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companySearchService: CompanySearchService,
  ) {}

  async create(dto: CreateCompanyDto) {
    const company = await this.prisma.company.create({ data: dto });

    // Best-effort, in-process (docs/DECISIONS.md D16): Postgres is the
    // source of truth for companies, OpenSearch is a derived index. A
    // transient search-indexing failure must never fail the underlying
    // company write.
    try {
      await this.companySearchService.indexCompany(company);
    } catch (err) {
      this.logger.error('Failed to index company in OpenSearch', err instanceof Error ? err.stack : err);
    }

    return company;
  }

  findAll() {
    return this.prisma.company.findMany({ orderBy: { createdAt: 'desc' } });
  }

  findOne(id: string) {
    return this.prisma.company.findUniqueOrThrow({ where: { id } });
  }

  // Profile pages are addressed by slug (unique since Phase 1), not UUID.
  findBySlug(slug: string) {
    return this.prisma.company.findUniqueOrThrow({ where: { slug } });
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
    // 404 (not an empty page) for a company that doesn't exist.
    await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });

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

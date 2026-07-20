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

  // A company's approved round ratings, shaped for public display. Reads
  // Postgres, not OpenSearch — the search index is derived/best-effort
  // (D16/D17) and can silently miss documents; a profile page listing a
  // company's reviews is a source-of-truth read, not a search. Never
  // includes candidateId or any interviewer identity (hard constraint #1).
  async findApprovedReviews(companyId: string, page: number, pageSize: number) {
    // 404 (not an empty page) for a company that doesn't exist.
    await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });

    const where = {
      status: 'approved' as const,
      round: { process: { companyId } },
    };
    const [total, ratings] = await Promise.all([
      this.prisma.roundRating.count({ where }),
      this.prisma.roundRating.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          round: {
            select: { title: true, roundType: true, process: { select: { roleTitle: true } } },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: ratings.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        roundTitle: r.round.title,
        roundType: r.round.roundType,
        roleTitle: r.round.process.roleTitle,
        difficulty: r.difficulty,
        fairness: r.fairness,
        communicationFluency: r.communicationFluency,
        attentiveness: r.attentiveness,
        biasSignal: r.biasSignal,
        technicalDepth: r.technicalDepth,
        freeText: r.freeText,
      })),
    };
  }
}

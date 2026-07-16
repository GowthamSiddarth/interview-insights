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
}

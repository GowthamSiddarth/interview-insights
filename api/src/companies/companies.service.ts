import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCompanyDto) {
    return this.prisma.company.create({ data: dto });
  }

  findAll() {
    return this.prisma.company.findMany({ orderBy: { createdAt: 'desc' } });
  }

  findOne(id: string) {
    return this.prisma.company.findUniqueOrThrow({ where: { id } });
  }
}

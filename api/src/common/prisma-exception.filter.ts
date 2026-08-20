import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

// Translates Prisma's known request errors into the HTTP responses callers
// expect, so every service doesn't have to duplicate this mapping.
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const mapped = this.mapException(exception);
    const response = host.switchToHttp().getResponse<Response>();
    response.status(mapped.getStatus()).json(mapped.getResponse());
  }

  private mapException(exception: Prisma.PrismaClientKnownRequestError) {
    switch (exception.code) {
      case 'P2002': {
        // GitHub issue #826 (Phase 57) — target is the raw Postgres/Prisma
        // constraint or column name (e.g. "companies_slug_pending_approved_key"),
        // an internal implementation detail, not something a caller should
        // ever see verbatim. Logged server-side for debugging; the
        // client-facing message stays fixed and generic rather than
        // trying to maintain an allow-list mapping every current (and
        // future) constraint to a friendly field name.
        const target = (exception.meta?.target as string[] | undefined)?.join(', ');
        if (target) {
          this.logger.debug(`P2002 unique constraint violated: ${target}`);
        }
        return new ConflictException('A record with these values already exists.');
      }
      case 'P2003':
        return new UnprocessableEntityException(
          'One or more referenced records do not exist.',
        );
      case 'P2025':
        return new NotFoundException('Record not found.');
      default:
        throw exception;
    }
  }
}

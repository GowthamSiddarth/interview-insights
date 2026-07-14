import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

// Translates Prisma's known request errors into the HTTP responses callers
// expect, so every service doesn't have to duplicate this mapping.
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const mapped = this.mapException(exception);
    const response = host.switchToHttp().getResponse<Response>();
    response.status(mapped.getStatus()).json(mapped.getResponse());
  }

  private mapException(exception: Prisma.PrismaClientKnownRequestError) {
    switch (exception.code) {
      case 'P2002': {
        const target = (exception.meta?.target as string[] | undefined)?.join(', ');
        return new ConflictException(
          target
            ? `A record with this ${target} already exists.`
            : 'A record with these values already exists.',
        );
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

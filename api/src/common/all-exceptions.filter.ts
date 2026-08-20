import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

// GitHub issue #779 (Phase 52) — the catch-all half of the fix:
// PrismaExceptionFilter handles every known Prisma error itself and never
// re-throws, so this only ever sees either a well-formed HttpException
// (ValidationPipe's BadRequestException, ForbiddenException,
// NotFoundException, etc. — passed through unchanged, exactly what Nest's
// own default handler would have done) or a genuinely unexpected error —
// a real bug, not a validated-input case. Only the latter is ever worth
// hiding from the client; its message/stack is logged server-side only.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const message = exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;
    this.logger.error(`Unhandled exception: ${message}`, stack);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred.',
    });
  }
}

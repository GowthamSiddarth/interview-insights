# Phase 52, Issue #779 — Prisma Exception Filter Leaks Internal Detail

*Part of Phase 52 — Security & Access-Control Hardening.
See `docs/ROADMAP.md` Phase 52.*

## The gap

`PrismaExceptionFilter` (`api/src/common/prisma-exception.filter.ts`)
maps Prisma's known error codes — `P2002` (unique constraint), `P2003`
(foreign key), `P2025` (not found) — to friendly HTTP responses. Every
*other* Prisma error code fell through to no `case` at all, which meant
it re-threw straight to Nest's own default exception handler. Nest's
default handler echoes `exception.message` verbatim to the client —
for a raw Prisma error, that message can include real column/constraint
names, sometimes even fragments of the underlying SQL. Internal schema
detail, handed to whoever triggered the error.

There was a second half to the same class of gap: nothing in this app
caught a *non*-HTTP, non-Prisma exception at all — a raw `throw new
Error('...')` or a third-party library throwing a plain string would hit
the exact same "Nest's default handler echoes it" path.

## The fix: two filters, ordered so each only ever sees what it should

**`PrismaExceptionFilter` gained a `default` case:**

```ts
// prisma-exception.filter.ts
default:
  this.logger.error(
    `Unmapped Prisma error code ${exception.code}: ${exception.message}`,
    exception.stack,
  );
  return new InternalServerErrorException('An unexpected error occurred.');
```

Every unmapped Prisma code now logs the real detail server-side and
returns the same fixed generic message every other unhandled path in
this app returns — never `exception.message` itself.

**A new `AllExceptionsFilter` catches everything else:**

```ts
// all-exceptions.filter.ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const message = exception instanceof Error ? exception.message : String(exception);
    this.logger.error(`Unhandled exception: ${message}`, exception instanceof Error ? exception.stack : undefined);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred.',
    });
  }
}
```

The two are registered in a specific order, and the order is
load-bearing — Nest resolves global filters by first array match:

```ts
// main.ts
app.useGlobalFilters(new PrismaExceptionFilter(), new AllExceptionsFilter());
```

`PrismaExceptionFilter` handles every Prisma error itself and never
re-throws, so by construction `AllExceptionsFilter` only ever sees a
well-formed `HttpException` (passed through unchanged — exactly what
Nest's own default would have done for a validated `BadRequestException`,
`ForbiddenException`, etc.) or a genuinely unexpected error. Only the
latter gets its detail hidden from the client; everything else keeps
behaving exactly as before.

## Verification

Unit tests for both filters directly: `PrismaExceptionFilter`'s new
default case asserts a fixed 500/generic-message response while
confirming the real Prisma message never appears in the JSON body sent
to the client (only in the mocked logger call). `AllExceptionsFilter`
gets a matching pair — an `HttpException` passes through with its real
status/body intact, and a raw `Error`/string throw both collapse to the
same generic 500, with the real message asserted present only in the
logger call, never the response.

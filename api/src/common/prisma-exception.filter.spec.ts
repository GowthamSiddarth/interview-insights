import { ArgumentsHost, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaExceptionFilter } from './prisma-exception.filter';

function makeHost(): { host: ArgumentsHost; response: { status: jest.Mock; json: jest.Mock } } {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

function makePrismaError(code: string, meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Simulated Prisma error', {
    code,
    clientVersion: '5.0.0',
    meta,
  });
}

describe('PrismaExceptionFilter', () => {
  let filter: PrismaExceptionFilter;

  beforeEach(() => {
    filter = new PrismaExceptionFilter();
  });

  it('maps P2002 to a 409 naming the conflicting field', () => {
    const { host, response } = makeHost();
    filter.catch(makePrismaError('P2002', { target: ['slug'] }), host);

    const expected = new ConflictException('A record with this slug already exists.');
    expect(response.status).toHaveBeenCalledWith(expected.getStatus());
    expect(response.json).toHaveBeenCalledWith(expected.getResponse());
  });

  it('maps P2003 to a 422', () => {
    const { host, response } = makeHost();
    filter.catch(makePrismaError('P2003'), host);

    const expected = new UnprocessableEntityException('One or more referenced records do not exist.');
    expect(response.status).toHaveBeenCalledWith(expected.getStatus());
    expect(response.json).toHaveBeenCalledWith(expected.getResponse());
  });

  it('maps P2025 to a 404', () => {
    const { host, response } = makeHost();
    filter.catch(makePrismaError('P2025'), host);

    const expected = new NotFoundException('Record not found.');
    expect(response.status).toHaveBeenCalledWith(expected.getStatus());
    expect(response.json).toHaveBeenCalledWith(expected.getResponse());
  });

  // GitHub issue #779 (Phase 52) — every other code used to re-throw
  // straight to Nest's default handler, which echoes exception.message.
  it('maps every other code to a fixed generic 500, never echoing exception.message', () => {
    const { host, response } = makeHost();
    filter.catch(makePrismaError('P2034', { some: 'internal detail' }), host);

    expect(response.status).toHaveBeenCalledWith(500);
    const [[body]] = response.json.mock.calls as [[{ message: string }]];
    expect(body.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain('Simulated Prisma error');
    expect(JSON.stringify(body)).not.toContain('internal detail');
  });
});

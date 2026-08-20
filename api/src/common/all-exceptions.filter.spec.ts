import { ArgumentsHost, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

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

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes a well-formed HttpException through unchanged', () => {
    const { host, response } = makeHost();
    const exception = new NotFoundException('Record not found.');

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith(exception.getResponse());
  });

  it('passes a ForbiddenException through unchanged', () => {
    const { host, response } = makeHost();
    const exception = new ForbiddenException('You can only edit your own rating.');

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(exception.getResponse());
  });

  // GitHub issue #779 (Phase 52) — a genuinely unexpected error (a real
  // bug, not a validated-input case) must never echo its message/stack.
  it('masks a genuinely unexpected error behind a fixed generic 500', () => {
    const { host, response } = makeHost();
    const exception = new Error('column "internal_thing" does not exist');

    filter.catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(500);
    const [[body]] = response.json.mock.calls as [[{ message: string }]];
    expect(body.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain('internal_thing');
  });

  it('masks a thrown non-Error value the same way', () => {
    const { host, response } = makeHost();

    filter.catch('a raw string throw', host);

    expect(response.status).toHaveBeenCalledWith(500);
    const [[body]] = response.json.mock.calls as [[{ message: string }]];
    expect(body.message).toBe('An unexpected error occurred.');
  });
});

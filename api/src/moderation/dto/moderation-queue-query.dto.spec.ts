import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ModerationQueueQueryDto } from './moderation-queue-query.dto';

describe('ModerationQueueQueryDto', () => {
  it('accepts an empty payload — every field is optional', async () => {
    const dto = plainToInstance(ModerationQueueQueryDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts every valid entityType value', async () => {
    for (const entityType of ['round_rating', 'recruiter_rating', 'overall_review', 'company']) {
      const dto = plainToInstance(ModerationQueueQueryDto, { entityType });
      expect(await validate(dto)).toHaveLength(0);
    }
  });

  it('rejects an entityType outside the enum', async () => {
    const dto = plainToInstance(ModerationQueueQueryDto, { entityType: 'something-else' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'entityType')).toBe(true);
  });

  it('accepts a UUID companyId', async () => {
    const dto = plainToInstance(ModerationQueueQueryDto, {
      companyId: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a non-UUID companyId', async () => {
    const dto = plainToInstance(ModerationQueueQueryDto, { companyId: 'not-a-uuid' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'companyId')).toBe(true);
  });

  it('accepts every valid claimState value', async () => {
    for (const claimState of ['mine', 'unclaimed', 'all']) {
      const dto = plainToInstance(ModerationQueueQueryDto, { claimState });
      expect(await validate(dto)).toHaveLength(0);
    }
  });

  it('rejects a claimState outside the three valid values', async () => {
    const dto = plainToInstance(ModerationQueueQueryDto, { claimState: 'someone-else' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'claimState')).toBe(true);
  });

  it('normalizes a single status value into a one-element array', async () => {
    const dto = plainToInstance(ModerationQueueQueryDto, { status: 'pending' });
    expect(dto.status).toEqual(['pending']);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a repeated status querystring parsed as an array', async () => {
    const dto = plainToInstance(ModerationQueueQueryDto, { status: ['pending', 'flagged'] });
    expect(dto.status).toEqual(['pending', 'flagged']);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a status value outside pending/flagged', async () => {
    const dto = plainToInstance(ModerationQueueQueryDto, { status: 'approved' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });
});

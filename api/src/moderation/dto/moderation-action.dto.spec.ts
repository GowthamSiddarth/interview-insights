import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ModerationActionDto } from './moderation-action.dto';

describe('ModerationActionDto', () => {
  it('accepts an empty payload — reviewedBy is optional', async () => {
    const dto = plainToInstance(ModerationActionDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a string reviewedBy', async () => {
    const dto = plainToInstance(ModerationActionDto, { reviewedBy: 'gowtham' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a non-string reviewedBy', async () => {
    const dto = plainToInstance(ModerationActionDto, { reviewedBy: 42 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'reviewedBy')).toBe(true);
  });

  // GitHub issue #688 (Phase 49, D104).
  it('accepts a valid rejectionReasonCategory and a reviewNote', async () => {
    const dto = plainToInstance(ModerationActionDto, {
      rejectionReasonCategory: 'low_quality',
      reviewNote: 'Free text was too vague to be useful.',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an unrecognized rejectionReasonCategory', async () => {
    const dto = plainToInstance(ModerationActionDto, { rejectionReasonCategory: 'not_a_real_category' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'rejectionReasonCategory')).toBe(true);
  });

  it('rejects a non-string reviewNote', async () => {
    const dto = plainToInstance(ModerationActionDto, { reviewNote: 42 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'reviewNote')).toBe(true);
  });
});

import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateInterviewProcessDto } from './create-interview-process.dto';

const valid = {
  roleTitle: 'Senior Backend Engineer',
  outcome: 'in_progress',
};

describe('CreateInterviewProcessDto', () => {
  it('accepts a valid payload', async () => {
    const dto = plainToInstance(CreateInterviewProcessDto, valid);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts optional level/department/applicationDate when present', async () => {
    const dto = plainToInstance(CreateInterviewProcessDto, {
      ...valid,
      level: 'L5',
      department: 'Platform',
      applicationDate: '2026-01-15',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an invalid outcome', async () => {
    const dto = plainToInstance(CreateInterviewProcessDto, { ...valid, outcome: 'hired' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'outcome')).toBe(true);
  });

  it('rejects a malformed applicationDate', async () => {
    const dto = plainToInstance(CreateInterviewProcessDto, {
      ...valid,
      applicationDate: 'not-a-date',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'applicationDate')).toBe(true);
  });

  it('rejects a missing roleTitle', async () => {
    const { roleTitle: _roleTitle, ...rest } = valid;
    const dto = plainToInstance(CreateInterviewProcessDto, rest);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'roleTitle')).toBe(true);
  });
});

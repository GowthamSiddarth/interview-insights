import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateCompanyDto } from './update-company.dto';

describe('UpdateCompanyDto', () => {
  it('accepts an empty payload — every field is optional', async () => {
    const dto = plainToInstance(UpdateCompanyDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  // GitHub issue #828 (Phase 57) — the whole point: a true partial update.
  it('accepts just one field', async () => {
    const dto = plainToInstance(UpdateCompanyDto, { industry: 'fintech' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a full payload too', async () => {
    const dto = plainToInstance(UpdateCompanyDto, {
      name: 'Acme Corp',
      slug: 'acme-corp',
      sizeBucket: 'mid',
      industry: 'fintech',
      logoUrl: 'https://example.com/logo.png',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a malformed slug when provided', async () => {
    const dto = plainToInstance(UpdateCompanyDto, { slug: 'Acme Corp' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'slug')).toBe(true);
  });

  it('rejects an invalid sizeBucket when provided', async () => {
    const dto = plainToInstance(UpdateCompanyDto, { sizeBucket: 'huge' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'sizeBucket')).toBe(true);
  });

  it('rejects an empty name when explicitly provided as empty', async () => {
    const dto = plainToInstance(UpdateCompanyDto, { name: '' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });
});

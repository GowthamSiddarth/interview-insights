import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateCompanyDto } from './create-company.dto';

const valid = {
  name: 'Acme Corp',
  slug: 'acme-corp',
  sizeBucket: 'mid',
};

describe('CreateCompanyDto', () => {
  it('accepts a valid payload', async () => {
    const dto = plainToInstance(CreateCompanyDto, valid);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts optional industry and logoUrl when present', async () => {
    const dto = plainToInstance(CreateCompanyDto, {
      ...valid,
      industry: 'fintech',
      logoUrl: 'https://example.com/logo.png',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each(['Acme-Corp', 'acme corp', 'acme_corp', ''])(
    'rejects a malformed slug: %s',
    async (slug) => {
      const dto = plainToInstance(CreateCompanyDto, { ...valid, slug });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'slug')).toBe(true);
    },
  );

  it('rejects an invalid sizeBucket', async () => {
    const dto = plainToInstance(CreateCompanyDto, { ...valid, sizeBucket: 'huge' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'sizeBucket')).toBe(true);
  });

  it('rejects a missing name', async () => {
    const { name: _name, ...rest } = valid;
    const dto = plainToInstance(CreateCompanyDto, rest);
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });
});

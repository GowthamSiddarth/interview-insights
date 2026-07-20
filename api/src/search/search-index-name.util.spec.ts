import { searchIndexName } from './search-index-name.util';

describe('searchIndexName', () => {
  const original = process.env.OPENSEARCH_INDEX_PREFIX;

  afterEach(() => {
    if (original === undefined) delete process.env.OPENSEARCH_INDEX_PREFIX;
    else process.env.OPENSEARCH_INDEX_PREFIX = original;
  });

  it('returns the bare name when no prefix is set', () => {
    delete process.env.OPENSEARCH_INDEX_PREFIX;
    expect(searchIndexName('companies')).toBe('companies');
  });

  it('prepends the prefix when set', () => {
    process.env.OPENSEARCH_INDEX_PREFIX = 'e2etest-';
    expect(searchIndexName('companies')).toBe('e2etest-companies');
    expect(searchIndexName('reviews')).toBe('e2etest-reviews');
  });
});

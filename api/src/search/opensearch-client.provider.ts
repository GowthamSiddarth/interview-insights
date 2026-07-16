import { Provider } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';

export const OPENSEARCH_CLIENT = 'OPENSEARCH_CLIENT';

export const opensearchClientProvider: Provider = {
  provide: OPENSEARCH_CLIENT,
  useFactory: () => new Client({ node: process.env.OPENSEARCH_URL ?? 'http://localhost:9200' }),
};

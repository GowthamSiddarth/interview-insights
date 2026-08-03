// Shared by localstack-secrets-bootstrap.ts (GitHub issue #340, D75/D81
// duplicate-rather-than-share precedent — own copy of api's/notification-
// service's identical util) — both need the same "talking to LocalStack
// needs dummy static credentials, talking to real AWS needs the default
// SDK credential chain" logic.
export function localstackAwsClientConfig() {
  return {
    region: process.env.AWS_REGION ?? 'us-east-1',
    ...(process.env.AWS_ENDPOINT_URL
      ? {
          endpoint: process.env.AWS_ENDPOINT_URL,
          credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        }
      : {}),
  };
}

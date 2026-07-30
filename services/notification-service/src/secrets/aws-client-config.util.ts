// Own copy of api/src/secrets/aws-client-config.util.ts (GitHub issue
// #466, D73/D75's duplicate-rather-than-share precedent — no shared
// package between services). Both need the same "talking to LocalStack
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

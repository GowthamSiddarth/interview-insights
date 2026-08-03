const stsSend = jest.fn();
const secretsManagerSend = jest.fn();

jest.mock('@aws-sdk/client-sts', () => ({
  STSClient: jest.fn().mockImplementation(() => ({ send: stsSend })),
  AssumeRoleCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({ send: secretsManagerSend })),
  GetSecretValueCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

import { bootstrapSecretsFromLocalStack } from './localstack-secrets-bootstrap';

describe('bootstrapSecretsFromLocalStack', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('is a no-op when SECRETS_SOURCE is not localstack', async () => {
    delete process.env.SECRETS_SOURCE;

    await bootstrapSecretsFromLocalStack();

    expect(stsSend).not.toHaveBeenCalled();
    expect(secretsManagerSend).not.toHaveBeenCalled();
  });

  it('throws when AWS_SECRETS_ROLE_ARN is missing', async () => {
    process.env.SECRETS_SOURCE = 'localstack';
    delete process.env.AWS_SECRETS_ROLE_ARN;

    await expect(bootstrapSecretsFromLocalStack()).rejects.toThrow('AWS_SECRETS_ROLE_ARN');
  });

  it('assumes the role and sets DATABASE_URL/ANTHROPIC_API_KEY from the fetched secrets', async () => {
    process.env.SECRETS_SOURCE = 'localstack';
    process.env.AWS_SECRETS_ROLE_ARN = 'arn:aws:iam::000000000000:role/review-analyzer-secrets-role';
    stsSend.mockResolvedValue({
      Credentials: { AccessKeyId: 'AKIA', SecretAccessKey: 'shh', SessionToken: 'token' },
    });
    secretsManagerSend
      .mockResolvedValueOnce({ SecretString: 'postgresql://real-db' })
      .mockResolvedValueOnce({ SecretString: 'sk-ant-real-key' });

    await bootstrapSecretsFromLocalStack();

    expect(process.env.DATABASE_URL).toBe('postgresql://real-db');
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-real-key');
  });

  it('sets ANTHROPIC_API_KEY to an empty string when the secret does not exist', async () => {
    process.env.SECRETS_SOURCE = 'localstack';
    process.env.AWS_SECRETS_ROLE_ARN = 'arn:aws:iam::000000000000:role/review-analyzer-secrets-role';
    stsSend.mockResolvedValue({
      Credentials: { AccessKeyId: 'AKIA', SecretAccessKey: 'shh', SessionToken: 'token' },
    });
    secretsManagerSend
      .mockResolvedValueOnce({ SecretString: 'postgresql://real-db' })
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' }));

    await bootstrapSecretsFromLocalStack();

    expect(process.env.DATABASE_URL).toBe('postgresql://real-db');
    expect(process.env.ANTHROPIC_API_KEY).toBe('');
  });

  it('throws when AssumeRole returns no usable temporary credentials', async () => {
    process.env.SECRETS_SOURCE = 'localstack';
    process.env.AWS_SECRETS_ROLE_ARN = 'arn:aws:iam::000000000000:role/review-analyzer-secrets-role';
    stsSend.mockResolvedValue({});

    await expect(bootstrapSecretsFromLocalStack()).rejects.toThrow('no temporary credentials returned');
  });

  it('throws when DATABASE_URL has no SecretString value', async () => {
    process.env.SECRETS_SOURCE = 'localstack';
    process.env.AWS_SECRETS_ROLE_ARN = 'arn:aws:iam::000000000000:role/review-analyzer-secrets-role';
    stsSend.mockResolvedValue({
      Credentials: { AccessKeyId: 'AKIA', SecretAccessKey: 'shh', SessionToken: 'token' },
    });
    secretsManagerSend.mockResolvedValue({});

    await expect(bootstrapSecretsFromLocalStack()).rejects.toThrow('has no SecretString value');
  });
});

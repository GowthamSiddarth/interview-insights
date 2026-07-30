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

  it('assumes the role and sets every secret from the fetched values, including an admin/Anthropic key (D78)', async () => {
    process.env.SECRETS_SOURCE = 'localstack';
    process.env.AWS_SECRETS_ROLE_ARN = 'arn:aws:iam::000000000000:role/api-secrets-role';
    stsSend.mockResolvedValue({
      Credentials: { AccessKeyId: 'AKIA', SecretAccessKey: 'shh', SessionToken: 'token' },
    });
    secretsManagerSend
      .mockResolvedValueOnce({ SecretString: 'postgresql://real-db' })
      .mockResolvedValueOnce({ SecretString: 'real-email-hash-secret' })
      .mockResolvedValueOnce({ SecretString: 'real-email-encryption-key' })
      .mockResolvedValueOnce({ SecretString: 'real-candidate-jwt-secret' })
      .mockResolvedValueOnce({ SecretString: 'real-admin-password-hash' })
      .mockResolvedValueOnce({ SecretString: 'real-admin-jwt-secret' })
      .mockResolvedValueOnce({ SecretString: 'sk-ant-real-key' });

    await bootstrapSecretsFromLocalStack();

    expect(process.env.DATABASE_URL).toBe('postgresql://real-db');
    expect(process.env.EMAIL_HASH_SECRET).toBe('real-email-hash-secret');
    expect(process.env.EMAIL_ENCRYPTION_KEY).toBe('real-email-encryption-key');
    expect(process.env.CANDIDATE_JWT_SECRET).toBe('real-candidate-jwt-secret');
    expect(process.env.ADMIN_PASSWORD_HASH).toBe('real-admin-password-hash');
    expect(process.env.ADMIN_JWT_SECRET).toBe('real-admin-jwt-secret');
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-real-key');
  });

  it('sets ANTHROPIC_API_KEY to an empty string rather than throwing when the secret does not exist (D78)', async () => {
    process.env.SECRETS_SOURCE = 'localstack';
    process.env.AWS_SECRETS_ROLE_ARN = 'arn:aws:iam::000000000000:role/api-secrets-role';
    stsSend.mockResolvedValue({
      Credentials: { AccessKeyId: 'AKIA', SecretAccessKey: 'shh', SessionToken: 'token' },
    });
    const notFound = Object.assign(new Error("Secrets Manager can't find the specified secret."), {
      name: 'ResourceNotFoundException',
    });
    secretsManagerSend
      .mockResolvedValueOnce({ SecretString: 'postgresql://real-db' })
      .mockResolvedValueOnce({ SecretString: 'real-email-hash-secret' })
      .mockResolvedValueOnce({ SecretString: 'real-email-encryption-key' })
      .mockResolvedValueOnce({ SecretString: 'real-candidate-jwt-secret' })
      .mockResolvedValueOnce({ SecretString: 'real-admin-password-hash' })
      .mockResolvedValueOnce({ SecretString: 'real-admin-jwt-secret' })
      .mockRejectedValueOnce(notFound);

    await bootstrapSecretsFromLocalStack();

    expect(process.env.ANTHROPIC_API_KEY).toBe('');
  });

  it('rethrows a non-ResourceNotFoundException error while fetching the optional Anthropic secret', async () => {
    process.env.SECRETS_SOURCE = 'localstack';
    process.env.AWS_SECRETS_ROLE_ARN = 'arn:aws:iam::000000000000:role/api-secrets-role';
    stsSend.mockResolvedValue({
      Credentials: { AccessKeyId: 'AKIA', SecretAccessKey: 'shh', SessionToken: 'token' },
    });
    secretsManagerSend
      .mockResolvedValueOnce({ SecretString: 'postgresql://real-db' })
      .mockResolvedValueOnce({ SecretString: 'real-email-hash-secret' })
      .mockResolvedValueOnce({ SecretString: 'real-email-encryption-key' })
      .mockResolvedValueOnce({ SecretString: 'real-candidate-jwt-secret' })
      .mockResolvedValueOnce({ SecretString: 'real-admin-password-hash' })
      .mockResolvedValueOnce({ SecretString: 'real-admin-jwt-secret' })
      .mockRejectedValueOnce(new Error('network blip'));

    await expect(bootstrapSecretsFromLocalStack()).rejects.toThrow('network blip');
  });

  it('throws when AssumeRole returns no usable temporary credentials', async () => {
    process.env.SECRETS_SOURCE = 'localstack';
    process.env.AWS_SECRETS_ROLE_ARN = 'arn:aws:iam::000000000000:role/api-secrets-role';
    stsSend.mockResolvedValue({});

    await expect(bootstrapSecretsFromLocalStack()).rejects.toThrow(
      'no temporary credentials returned',
    );
  });

  it('throws when a fetched secret has no SecretString value', async () => {
    process.env.SECRETS_SOURCE = 'localstack';
    process.env.AWS_SECRETS_ROLE_ARN = 'arn:aws:iam::000000000000:role/api-secrets-role';
    stsSend.mockResolvedValue({
      Credentials: { AccessKeyId: 'AKIA', SecretAccessKey: 'shh', SessionToken: 'token' },
    });
    secretsManagerSend.mockResolvedValue({});

    await expect(bootstrapSecretsFromLocalStack()).rejects.toThrow('has no SecretString value');
  });
});

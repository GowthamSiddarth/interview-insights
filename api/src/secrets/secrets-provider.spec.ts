import { Test, TestingModule } from '@nestjs/testing';
import { SecretsProvider } from './secrets-provider';
import { SECRETS_MANAGER_CLIENT } from './secrets-manager-client.provider';

describe('SecretsProvider', () => {
  let service: SecretsProvider;
  let client: { send: jest.Mock };

  beforeEach(async () => {
    client = { send: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [SecretsProvider, { provide: SECRETS_MANAGER_CLIENT, useValue: client }],
    }).compile();

    service = module.get(SecretsProvider);
  });

  it('returns the secret string', async () => {
    client.send.mockResolvedValue({ SecretString: 'shh' });
    expect(await service.getSecret('my-secret')).toBe('shh');
  });

  it('throws when the secret has no SecretString value', async () => {
    client.send.mockResolvedValue({});
    await expect(service.getSecret('my-secret')).rejects.toThrow('has no SecretString value');
  });
});

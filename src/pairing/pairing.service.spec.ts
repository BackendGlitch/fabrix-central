import { PairingService } from './pairing.service';
import { AuthService } from '../auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';

type MockDb = {
  db: {
    insert: jest.Mock;
    select: jest.Mock;
    update: jest.Mock;
  };
};

const makeSelectChain = (result: any[]) => {
  const chain: any = {
    from: jest.fn(),
    where: jest.fn(),
    limit: jest.fn().mockResolvedValue(result),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return chain;
};

const makeInsertChain = (returningResult: any[] = []) => {
  const chain: any = {
    values: jest.fn(),
    returning: jest.fn().mockResolvedValue(returningResult),
    then: (resolve: any, reject: any) => Promise.resolve(undefined).then(resolve, reject),
  };
  chain.values.mockReturnValue(chain);
  return chain;
};

const makeUpdateChain = (returningResult: any[] = []) => {
  const chain: any = {
    set: jest.fn(),
    where: jest.fn(),
    returning: jest.fn().mockResolvedValue(returningResult),
    then: (resolve: any, reject: any) => Promise.resolve(undefined).then(resolve, reject),
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return chain;
};

describe('PairingService', () => {
  let service: PairingService;
  let db: MockDb;
  let auth: jest.Mocked<AuthService>;
  let jwt: jest.Mocked<JwtService>;
  let config: jest.Mocked<ConfigService>;

  beforeEach(() => {
    db = {
      db: {
        insert: jest.fn(),
        select: jest.fn(),
        update: jest.fn(),
      },
    };

    auth = {
      issueSessionForUserId: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;

    jwt = {
      verify: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

    config = {
      get: jest.fn(),
      getOrThrow: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    service = new PairingService(
      db as unknown as DatabaseService,
      jwt,
      config,
      auth,
    );
  });

  it('startPairing creates a pending pairing and returns login_url', async () => {
    const insertPairing = makeInsertChain([{ id: 'pair-1' }]);
    const insertAudit = makeInsertChain();

    db.db.insert.mockReturnValueOnce(insertPairing).mockReturnValueOnce(insertAudit);

    config.get.mockImplementation((key: string) => {
      if (key === 'AGENT_LOGIN_BASE_URL') return 'http://example.com/login';
      if (key === 'AGENT_PAIRING_EXPIRY_MINUTES') return 10;
      return undefined;
    });

    const result = await service.startPairing('Agent X', {
      ip: '1.2.3.4',
      userAgent: 'jest',
    });

    expect(result.pairing_code).toHaveLength(6);
    expect(result.login_url).toContain(result.pairing_code);
    expect(result.login_url).toContain('http://example.com/login');
    expect(result.expires_at).toBeInstanceOf(Date);

    expect(insertPairing.values).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: 'Agent X',
        status: 'pending',
      }),
    );
  });

  it('approvePairing updates status and writes audit', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    db.db.select.mockReturnValueOnce(
      makeSelectChain([
        {
          id: 'pair-1',
          status: 'pending',
          expiresAt,
        },
      ]),
    );

    const updatePairing = makeUpdateChain();
    db.db.update.mockReturnValueOnce(updatePairing);

    const insertAudit = makeInsertChain();
    db.db.insert.mockReturnValueOnce(insertAudit);

    const result = await service.approvePairing('ABC123', 'owner-1', {
      ip: '1.2.3.4',
      userAgent: 'jest',
    });

    expect(result).toEqual({ message: 'Pairing approved successfully' });

    const setArg = updatePairing.set.mock.calls[0][0];
    expect(setArg).toEqual(
      expect.objectContaining({
        status: 'approved',
        ownerId: 'owner-1',
      }),
    );
    expect(setArg.approvedAt).toBeInstanceOf(Date);
  });

  it('consumePairing returns auth tokens and marks pairing consumed', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    db.db.select.mockReturnValueOnce(
      makeSelectChain([
        {
          id: 'pair-1',
          status: 'approved',
          expiresAt,
          ownerId: 'owner-1',
        },
      ]),
    );

    auth.issueSessionForUserId.mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
      user: {
        id: 'owner-1',
        email: 'owner@example.com',
        name: 'Owner',
        role: 'OWNER',
      },
    });

    config.getOrThrow.mockReturnValue('refresh_secret');
    jwt.verify.mockReturnValue({ jti: 'session-1' });

    const updatePairing = makeUpdateChain([{ id: 'pair-1' }]);
    db.db.update.mockReturnValueOnce(updatePairing);

    const insertAudit = makeInsertChain();
    db.db.insert.mockReturnValueOnce(insertAudit);

    const result = await service.consumePairing('ABC123', {
      ip: '1.2.3.4',
      userAgent: 'jest',
    });

    expect(result).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      user: {
        id: 'owner-1',
        email: 'owner@example.com',
        name: 'Owner',
        role: 'OWNER',
      },
    });

    const setArg = updatePairing.set.mock.calls[0][0];
    expect(setArg).toEqual(
      expect.objectContaining({
        status: 'consumed',
        sessionId: 'session-1',
      }),
    );
    expect(setArg.consumedAt).toBeInstanceOf(Date);
  });

  it('consumePairing is idempotent when already consumed', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    db.db.select.mockReturnValueOnce(
      makeSelectChain([
        {
          id: 'pair-1',
          status: 'consumed',
          expiresAt,
          ownerId: 'owner-1',
        },
      ]),
    );

    const insertAudit = makeInsertChain();
    db.db.insert.mockReturnValueOnce(insertAudit);

    const result = await service.consumePairing('ABC123', {
      ip: '1.2.3.4',
      userAgent: 'jest',
    });

    expect(result).toEqual({ status: 'already_consumed' });
    expect(auth.issueSessionForUserId).not.toHaveBeenCalled();
  });
});

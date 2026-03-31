import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { PassportModule } from '@nestjs/passport';
import request from 'supertest';
import WebSocket from 'ws';

import { PairingController } from '../src/pairing/pairing.controller';
import { PairingService } from '../src/pairing/pairing.service';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { AgentGateway } from '../src/ws/agent.gateway';
import { AgentAuthService } from '../src/agent-auth/agent-auth.service';

const TEST_JWT_SECRET = 'test-secret-pairing-revoke';
const AGENT_TOKEN = 'agent-test-token';

class FakeAgentAuthService {
  private readonly revoked = new Set<string>();

  verifyAccessToken(token: string) {
    if (token !== AGENT_TOKEN) {
      throw new Error('Invalid token');
    }
    return { agentId: 'agent-1', ownerId: 'owner-1' };
  }

  async isAgentActive(agentId: string): Promise<boolean> {
    return !this.revoked.has(agentId);
  }

  async touchLastSeen(): Promise<void> {
    return;
  }

  markRevoked(agentId: string): void {
    this.revoked.add(agentId);
  }
}

describe('Pairing revocation websocket denial (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let jwtService: JwtService;
  let fakeAgentAuth: FakeAgentAuthService;

  beforeAll(async () => {
    fakeAgentAuth = new FakeAgentAuthService();
    const pairingServiceMock: Partial<PairingService> = {
      revokeOwnerAgent: async (ownerId: string, agentId: string) => {
        if (ownerId !== 'owner-1' || agentId !== 'agent-1') {
          throw new Error('Not found');
        }
        fakeAgentAuth.markRevoked(agentId);
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [() => ({ JWT_ACCESS_SECRET: TEST_JWT_SECRET })],
        }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({
          secret: TEST_JWT_SECRET,
          signOptions: { expiresIn: '15m' },
        }),
      ],
      controllers: [PairingController],
      providers: [
        JwtStrategy,
        RolesGuard,
        AgentGateway,
        {
          provide: PairingService,
          useValue: pairingServiceMock,
        },
        {
          provide: AgentAuthService,
          useValue: fakeAgentAuth,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.listen(0);

    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;
    jwtService = moduleFixture.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  function signOwnerToken() {
    return jwtService.sign({
      sub: 'owner-1',
      email: 'owner@fabrix.test',
      name: 'Owner',
      role: 'OWNER',
    });
  }

  async function connectWsWithToken(token: string): Promise<number> {
    const wsUrl = baseUrl.replace('http://', 'ws://') + '/ws/agent';
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });

      socket.once('open', () => {
        socket.close();
      });
      socket.once('close', (code) => resolve(code));
      socket.once('error', reject);
    });
  }

  it('denies websocket reconnect after owner revokes agent', async () => {
    const firstConnectCode = await connectWsWithToken(AGENT_TOKEN);
    expect([1000, 1005]).toContain(firstConnectCode);

    const ownerToken = signOwnerToken();
    await request(app.getHttpServer())
      .delete('/agent/pair/owner/agents/agent-1')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const reconnectCode = await connectWsWithToken(AGENT_TOKEN);
    expect(reconnectCode).toBe(1008);
  });
});

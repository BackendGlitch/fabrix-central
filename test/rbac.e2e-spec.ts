import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  Controller,
  Get,
  UseGuards,
  Request,
  ValidationPipe,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types';

import { JwtAuthGuard, RolesGuard } from '../src/auth/guards/index';
import { Roles } from '../src/auth/decorators/index';
import { JwtStrategy } from '../src/auth/jwt.strategy';

const TEST_JWT_SECRET = 'test-secret-for-rbac-e2e';

// ── Test controller with role-protected routes ──────────────────────────────

@Controller('test')
class TestRbacController {
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  @Get('owner-only')
  ownerOnly(@Request() req) {
    return { role: req.user.role };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CUSTOMER')
  @Get('customer-only')
  customerOnly(@Request() req) {
    return { role: req.user.role };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  @Get('owner-or-admin')
  ownerOrAdmin(@Request() req) {
    return { role: req.user.role };
  }

  @UseGuards(JwtAuthGuard)
  @Get('any-authenticated')
  anyAuthenticated(@Request() req) {
    return { role: req.user.role };
  }
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe('RBAC Guards (e2e)', () => {
  let app: INestApplication<App>;
  let jwtService: JwtService;

  beforeAll(async () => {
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
      controllers: [TestRbacController],
      providers: [JwtStrategy, RolesGuard],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    jwtService = moduleFixture.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  function signToken(
    role: string,
    sub = 'user-uuid-123',
    email = 'test@fabrix.io',
  ) {
    return jwtService.sign({ sub, email, role });
  }

  // ── 401 Unauthenticated ────────────────────────────────────────────────

  it('should return 401 when no token is provided', () => {
    return request(app.getHttpServer()).get('/test/owner-only').expect(401);
  });

  it('should return 401 when an invalid token is provided', () => {
    return request(app.getHttpServer())
      .get('/test/owner-only')
      .set('Authorization', 'Bearer invalid.token.here')
      .expect(401);
  });

  // ── 403 Forbidden (wrong role) ─────────────────────────────────────────

  it('should return 403 when CUSTOMER accesses OWNER-only route', () => {
    const token = signToken('CUSTOMER');
    return request(app.getHttpServer())
      .get('/test/owner-only')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('should return 403 when OWNER accesses CUSTOMER-only route', () => {
    const token = signToken('OWNER');
    return request(app.getHttpServer())
      .get('/test/customer-only')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('should return 403 when CUSTOMER accesses OWNER|ADMIN route', () => {
    const token = signToken('CUSTOMER');
    return request(app.getHttpServer())
      .get('/test/owner-or-admin')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  // ── 200 Authorized (correct role) ──────────────────────────────────────

  it('should return 200 when OWNER accesses OWNER-only route', () => {
    const token = signToken('OWNER');
    return request(app.getHttpServer())
      .get('/test/owner-only')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.role).toBe('OWNER');
      });
  });

  it('should return 200 when CUSTOMER accesses CUSTOMER-only route', () => {
    const token = signToken('CUSTOMER');
    return request(app.getHttpServer())
      .get('/test/customer-only')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.role).toBe('CUSTOMER');
      });
  });

  it('should return 200 when ADMIN accesses OWNER|ADMIN route', () => {
    const token = signToken('ADMIN');
    return request(app.getHttpServer())
      .get('/test/owner-or-admin')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.role).toBe('ADMIN');
      });
  });

  it('should return 200 when OWNER accesses OWNER|ADMIN route', () => {
    const token = signToken('OWNER');
    return request(app.getHttpServer())
      .get('/test/owner-or-admin')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.role).toBe('OWNER');
      });
  });

  // ── No @Roles() → any authenticated user is allowed ───────────────────

  it('should return 200 for any authenticated user when no @Roles() is set', () => {
    const token = signToken('CUSTOMER');
    return request(app.getHttpServer())
      .get('/test/any-authenticated')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});

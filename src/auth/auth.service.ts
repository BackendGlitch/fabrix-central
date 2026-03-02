import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { eq, and, isNull } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

import { DatabaseService } from '../database/database.service.js';
import { users, userSessions } from '../database/schema.js';
import { RegisterDto, LoginDto } from './dto/index.js';
import { JwtPayload, TokenPair } from './interfaces/index.js';


@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);
    
    private readonly SALT_ROUNDS = 12;
    private readonly REFRESH_DAYS = 30;

    constructor(
        private readonly db: DatabaseService,
        private readonly jwt: JwtService,
        private readonly config: ConfigService,
    ) {}

    async register(dto: RegisterDto): Promise<TokenPair> {
        const existingUser = await this.db.db.select({id : users.id}).from(users).where(eq(users.email, dto.email.toLowerCase())).limit(1);
        if (existingUser.length > 0) {
            throw new ConflictException('Email already in use');
        }
    
        const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);
        const [user] = await this.db.db
        .insert(users)
        .values({
            email: dto.email.toLowerCase(),
            passwordHash,
            name: dto.name,
            role: dto.role,
        })
        .returning({ id: users.id, email: users.email, role: users.role });


        this.logger.log(`User registered: ${user.email} (ID: ${user.id})`);

        return this.createSession(user.id, user.email, user.role);
    }

    async login(dto: LoginDto): Promise<TokenPair> {
        const [user] = await this.db.db.select({id : users.id, passwordHash: users.passwordHash, role: users.role,isActive : users.isActive}).from(users).where(eq(users.email, dto.email.toLowerCase())).limit(1);
        if (!user){
            throw new UnauthorizedException('Invalid credentials');
        }
        if (!user.isActive){
            throw new ForbiddenException('Account is deactivated');
        }
        if (!await bcrypt.compare(dto.password, user.passwordHash)) {
            throw new UnauthorizedException('Invalid credentials');
        }

        this.logger.log(`User logged in: ${dto.email} (ID: ${user.id})`);

        return this.createSession(user.id, dto.email, user.role);
    }
    
    
  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: { jti: string; sub: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.getRefreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const [session] = await this.db.db
      .select()
      .from(userSessions)
      .where(
        and(
          eq(userSessions.id, payload.jti),
          isNull(userSessions.revokedAt),
        ),
      )
      .limit(1);

    if (!session) {
      throw new UnauthorizedException('Session not found or revoked');
    }

    if (session.expiredAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const valid = await bcrypt.compare(refreshToken, session.hashedRefreshToken);
    if (!valid) {
      await this.db.db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(eq(userSessions.id, session.id));

      this.logger.warn(
        `Refresh token reuse detected for session ${session.id} — session revoked`,
      );
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    const [user] = await this.db.db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    await this.db.db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(eq(userSessions.id, session.id));

    this.logger.log(`Token refreshed for user ${user.email}`);

    return this.createSession(user.id, user.email, user.role);
  }


  async logout(refreshToken: string): Promise<void> {
    let payload: { jti: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.getRefreshSecret(),
      });
    } catch {
      return;
    }

    await this.db.db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(eq(userSessions.id, payload.jti));

    this.logger.log(`Session ${payload.jti} revoked (logout)`);
  }


  private async createSession(
    userId: string,
    email: string,
    role: 'OWNER' | 'CUSTOMER'| 'ADMIN',
  ): Promise<TokenPair> {
    const sessionId = randomUUID();
    const expiredAt = new Date();
    expiredAt.setDate(expiredAt.getDate() + this.REFRESH_DAYS);

    const jwtPayload: JwtPayload = { sub: userId, email, role };

    const accessToken = this.jwt.sign(jwtPayload, {
      secret: this.getAccessSecret(),
      expiresIn: '15m',
    });

    const refreshToken = this.jwt.sign(
      { sub: userId, jti: sessionId },
      { secret: this.getRefreshSecret(), expiresIn: `${this.REFRESH_DAYS}d` },
    );

    const hashedRefreshToken = await bcrypt.hash(refreshToken, this.SALT_ROUNDS);

    await this.db.db.insert(userSessions).values({
      id: sessionId,
      userId,
      hashedRefreshToken,
      expiredAt,
    });

    return { accessToken, refreshToken };
  }

  private getAccessSecret(): string {
    return this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  private getRefreshSecret(): string {
    return this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
  }
}
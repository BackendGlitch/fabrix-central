import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  Get,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { RegisterDto, LoginDto, RefreshDto } from './dto/index.js';
import { JwtAuthGuard, RolesGuard } from './guards/index.js';
import { Roles } from './decorators/index.js';
import type { AuthTokens } from './interfaces/index.js';

type CookieSameSite = 'lax' | 'strict' | 'none';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private getRefreshCookieName(): string {
    const cookieName = this.config
      .get<string>('AUTH_REFRESH_COOKIE_NAME')
      ?.trim();
    return cookieName || 'fabrix_refresh_token';
  }

  private getRefreshCookieDomain(): string | undefined {
    const domain = this.config
      .get<string>('AUTH_REFRESH_COOKIE_DOMAIN')
      ?.trim();
    return domain || undefined;
  }

  private getRefreshCookieSameSite(): CookieSameSite {
    const sameSite = this.config
      .get<string>('AUTH_REFRESH_COOKIE_SAMESITE')
      ?.trim()
      .toLowerCase();

    if (sameSite === 'lax' || sameSite === 'strict' || sameSite === 'none') {
      return sameSite;
    }

    return 'lax';
  }

  private shouldUseSecureRefreshCookie(): boolean {
    const secure = this.config
      .get<string>('AUTH_REFRESH_COOKIE_SECURE')
      ?.trim()
      .toLowerCase();

    if (secure === 'true' || secure === '1') {
      return true;
    }

    if (secure === 'false' || secure === '0') {
      return false;
    }

    return this.config.get<string>('NODE_ENV') === 'production';
  }

  private setRefreshCookie(response: Response, refreshToken: string): void {
    const domain = this.getRefreshCookieDomain();

    response.cookie(this.getRefreshCookieName(), refreshToken, {
      httpOnly: true,
      secure: this.shouldUseSecureRefreshCookie(),
      sameSite: this.getRefreshCookieSameSite(),
      path: '/',
      maxAge: REFRESH_TOKEN_TTL_MS,
      ...(domain ? { domain } : {}),
    });
  }

  private clearRefreshCookie(response: Response): void {
    const domain = this.getRefreshCookieDomain();

    response.clearCookie(this.getRefreshCookieName(), {
      httpOnly: true,
      secure: this.shouldUseSecureRefreshCookie(),
      sameSite: this.getRefreshCookieSameSite(),
      path: '/',
      ...(domain ? { domain } : {}),
    });
  }

  private getRefreshTokenFromCookie(request: Request): string | undefined {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) {
      return undefined;
    }

    const refreshCookieName = this.getRefreshCookieName();

    for (const cookie of cookieHeader.split(';')) {
      const [name, ...valueParts] = cookie.trim().split('=');
      if (name !== refreshCookieName) {
        continue;
      }

      const rawValue = valueParts.join('=');
      if (!rawValue) {
        return undefined;
      }

      try {
        return decodeURIComponent(rawValue);
      } catch {
        return rawValue;
      }
    }

    return undefined;
  }

  private resolveRefreshToken(
    request: Request,
    dto?: RefreshDto,
  ): string | undefined {
    const bodyToken = dto?.refreshToken?.trim();
    if (bodyToken) {
      return bodyToken;
    }

    return this.getRefreshTokenFromCookie(request);
  }

  private toClientTokensResponse(message: string, tokens: AuthTokens) {
    return {
      message,
      accessToken: tokens.accessToken,
      user: tokens.user,
    };
  }

  // ── POST /auth/register ────────────────────────────────────────────────────

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const tokens = await this.auth.register(dto);
    this.setRefreshCookie(response, tokens.refreshToken);
    return this.toClientTokensResponse('Registration successful', tokens);
  }

  // ── POST /auth/login ──────────────────────────────────────────────────────

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const tokens = await this.auth.login(dto);
    this.setRefreshCookie(response, tokens.refreshToken);
    return this.toClientTokensResponse('Login successful', tokens);
  }

  // ── POST /auth/refresh ────────────────────────────────────────────────────

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Body() dto: RefreshDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = this.resolveRefreshToken(request, dto);

    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const tokens = await this.auth.refresh(refreshToken);
    this.setRefreshCookie(response, tokens.refreshToken);
    return this.toClientTokensResponse('Token refreshed', tokens);
  }

  // ── POST /auth/logout ─────────────────────────────────────────────────────

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: Request,
    @Body() dto: RefreshDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = this.resolveRefreshToken(request, dto);
    if (refreshToken) {
      await this.auth.logout(refreshToken);
    }

    this.clearRefreshCookie(response);
    return { message: 'Logged out' };
  }

  // ── GET /auth/me — bonus: verify token & return current user ──────────────

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req) {
    return {
      userId: req.user.userId,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  @Get('test/owner-only')
  ownerOnly(@Req() req) {
    return { message: `Hello Owner ${req.user.email}` };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CUSTOMER')
  @Get('test/customer-only')
  customerOnly(@Req() req) {
    return { message: `Hello Customer ${req.user.email}` };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('test/admin-only')
  adminOnly(@Req() req) {
    return { message: `Hello Admin ${req.user.email}` };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  @Get('test/owner-or-admin')
  ownerOrAdmin(@Req() req) {
    return { message: `Hello ${req.user.role} ${req.user.email}` };
  }
}

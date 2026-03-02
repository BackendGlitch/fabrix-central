import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  Get,
  Request,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { RegisterDto, LoginDto, RefreshDto } from './dto/index.js';
import { JwtAuthGuard } from './guards/index.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // ── POST /auth/register ────────────────────────────────────────────────────

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    const tokens = await this.auth.register(dto);
    return {
      message: 'Registration successful',
      ...tokens,
    };
  }

  // ── POST /auth/login ──────────────────────────────────────────────────────

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    const tokens = await this.auth.login(dto);
    return {
      message: 'Login successful',
      ...tokens,
    };
  }

  // ── POST /auth/refresh ────────────────────────────────────────────────────

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto) {
    const tokens = await this.auth.refresh(dto.refreshToken);
    return {
      message: 'Token refreshed',
      ...tokens,
    };
  }

  // ── POST /auth/logout ─────────────────────────────────────────────────────

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
    return { message: 'Logged out' };
  }

  // ── GET /auth/me — bonus: verify token & return current user ──────────────

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Request() req) {
    return {
      userId: req.user.userId,
      email: req.user.email,
      role: req.user.role,
    };
  }
}

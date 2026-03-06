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
import { JwtAuthGuard, RolesGuard } from './guards/index.js';
import { Roles } from './decorators/index.js';

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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  @Get('test/owner-only')
  ownerOnly(@Request() req) {
    return { message: `Hello Owner ${req.user.email}` };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CUSTOMER')
  @Get('test/customer-only')
  customerOnly(@Request() req) {
    return { message: `Hello Customer ${req.user.email}` };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('test/admin-only')
  adminOnly(@Request() req) {
    return { message: `Hello Admin ${req.user.email}` };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  @Get('test/owner-or-admin')
  ownerOrAdmin(@Request() req) {
    return { message: `Hello ${req.user.role} ${req.user.email}` };
  }
}

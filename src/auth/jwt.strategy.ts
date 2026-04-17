import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from './interfaces/index.js';
import { isUserRole } from './roles.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  validate(payload: JwtPayload) {
    if (!payload.sub || !payload.email || !isUserRole(payload.role)) {
      throw new UnauthorizedException('Malformed token');
    }
    return {
      userId: payload.sub,
      email: payload.email,
      name: payload.name ?? 'User',
      role: payload.role,
    };
  }
}

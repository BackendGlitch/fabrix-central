import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, info: any, context: any, status: any) {
    if (err) {
      console.error('JWT Error:', err);
      throw err;
    }
    if (!user) {
      console.error('JWT Info:', info);
      throw new UnauthorizedException();
    }
    return user;
  }
}
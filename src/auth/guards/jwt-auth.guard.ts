import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  handleRequest(err: any, user: any, info: any, context: any, status: any) {
    if (err) {
      const message = err?.message || 'Unknown JWT guard error';
      this.logger.warn(`JWT error: ${message}`);
      throw err;
    }
    if (!user) {
      const infoName = info?.name || '';
      const infoMessage = info?.message || 'Unauthorized';
      if (
        infoName === 'TokenExpiredError' ||
        infoMessage.toLowerCase().includes('expired')
      ) {
        this.logger.debug(`JWT expired: ${infoMessage}`);
      } else {
        this.logger.warn(`JWT rejected: ${infoMessage}`);
      }
      throw new UnauthorizedException();
    }
    return user;
  }
}

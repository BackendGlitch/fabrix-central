import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/index.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. Read the roles attached by @Roles() decorator
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 2. If no @Roles() decorator on this route, allow access (only JWT needed)
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // 3. Get the user from request (set by JwtAuthGuard)
    const { user } = context.switchToHttp().getRequest();

    // 4. Check if user's role is in the allowed list
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `Role '${user.role}' is not authorized. Required: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
import { SetMetadata } from '@nestjs/common';

// This key is used by RolesGuard to read the allowed roles from the route metadata
export const ROLES_KEY = 'roles';

/**
 * Decorator that marks a route as requiring specific roles.
 *
 * Usage:
 *   @Roles('OWNER')              — only owners
 *   @Roles('OWNER', 'ADMIN')     — owners and admins
 *   @Roles('CUSTOMER')           — only customers
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
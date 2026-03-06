import { SetMetadata } from '@nestjs/common';

export type UserRole = 'OWNER' | 'CUSTOMER' | 'ADMIN';

export const ROLES_KEY = 'roles';

/**
 * Decorator that marks a route as requiring specific roles.
 *
 * @example
 *   @Roles('OWNER')              — only owners
 *   @Roles('OWNER', 'ADMIN')     — owners and admins
 *   @Roles('CUSTOMER')           — only customers
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

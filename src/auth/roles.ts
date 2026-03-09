export const USER_ROLES = ['OWNER', 'CUSTOMER', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PUBLIC_REGISTRATION_ROLES = ['OWNER', 'CUSTOMER'] as const;
export type PublicRegistrationRole = (typeof PUBLIC_REGISTRATION_ROLES)[number];

const USER_ROLE_SET = new Set<string>(USER_ROLES);

export function isUserRole(role: unknown): role is UserRole {
  return typeof role === 'string' && USER_ROLE_SET.has(role);
}

export function canAccessRoles(
  userRole: UserRole,
  requiredRoles: UserRole[],
): boolean {
  if (requiredRoles.includes(userRole)) {
    return true;
  }

  // ADMIN can access all protected role-based routes.
  return userRole === 'ADMIN';
}

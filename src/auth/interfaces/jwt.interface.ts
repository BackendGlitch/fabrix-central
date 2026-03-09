import type { UserRole } from '../roles.js';

export interface JwtPayload {
  sub: string; /* subject (user id)*/
  email: string;
  name?: string;
  role: UserRole;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface AuthTokens extends TokenPair {
  user: AuthUser;
}

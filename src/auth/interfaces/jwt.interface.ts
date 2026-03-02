
export interface JwtPayload {
    sub: string; /* subject (user id)*/
    email: string;
    role: 'OWNER' | 'CUSTOMER' | 'ADMIN';   
}

export interface TokenPair {
    accessToken: string;
    refreshToken: string;
}
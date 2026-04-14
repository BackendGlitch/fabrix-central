import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

interface CurrentUserPayload {
  userId: string;
  email: string;
  name: string;
  role: string;
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return (request.user || {}) as CurrentUserPayload;
  },
);

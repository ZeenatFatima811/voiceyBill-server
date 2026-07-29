import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { type Request } from "express";

/**
 * Resolves the authenticated user that `passport-jwt` attached to the request.
 *
 * Equivalent to reading `req.user` in the previous Express controllers, so it
 * is `undefined` on any route that is not behind the JWT middleware.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Express.User | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user;
  },
);

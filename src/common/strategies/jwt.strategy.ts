import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy, type StrategyOptions } from "passport-jwt";

import { Env } from "../../config/env.config";
import { findByIdUserService } from "../../services/user.service";
import { isTokenInvalidatedByLogout } from "../../utils/auth-session";

interface JwtPayload {
  userId: string;
  iat?: number;
}

const options: StrategyOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: Env.JWT_SECRET,
  audience: ["user"],
  algorithms: ["HS256"],
};

/**
 * Bearer-token strategy, registered with Passport under the name "jwt".
 *
 * Returning `false` (instead of throwing) is deliberate: the mixin forwards the
 * return value to Passport's `done`, so a falsy result produces Passport's own
 * plain-text `401 Unauthorized` — byte-for-byte what the previous
 * `passport.authenticate("jwt")` middleware returned. Throwing here would route
 * into the error handler and emit a JSON 500 instead.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor() {
    super(options);
  }

  async validate(
    payload: JwtPayload,
  ): Promise<Awaited<ReturnType<typeof findByIdUserService>> | false> {
    if (!payload.userId) {
      return false;
    }

    const isLoggedOut = await isTokenInvalidatedByLogout(
      payload.userId,
      payload.iat,
    );

    if (isLoggedOut) {
      return false;
    }

    const user = await findByIdUserService(payload.userId);

    if (!user) {
      return false;
    }

    return user;
  }
}

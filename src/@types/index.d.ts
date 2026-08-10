import type { UserApi } from "../db/mappers/user.mapper";

declare global {
  namespace Express {
    /**
     * What `JwtStrategy` attaches to the request.
     *
     * Was `UserDocument`, i.e. a mongoose document. It is now the safe
     * projection the user repository returns — no password, no tokenVersion, no
     * OTP hashes — which is what the strategy has actually been putting here
     * since the port.
     *
     * `_id?: any` is carried over verbatim rather than tightened to `string`.
     * Controllers read `req.user?._id`, and `Express.User` is optional on the
     * request, so a precise type makes that expression `string | undefined` and
     * fails at every call site. Fixing that properly means threading a guard
     * through ~20 controller methods — worth doing, but as its own change, not
     * buried in a database migration.
     */
    interface User extends UserApi {
      _id?: any;
    }
  }
}

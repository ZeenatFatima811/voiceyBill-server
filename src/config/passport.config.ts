import passport from "passport";

// Session serialisation is a no-op pass-through. Every route authenticates with
// `session: false`, so these are never exercised — kept only so the Passport
// instance stays configured exactly as it was before the NestJS migration.
passport.serializeUser((user: Express.User, done) => done(null, user));
passport.deserializeUser((user: Express.User, done) => done(null, user));

/**
 * Route-scoped authentication middleware.
 *
 * The "jwt" strategy itself is registered by the `JwtStrategy` provider (see
 * `src/common/strategies/jwt.strategy.ts`); Passport resolves it by name at
 * request time.
 *
 * This stays middleware rather than becoming a Nest guard on purpose: Express ran
 * it across the whole `${BASE_PATH}/<feature>` prefix, ahead of route matching, so
 * an unknown sub-path under a protected prefix answered 401 rather than 404. A
 * guard runs after routing and would invert that.
 */
export const passportAuthenticateJwt = passport.authenticate("jwt", {
  session: false,
});

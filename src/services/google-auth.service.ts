/**
 * Google OAuth sign-in — ported from mongoose to the Postgres repository layer.
 *
 * NOTE this service has NO automated coverage: signing in requires a real Google
 * ID token, which a test cannot mint. It was therefore the one place a
 * still-on-mongoose service could have survived the migration unnoticed. The
 * three branches below are the ones to re-read carefully in review.
 */
import { verifyGoogleIdToken } from "../config/google-oauth.config";
import {
  reports as reportRepo,
  users as userRepo,
  withTransaction,
  type Executor,
} from "../db/repositories";
import { ReportFrequencyEnum } from "../enums/domain.enum";
import { BadRequestException } from "../utils/app-error";
import { calculateNextReportDate } from "../utils/helper";
import { signJwtToken, signRefreshToken } from "../utils/jwt";
import type { GoogleAuthSchemaType } from "../validators/google-auth.validator";

const createDefaultReportSetting = async (userId: string, exec?: Executor) => {
  const existing = await reportRepo.findSettingByUser(userId, exec);
  if (existing) return existing;

  return reportRepo.createSetting(
    {
      userId,
      frequency: ReportFrequencyEnum.MONTHLY,
      isEnabled: true,
      nextReportDate: calculateNextReportDate(),
      lastSentDate: null,
    },
    exec,
  );
};

export const googleAuthService = async (body: GoogleAuthSchemaType) => {
  /**
   * Token verification happens BEFORE the transaction opens.
   *
   * It is a network round trip to Google and it touches no table, so holding a
   * transaction open across it buys nothing and costs real capacity: `db/client.ts`
   * caps the pool at ONE connection per serverless instance, so an in-transaction
   * verify blocks that instance's only connection on an external service for the
   * duration. The mongoose version did it inside the session, where a session was
   * cheap; the Postgres equivalent is not.
   *
   * No behaviour changes — both failure branches below throw before any write, so
   * there was never anything to roll back.
   */
  let googlePayload;
  try {
    googlePayload = await verifyGoogleIdToken(body.idToken);
  } catch (error) {
    throw new BadRequestException(
      "Invalid or expired Google token. Please try again.",
    );
  }

  if (!googlePayload.email) {
    throw new BadRequestException(
      "Could not retrieve email from Google account.",
    );
  }

  return withTransaction(async (tx) => {
    /** The token trio every branch returns, so the three stay identical. */
    const issue = async (userId: string, tokenVersion: number) => {
      const { token, expiresAt } = signJwtToken({ userId });
      const refreshToken = signRefreshToken({ userId, tokenVersion });
      const reportSetting = await reportRepo.findSettingSummaryByUser(userId, tx);
      const user = await userRepo.findById(userId, tx);

      return { user, accessToken: token, refreshToken, expiresAt, reportSetting };
    };

    /**
     * Check if user exists by Google ID first.
     *
     * The Mongo query matched on `providerId` alone. Adding `provider` narrows
     * it in principle, but only Google accounts ever carry a providerId — every
     * local row has null, which is why the index on that column is partial — so
     * the result set is identical, and the extra predicate makes the intent
     * explicit rather than implied.
     */
    const byProvider = await userRepo.findByProviderId(
      "google",
      googlePayload.googleId,
      tx,
    );

    if (byProvider) {
      // User already has Google OAuth linked
      return issue(byProvider._id, byProvider.tokenVersion ?? 0);
    }

    // Check if user exists by email
    const byEmail = await userRepo.findByEmailWithSecrets(googlePayload.email, tx);

    if (byEmail) {
      // User exists but with email/password auth - link Google account
      await userRepo.update(
        byEmail._id,
        {
          provider: "google",
          providerId: googlePayload.googleId,
          profilePicture: googlePayload.picture || byEmail.profilePicture,
          isVerified: true, // Auto-verify since Google verifies email
        },
        tx,
      );

      return issue(byEmail._id, byEmail.tokenVersion ?? 0);
    }

    // Create new user
    const created = await userRepo.create(
      {
        name: googlePayload.name,
        email: googlePayload.email,
        profilePicture: googlePayload.picture,
        provider: "google",
        providerId: googlePayload.googleId,
        password: null,
        isVerified: googlePayload.emailVerified, // Google verifies email
        baseCurrency: "USD",
      },
      tx,
    );

    // Create default report setting
    await createDefaultReportSetting(created._id, tx);

    return issue(created._id, created.tokenVersion ?? 0);
  });
};

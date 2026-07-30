import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from "@nestjs/common";
import { type RouteInfo } from "@nestjs/common/interfaces";
import { APP_FILTER } from "@nestjs/core";

import { AppController } from "./app.controller";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { upload } from "./config/cloudinary.config";
import { ensureDatabaseConnection } from "./config/database.config";
import { Env } from "./config/env.config";
import { passportAuthenticateJwt } from "./config/passport.config";
import { authLimiter, otpLimiter } from "./middlewares/rateLimit.middleware";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BudgetModule } from "./modules/budget/budget.module";
import { CategoryModule } from "./modules/category/category.module";
import { CronModule } from "./modules/cron/cron.module";
import { CurrencyModule } from "./modules/currency/currency.module";
import { ReportModule } from "./modules/report/report.module";
import { TransactionModule } from "./modules/transaction/transaction.module";
import { UserModule } from "./modules/user/user.module";
import { voiceCors } from "./modules/voice/voice-cors.middleware";
import { voiceUploadMiddleware } from "./modules/voice/voice-upload.middleware";
import { VoiceModule } from "./modules/voice/voice.module";

const BASE_PATH = Env.BASE_PATH;

/*
 * NOTE ON DEPENDENCY INJECTION
 *
 * Every controller declares its dependencies with an explicit `@Inject(Token)`
 * rather than relying on the constructor's inferred parameter types.
 *
 * Inferred types require TypeScript's `emitDecoratorMetadata`, which only the
 * real `tsc` compiler emits — esbuild and swc do not support it. When that
 * metadata is absent, Nest does not fail: it silently constructs each
 * controller with `undefined` dependencies, so the process boots, `/health`
 * answers 200, and every route that touches a service dies with
 * "Cannot read properties of undefined". Vercel transpiles the TypeScript entry
 * point itself, so the deployed bundle is not guaranteed to carry the metadata.
 *
 * Explicit tokens make injection independent of the toolchain.
 */

/**
 * Expands a mount prefix into the two route entries needed to reproduce
 * Express's `app.use(prefix, ...)` semantics: the bare prefix plus everything
 * below it. A single `prefix*` pattern would over-match sibling paths such as
 * `/api/budgets`.
 */
const mountedAt = (prefix: string): RouteInfo[] => [
  { path: prefix, method: RequestMethod.ALL },
  { path: `${prefix}/*`, method: RequestMethod.ALL },
];

const AUTH_PREFIX = `${BASE_PATH}/auth`;

/** Prefixes that require an authenticated caller — everything except /auth. */
const PROTECTED_PREFIXES = [
  `${BASE_PATH}/user`,
  `${BASE_PATH}/transaction`,
  `${BASE_PATH}/report`,
  `${BASE_PATH}/analytics`,
  `${BASE_PATH}/voice`,
  `${BASE_PATH}/category`,
  `${BASE_PATH}/budget`,
  `${BASE_PATH}/currency`,
];

const ALL_PREFIXES = [AUTH_PREFIX, ...PROTECTED_PREFIXES];

/** Auth routes that were rate limited per-IP, split by their original window. */
const AUTH_LIMITED_ROUTES = ["register", "login", "google", "refresh-token"];
const OTP_LIMITED_ROUTES = [
  "verify-otp",
  "resend-otp",
  "forgot-password",
  "reset-password",
];

const postRoute = (path: string): RouteInfo => ({
  path,
  method: RequestMethod.POST,
});

@Module({
  imports: [
    AuthModule,
    UserModule,
    TransactionModule,
    ReportModule,
    AnalyticsModule,
    VoiceModule,
    CategoryModule,
    BudgetModule,
    CurrencyModule,
    CronModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule implements NestModule {
  /**
   * Route-scoped middleware, declared in the exact order the Express app applied
   * it. `configure` runs during `app.init()`, so everything here lands after the
   * platform-level stack in `main.ts` and before Nest's router.
   *
   * The previous mounting was:
   *   app.use(`${BASE_PATH}/auth`, ensureDatabaseConnection, authRoutes)
   *   app.use(`${BASE_PATH}/<rest>`, ensureDatabaseConnection, passportAuthenticateJwt, ...)
   * with the rate limiters and Multer handlers declared inside each router.
   */
  configure(consumer: MiddlewareConsumer): void {
    // 1. Serverless-safe lazy database connect, on every API prefix. The root
    //    liveness routes are deliberately excluded, as before.
    consumer
      .apply(ensureDatabaseConnection)
      .forRoutes(...ALL_PREFIXES.flatMap(mountedAt));

    // 2. JWT authentication for every prefix except /auth.
    consumer
      .apply(passportAuthenticateJwt)
      .forRoutes(...PROTECTED_PREFIXES.flatMap(mountedAt));

    // 3. Voice's own, wider CORS policy (allows preview deployments).
    consumer.apply(voiceCors).forRoutes(...mountedAt(`${BASE_PATH}/voice`));

    // 4. Per-IP rate limits on the credential and OTP endpoints.
    consumer
      .apply(authLimiter)
      .forRoutes(
        ...AUTH_LIMITED_ROUTES.map((route) =>
          postRoute(`${AUTH_PREFIX}/${route}`),
        ),
      );
    consumer
      .apply(otpLimiter)
      .forRoutes(
        ...OTP_LIMITED_ROUTES.map((route) =>
          postRoute(`${AUTH_PREFIX}/${route}`),
        ),
      );

    // 5. Multipart handlers. Kept as middleware rather than Nest's
    //    FileInterceptor so Multer errors keep reaching the error handler as
    //    MulterError instances instead of pre-mapped Nest HttpExceptions.
    consumer
      .apply(upload.single("profilePicture"))
      .forRoutes({
        path: `${BASE_PATH}/user/update`,
        method: RequestMethod.PUT,
      });
    consumer
      .apply(upload.single("receipt"))
      .forRoutes(postRoute(`${BASE_PATH}/transaction/scan-receipt`));
    consumer
      .apply(voiceUploadMiddleware)
      .forRoutes(postRoute(`${BASE_PATH}/voice/process`));
  }
}

import { getEnv } from "../utils/get-env";

const envConfig = () => ({
  NODE_ENV: getEnv("NODE_ENV", "development"),

  PORT: getEnv("PORT", "8000"),
  BASE_PATH: getEnv("BASE_PATH", "/api"),
  /**
   * Postgres connection string. REQUIRED — there is no fallback.
   *
   * It carried a local default while both databases coexisted, so existing dev
   * setups kept working mid-migration. Now that Postgres is the only database,
   * a default would let a misconfigured deployment start up and quietly point
   * at localhost instead of failing loudly.
   *
   * Deployed environments must use a POOLED connection string (Neon's
   * `-pooler` host, or PgBouncer). See src/db/client.ts: a direct connection
   * exhausts the server once Vercel scales the function out.
   */
  DATABASE_URL: getEnv("DATABASE_URL"),

  UPSTASH_REDIS_REST_URL: getEnv("UPSTASH_REDIS_REST_URL"),
  UPSTASH_REDIS_REST_TOKEN: getEnv("UPSTASH_REDIS_REST_TOKEN"),

  JWT_SECRET: getEnv("JWT_SECRET", "secert_jwt"),
  JWT_EXPIRES_IN: getEnv("JWT_EXPIRES_IN", "15m") as string,

  JWT_REFRESH_SECRET: getEnv("JWT_REFRESH_SECRET", "secert_jwt_refresh"),
  JWT_REFRESH_EXPIRES_IN: getEnv("JWT_REFRESH_EXPIRES_IN", "7d") as string,

  OPENAI_API_KEY: getEnv("OPENAI_API_KEY"),
  UPLIFT_AI_API_KEY: getEnv("UPLIFT_AI_API_KEY"),
  GEMINI_API_KEY: getEnv("GEMINI_API_KEY"),

  CLOUDINARY_CLOUD_NAME: getEnv("CLOUDINARY_CLOUD_NAME"),
  CLOUDINARY_API_KEY: getEnv("CLOUDINARY_API_KEY"),
  CLOUDINARY_API_SECRET: getEnv("CLOUDINARY_API_SECRET"),

  RESEND_API_KEY: getEnv("RESEND_API_KEY"),
  RESEND_MAILER_SENDER_REPORTS: getEnv(
    "RESEND_MAILER_SENDER_REPORTS",
    "reports@voiceybill.com"
  ),
  RESEND_MAILER_SENDER_VERIFY: getEnv(
    "RESEND_MAILER_SENDER_VERIFY",
    "verify@voiceybill.com"
  ),

  FRONTEND_ORIGIN: getEnv("FRONTEND_ORIGIN", "http://localhost:5173"),

  // Google OAuth
  GOOGLE_CLIENT_ID: getEnv("GOOGLE_CLIENT_ID"),
  GOOGLE_ANDROID_CLIENT_ID: getEnv("GOOGLE_ANDROID_CLIENT_ID", ""),
  GOOGLE_IOS_CLIENT_ID: getEnv("GOOGLE_IOS_CLIENT_ID", ""),
});

export const Env = envConfig();

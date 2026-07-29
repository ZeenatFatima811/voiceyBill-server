import { Module, type OnModuleInit } from "@nestjs/common";

import { Env } from "../../config/env.config";
import { initializeCrons } from "../../cron";

/**
 * Schedules the recurring jobs on boot.
 *
 * Development only, exactly as before: on Vercel each request is a separate
 * short-lived invocation, so an in-process scheduler would never fire — those
 * jobs are driven externally in production.
 *
 * `node-cron` is kept in place of `@nestjs/schedule` so the expressions,
 * UTC timezone and per-job logging stay byte-identical.
 */
@Module({})
export class CronModule implements OnModuleInit {
  onModuleInit(): void {
    if (Env.NODE_ENV !== "development") {
      return;
    }

    initializeCrons()
      .then(() => {
        console.log("Crons initialized");
      })
      .catch((error) => {
        console.error("Cron initialization failed:", error);
      });
  }
}

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  NotFoundException,
} from "@nestjs/common";
import { type Request, type Response } from "express";

import { HTTPSTATUS } from "../../config/http.config";
import { errorHandler } from "../../middlewares/errorHandler.middleware";

const noop = () => {
  /* Express's `next` is never reached: errorHandler always writes a response. */
};

/**
 * Global exception filter.
 *
 * Rather than reimplementing the response shapes, this delegates straight to
 * the original Express `errorHandler`, so ZodError / MulterError / AppError and
 * the generic 500 fallback all serialise exactly as they did before the NestJS
 * migration. The same handler is additionally registered as the terminal
 * Express error middleware in `main.ts` to cover failures raised by middleware,
 * which never enter Nest's execution context.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    // Nest's router throws NotFoundException for any unmatched path or method.
    // That is the case the Express app served with a catch-all handler, which
    // used a distinct body and — unlike errorHandler — logged nothing. Nothing
    // in this codebase throws Nest's NotFoundException itself (application code
    // raises the AppError subclass of the same name), so the instance check is
    // an unambiguous signal that routing, not a handler, produced this.
    if (exception instanceof NotFoundException) {
      response.status(HTTPSTATUS.NOT_FOUND).json({
        success: false,
        message: `Route ${request.originalUrl} not found`,
        status: HTTPSTATUS.NOT_FOUND,
      });
      return;
    }

    errorHandler(exception, request, response, noop);
  }
}

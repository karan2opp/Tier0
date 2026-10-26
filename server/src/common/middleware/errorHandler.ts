import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError, BadRequestError, NotFoundError } from "../errors";
import { logger } from "../logger";
import { ApiResponse } from "../response";

/** Catch-all for unmatched routes. Mount after all routers. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
};

/** Turns anything thrown into the standard ApiResponse envelope. Mount last. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Request-scoped logger from pino-http (carries the request ID); app logger as fallback.
  const log = req.log ?? logger;
  let appError: AppError;

  if (err instanceof AppError) {
    appError = err;
  } else if (isBodyParserError(err)) {
    appError = new BadRequestError("Malformed request body", { cause: err });
  } else {
    // Unexpected bug: log everything, tell the client nothing.
    log.error({ err }, "Unhandled error");
    appError = new AppError("Something went wrong", 500, { code: "INTERNAL_ERROR", cause: err }, false);
  }

  if (appError.isOperational) {
    log.warn({ code: appError.code, statusCode: appError.statusCode }, appError.message);
  }

  ApiResponse.fromError(appError).send(res);
};

function isBodyParserError(err: unknown): err is { type: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    typeof (err as { type: unknown }).type === "string" &&
    (err as { type: string }).type.startsWith("entity.")
  );
}

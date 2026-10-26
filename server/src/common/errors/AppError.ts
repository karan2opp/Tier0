export interface AppErrorOptions {
  code?: string;
  details?: unknown;
  cause?: unknown;
}

/**
 * Base class for every error we throw on purpose.
 * `isOperational` separates expected failures (bad input, not found)
 * from programmer errors/bugs, which the error handler reports as a generic 500.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode = 500,
    { code = "INTERNAL_ERROR", details, cause }: AppErrorOptions = {},
    isOperational = true,
  ) {
    super(message, { cause });
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace?.(this, new.target);
  }
}

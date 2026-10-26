import { AppError, type AppErrorOptions } from "./AppError";

export class BadRequestError extends AppError {
  constructor(message = "Bad request", options: AppErrorOptions = {}) {
    super(message, 400, { code: "BAD_REQUEST", ...options });
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", options: AppErrorOptions = {}) {
    super(message, 422, { code: "VALIDATION_ERROR", ...options });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required", options: AppErrorOptions = {}) {
    super(message, 401, { code: "UNAUTHORIZED", ...options });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this resource", options: AppErrorOptions = {}) {
    super(message, 403, { code: "FORBIDDEN", ...options });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found", options: AppErrorOptions = {}) {
    super(message, 404, { code: "NOT_FOUND", ...options });
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", options: AppErrorOptions = {}) {
    super(message, 409, { code: "CONFLICT", ...options });
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests", options: AppErrorOptions = {}) {
    super(message, 429, { code: "TOO_MANY_REQUESTS", ...options });
  }
}

/** An upstream dependency (LLM provider, helper, database) failed or timed out. */
export class ServiceUnavailableError extends AppError {
  constructor(message = "Service temporarily unavailable", options: AppErrorOptions = {}) {
    super(message, 503, { code: "SERVICE_UNAVAILABLE", ...options });
  }
}

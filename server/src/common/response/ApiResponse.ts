import type { Response } from "express";
import type { AppError } from "../errors";

export interface ApiErrorBody {
  code: string;
  details?: unknown;
}

/**
 * The single response envelope used by every endpoint:
 *
 *   success: { success: true,  message, data }
 *   failure: { success: false, message, error: { code, details? } }
 */
export class ApiResponse<T = unknown> {
  private constructor(
    readonly statusCode: number,
    readonly success: boolean,
    readonly message: string,
    readonly data?: T,
    readonly error?: ApiErrorBody,
  ) {}

  static ok<T>(data: T, message = "OK"): ApiResponse<T> {
    return new ApiResponse(200, true, message, data);
  }

  static created<T>(data: T, message = "Created"): ApiResponse<T> {
    return new ApiResponse(201, true, message, data);
  }

  static fail(statusCode: number, message: string, code: string, details?: unknown): ApiResponse<never> {
    return new ApiResponse<never>(statusCode, false, message, undefined, { code, details });
  }

  static fromError(err: AppError): ApiResponse<never> {
    return ApiResponse.fail(err.statusCode, err.message, err.code, err.details);
  }

  /** Express serializes via JSON.stringify, which calls this; statusCode stays out of the body. */
  toJSON() {
    return {
      success: this.success,
      message: this.message,
      ...(this.data !== undefined && { data: this.data }),
      ...(this.error && { error: this.error }),
    };
  }

  send(res: Response): Response {
    return res.status(this.statusCode).json(this);
  }
}

import { rateLimit } from "express-rate-limit";
import { TooManyRequestsError } from "../errors";

/**
 * Per-IP limit on chat endpoints: stops scripted abuse (and brute-forcing verification) before any
 * model call is made. Responses use the standard ApiResponse envelope via the error handler.
 */
export const chatRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.CHAT_RATE_LIMIT_PER_MINUTE ?? 20),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) => next(new TooManyRequestsError("Too many messages. Please wait a minute and try again.")),
});

import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../errors";

type Source = "body" | "query" | "params";

/** Validates a request part against a Zod schema and replaces it with the parsed value. */
export const validate =
  (schema: ZodType, source: Source = "body"): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      return next(new ValidationError("Invalid request", { details }));
    }
    (req as unknown as Record<Source, unknown>)[source] = result.data;
    next();
  };

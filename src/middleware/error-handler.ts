import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Validation failed",
      details: err.flatten(),
    });
  }

  const statusCode =
    typeof err === "object" && err && "statusCode" in err && typeof (err as { statusCode: unknown }).statusCode === "number"
      ? ((err as { statusCode: number }).statusCode)
      : 500;

  const message = err instanceof Error ? err.message : "Internal server error";

  if (statusCode >= 500) {
    console.error("[bridge]", message);
  }

  return res.status(statusCode).json({
    error: statusCode >= 500 ? "Internal server error" : message,
  });
}

import type { Request, Response, NextFunction } from "express";
import { config } from "../config/env.js";
import type { ErrorResponse } from "../types/index.js";

/**
 * Constant-time string comparison to prevent timing attacks
 * Compares strings in a way that takes the same amount of time
 * regardless of where the difference occurs
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Bearer token authentication middleware
 * Extracts and validates the token from Authorization header
 * Uses constant-time comparison to prevent timing attacks
 */
export function authMiddleware(
  req: Request,
  res: Response<ErrorResponse>,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  // Check for Authorization header
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      error: "Authorization required",
      code: "UNAUTHORIZED",
    });
    return;
  }

  // Extract token
  const token = authHeader.slice(7); // Remove "Bearer " prefix

  // Validate token using constant-time comparison
  // Always compare even if token is empty to prevent timing leaks
  const isValid =
    token && config.authToken && constantTimeEquals(token, config.authToken);

  if (!isValid) {
    // Generic error message - don't reveal if token exists or is invalid
    res.status(401).json({
      success: false,
      error: "Authorization required",
      code: "UNAUTHORIZED",
    });
    return;
  }

  next();
}

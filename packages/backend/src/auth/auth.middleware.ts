import type { Request, Response, NextFunction } from "express";
import {
  verifyAccessToken,
  type AuthenticatedUser,
  type UserRole,
} from "./auth.service.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function requireAuthentication(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith("Bearer ")) {
    res.status(401).json({
      error: "Authentication required.",
    });
    return;
  }

  const token = authorization.slice("Bearer ".length).trim();

  if (!token) {
    res.status(401).json({
      error: "Authentication required.",
    });
    return;
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({
      error: "Invalid or expired authentication token.",
    });
  }
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    if (!req.user) {
      res.status(401).json({
        error: "Authentication required.",
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: "You do not have permission to perform this action.",
      });
      return;
    }

    next();
  };
}
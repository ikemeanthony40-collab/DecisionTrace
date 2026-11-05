
import dotenv from "dotenv";
import { resolve } from "node:path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import {
  authenticateUser,
} from "./auth/auth.service.js";
import {
  requireAuthentication,
} from "./auth/auth.middleware.js";
import { policyRouter } from "./policies/policy.routes.js";
import { decisionRouter } from "./decisions/decision.routes.js";

// Load the project-root .env file.
dotenv.config({
  path: resolve(process.cwd(), "../../.env"),
});

export const app = express();

const allowedOrigins = (process.env.FRONTEND_URL ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());

app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin)
      ) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
  })
);
app.use(express.json({ limit: "100kb" }));
app.use("/api/policies", policyRouter);
app.use("/api/decisions", decisionRouter);

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    application: "DecisionTrace API",
  });
});

// Log in with a username and password.
app.post("/api/auth/login", async (req, res, next) => {
  try {
    const { username, password } = req.body ?? {};

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      username.trim().length === 0 ||
      password.length === 0 ||
      username.length > 100 ||
      password.length > 1024
    ) {
      res.status(400).json({
        error: "A valid username and password are required.",
      });
      return;
    }

    const result = await authenticateUser(username.trim(), password);

    if (!result) {
      res.status(401).json({
        error: "Invalid username or password.",
      });
      return;
    }

    res.json({
      token: result.token,
      tokenType: "Bearer",
      expiresIn: 28800,
      user: result.user,
    });
  } catch (error) {
    next(error);
  }
});

// Return the identity associated with the supplied token.
app.get("/api/auth/me", requireAuthentication, (req, res) => {
  res.json({
    user: req.user,
  });
});

// Return a consistent error for unexpected server failures.
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("API request failed:", error);

    res.status(500).json({
      error: "An unexpected server error occurred.",
    });
  }
);

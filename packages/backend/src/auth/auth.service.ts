import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { db } from "../db/database.js";

export type UserRole = "administrator" | "reviewer";

interface UserRecord {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: UserRole;
}

interface TokenPayload {
  sub: string;
  username: string;
  role: UserRole;
}

const TOKEN_LIFETIME_SECONDS = 8 * 60 * 60;

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (secret && secret.length >= 32) {
    return secret;
  }

  throw new Error(
    "JWT_SECRET must be configured with at least 32 characters."
  );
}

export async function authenticateUser(
  username: string,
  password: string
): Promise<{ token: string; user: AuthenticatedUser } | null> {
  const record = db
    .prepare(
      `SELECT id, username, password_hash, role
       FROM users
       WHERE username = ?`
    )
    .get(username) as UserRecord | undefined;

  if (!record) {
    return null;
  }

  const passwordMatches = await bcrypt.compare(
    password,
    record.password_hash
  );

  if (!passwordMatches) {
    return null;
  }

  const user: AuthenticatedUser = {
    id: record.id,
    username: record.username,
    role: record.role,
  };

  const token = jwt.sign(
    {
      username: user.username,
      role: user.role,
    },
    getJwtSecret(),
    {
      subject: user.id,
      expiresIn: TOKEN_LIFETIME_SECONDS,
      algorithm: "HS256",
      jwtid: randomUUID(),
    }
  );

  return { token, user };
}

export function verifyAccessToken(token: string): AuthenticatedUser {
  const payload = jwt.verify(token, getJwtSecret(), {
    algorithms: ["HS256"],
  }) as jwt.JwtPayload & TokenPayload;

  if (
    typeof payload.sub !== "string" ||
    typeof payload.username !== "string" ||
    (payload.role !== "administrator" && payload.role !== "reviewer")
  ) {
    throw new Error("Invalid authentication token.");
  }

  return {
    id: payload.sub,
    username: payload.username,
    role: payload.role,
  };
}
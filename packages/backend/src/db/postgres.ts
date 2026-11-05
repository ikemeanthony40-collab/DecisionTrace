import dotenv from "dotenv";
import { resolve } from "node:path";
import { Pool } from "pg";

// Load the project-root environment variables
dotenv.config({
  path: resolve(process.cwd(), "../../.env"),
});

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured.");
}

export const pool = new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error.message);
});

export async function testPostgresConnection(): Promise<void> {
  const result = await pool.query("SELECT NOW() AS current_time");

  console.log(
    "PostgreSQL connection successful:",
    result.rows[0].current_time
  );
}
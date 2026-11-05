import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({
  path: resolve(process.cwd(), "../../.env.test"),
  override: true,
});

if (!process.env.DATABASE_URL) {
  throw new Error("Test DATABASE_URL is not configured.");
}

async function main() {
  const { pool } = await import("./postgres.js");

  try {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const tables = result.rows.map((row) => row.table_name);

    console.log("Database:", "decisiontrace_test");
    console.log("Tables found:", tables.length);
    console.log(tables);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Verification failed:", error.message);
  process.exit(1);
});
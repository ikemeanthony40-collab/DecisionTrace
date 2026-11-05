import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({
  path: resolve(process.cwd(), "../../.env"),
});

async function main() {
  const { pool } = await import("./postgres.js");

  try {
    const result = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = $2 ORDER BY table_name",
      ["public", "BASE TABLE"]
    );

    console.log("\nPostgreSQL tables:");

    result.rows.forEach((row) => {
      console.log("-", row.table_name);
    });

    console.log("\nTotal tables:", result.rows.length);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
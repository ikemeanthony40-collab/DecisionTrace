import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({
  path: resolve(process.cwd(), "../../.env"),
});

async function main() {
  const { pool } = await import("./postgres.js");

  try {
    const tables = [
      "users",
      "policies",
      "policy_rules",
      "cases",
      "decisions",
      "decision_rule_snapshots",
      "rule_results",
      "review_actions",
      "audit_events",
    ];

    console.log("\nPOSTGRESQL DATABASE RECORD COUNTS\n");

    let total = 0;

    for (const table of tables) {
      const result = await pool.query(
        `SELECT COUNT(*) AS total FROM "${table}"`
      );

      const count = Number(result.rows[0].total);
      total += count;

      console.log(`${table}: ${count}`);
    }

    console.log("\nTotal records:", total);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
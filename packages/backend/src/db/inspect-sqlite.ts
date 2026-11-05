import Database from "better-sqlite3";
import { resolve } from "node:path";

const databasePath = resolve(
  process.cwd(),
  "data/decisiontrace.sqlite"
);

const db = new Database(databasePath, {
  readonly: true,
  fileMustExist: true,
});

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

try {
  console.log("\nSQLITE DATABASE RECORD COUNTS\n");

  for (const table of tables) {
    const result = db
      .prepare(`SELECT COUNT(*) AS total FROM "${table}"`)
      .get() as { total: number };

    console.log(`${table}: ${result.total}`);
  }

  console.log("\nSQLite inspection completed successfully.");
} finally {
  db.close();
}
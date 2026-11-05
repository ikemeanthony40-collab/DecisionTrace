import Database from "better-sqlite3";
import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({
  path: resolve(process.cwd(), "../../.env"),
});

const sqlitePath = resolve(
  process.cwd(),
  "data/decisiontrace.sqlite"
);

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
] as const;

type Row = Record<string, unknown>;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("hex");
  }

  return value;
}

function rowsMatch(
  sqliteRows: Row[],
  postgresRows: Row[],
  primaryKey: string
): { matches: boolean; differences: string[] } {
  const differences: string[] = [];

  const sqliteMap = new Map(
    sqliteRows.map((row) => [String(row[primaryKey]), row])
  );

  const postgresMap = new Map(
    postgresRows.map((row) => [String(row[primaryKey]), row])
  );

  for (const [id, sqliteRow] of sqliteMap) {
    const postgresRow = postgresMap.get(id);

    if (!postgresRow) {
      differences.push(`Missing PostgreSQL record: ${id}`);
      continue;
    }

    const columns = new Set([
      ...Object.keys(sqliteRow),
      ...Object.keys(postgresRow),
    ]);

    for (const column of columns) {
      const sqliteValue = normalizeValue(sqliteRow[column]);
      const postgresValue = normalizeValue(postgresRow[column]);

      if (sqliteValue !== postgresValue) {
        differences.push(
          `Record ${id}, column ${column}: SQLite=${String(sqliteValue)}, PostgreSQL=${String(postgresValue)}`
        );
      }
    }
  }

  for (const [id] of postgresMap) {
    if (!sqliteMap.has(id)) {
      differences.push(`Unexpected PostgreSQL record: ${id}`);
    }
  }

  return {
    matches: differences.length === 0,
    differences,
  };
}

async function main(): Promise<void> {
  const { pool } = await import("./postgres.js");

  const sqlite = new Database(sqlitePath, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    console.log("\nSTARTING FULL DATABASE CONTENT VERIFICATION\n");

    let totalDifferences = 0;
    let totalRecords = 0;

    for (const table of tables) {
      const sqliteRows = sqlite
        .prepare(`SELECT * FROM ${quoteIdentifier(table)}`)
        .all() as Row[];

      const postgresResult = await pool.query(
        `SELECT * FROM ${quoteIdentifier(table)}`
      );

      const postgresRows = postgresResult.rows as Row[];

      const result = rowsMatch(
        sqliteRows,
        postgresRows,
        "id"
      );

      totalRecords += sqliteRows.length;

      console.log(`\n${table}:`);

      if (result.matches) {
        console.log(
          `PASS — All ${sqliteRows.length} records match exactly.`
        );
      } else {
        console.log("FAIL — Differences found:");

        for (const difference of result.differences) {
          console.log("-", difference);
        }

        totalDifferences += result.differences.length;
      }
    }

    console.log("\n====================================");
    console.log("FULL CONTENT VERIFICATION SUMMARY");
    console.log(`SQLite source records: ${totalRecords}`);
    console.log(`Differences found: ${totalDifferences}`);

    if (totalDifferences === 0) {
      console.log("RESULT: ALL RECORDS MATCH.");
    } else {
      console.log("RESULT: VERIFICATION FAILED.");
    }

    console.log("====================================\n");
  } finally {
    sqlite.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("\nVERIFICATION ERROR:");
  console.error(error);
  process.exitCode = 1;
});

import Database from "better-sqlite3";
import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({
  path: resolve(process.cwd(), "../../.env"),
});

const sqlitePath = resolve(process.cwd(), "data/decisiontrace.sqlite");

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

// Insert rows while preserving their original column values.
async function insertRows(
  client: import("pg").PoolClient,
  table: string,
  rows: Row[]
): Promise<void> {
  if (rows.length === 0) return;

  for (const row of rows) {
    const columns = Object.keys(row);

    const columnList = columns.map(quoteIdentifier).join(", ");
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const values = columns.map((column) => row[column]);

    const sql = `INSERT INTO ${quoteIdentifier(table)}
      (${columnList}) VALUES (${placeholders})`;

    await client.query(sql, values);
  }

  console.log(`Copied ${rows.length} records into ${table}.`);
}

// Insert policy rules in predecessor order so their self-references work.
function orderPolicyRules(rows: Row[]): Row[] {
  const remaining = new Map(
    rows.map((row) => [String(row.id), row])
  );

  const inserted = new Set<string>();
  const ordered: Row[] = [];

  while (remaining.size > 0) {
    let progress = false;

    for (const [id, row] of remaining) {
      const predecessor = row.predecessor_id;

      if (
        predecessor === null ||
        predecessor === undefined ||
        inserted.has(String(predecessor))
      ) {
        ordered.push(row);
        inserted.add(id);
        remaining.delete(id);
        progress = true;
        break;
      }

      if (!remaining.has(String(predecessor)) && !inserted.has(String(predecessor))) {
        throw new Error(
          `Policy rule ${id} references missing predecessor ${String(predecessor)}.`
        );
      }
    }

    if (!progress) {
      throw new Error(
        "Could not order policy rules. A circular predecessor reference may exist."
      );
    }
  }

  return ordered;
}

async function main(): Promise<void> {
  const { pool } = await import("./postgres.js");
  const sqlite = new Database(sqlitePath, {
    readonly: true,
    fileMustExist: true,
  });

  const client = await pool.connect();

  let transactionStarted = false;

  try {
    console.log("\nReading original SQLite database...");

    const sourceRows = new Map<string, Row[]>();

    for (const table of tables) {
      const rows = sqlite
        .prepare(`SELECT * FROM ${quoteIdentifier(table)}`)
        .all() as Row[];

      sourceRows.set(table, rows);
      console.log(`${table}: ${rows.length} source records`);
    }

    const expectedTotal = [...sourceRows.values()].reduce(
      (total, rows) => total + rows.length,
      0
    );

    console.log(`\nTotal source records: ${expectedTotal}`);

    console.log("\nChecking that PostgreSQL is empty...");

    for (const table of tables) {
      const result = await client.query(
        `SELECT COUNT(*) AS total FROM ${quoteIdentifier(table)}`
      );

      if (Number(result.rows[0].total) !== 0) {
        throw new Error(
          `PostgreSQL table ${table} is not empty. Migration stopped.`
        );
      }
    }

    console.log("All nine PostgreSQL tables are empty.");

    await client.query("BEGIN");
    transactionStarted = true;

    console.log("\nStarting migration...");

    for (const table of tables) {
      let rows = sourceRows.get(table) ?? [];

      if (table === "policy_rules") {
        rows = orderPolicyRules(rows);
      }

      await insertRows(client, table, rows);
    }

    console.log("\nVerifying migrated records...");

    let migratedTotal = 0;

    for (const table of tables) {
      const result = await client.query(
        `SELECT COUNT(*) AS total FROM ${quoteIdentifier(table)}`
      );

      const actual = Number(result.rows[0].total);
      const expected = sourceRows.get(table)?.length ?? 0;

      console.log(`${table}: expected ${expected}, found ${actual}`);

      if (actual !== expected) {
        throw new Error(
          `Record count mismatch in ${table}. Expected ${expected}, found ${actual}.`
        );
      }

      migratedTotal += actual;
    }

    if (migratedTotal !== expectedTotal) {
      throw new Error(
        `Total record mismatch. Expected ${expectedTotal}, found ${migratedTotal}.`
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;

    console.log("\n====================================");
    console.log("MIGRATION COMPLETED SUCCESSFULLY");
    console.log(`Total records migrated: ${migratedTotal}`);
    console.log("Original SQLite database was not modified.");
    console.log("====================================\n");
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
      console.error("\nMigration rolled back. PostgreSQL changes were not committed.");
    }

    throw error;
  } finally {
    client.release();
    sqlite.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("\nMIGRATION STOPPED:");
  console.error(error);
  process.exitCode = 1;
});

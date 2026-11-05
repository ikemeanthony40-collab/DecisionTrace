import { app } from "./app.js";
import { testPostgresConnection, pool } from "./db/postgres.js";

const port = Number(process.env.PORT ?? 3001);

async function startServer() {
  try {
    await testPostgresConnection();

    app.listen(port, () => {
      console.log(`DecisionTrace API listening on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to connect to PostgreSQL:", error);
    await pool.end();
    process.exit(1);
  }
}

startServer();
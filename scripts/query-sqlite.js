const sqlite3 = require("sqlite3").verbose();
const path = require("path");

function queryDb(dbPath, name) {
  return new Promise((resolve) => {
    console.log(`\n=================== Inspecting ${name} ===================`);
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        console.error(`Failed to open ${name}:`, err.message);
        return resolve();
      }
    });

    db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
      if (err) {
        console.error("Error reading tables:", err.message);
        db.close();
        return resolve();
      }

      console.log("Tables in database:", tables.map(t => t.name).join(", "));

      // Query from logs if table exists
      const hasLogs = tables.some(t => t.name === "logs" || t.name === "session_logs" || t.name === "events");
      if (hasLogs) {
        const tableName = tables.find(t => t.name === "logs" || t.name === "session_logs" || t.name === "events").name;
        db.all(`SELECT * FROM ${tableName} ORDER BY id DESC LIMIT 2`, [], (err, rows) => {
          if (err) {
            // Try query without ordering by id if id doesn't exist
            db.all(`SELECT * FROM ${tableName} LIMIT 2`, [], (err, rows2) => {
              if (rows2) console.log(`Sample rows from ${tableName}:`, JSON.stringify(rows2, null, 2));
              db.close();
              resolve();
            });
          } else {
            console.log(`Latest 2 rows from ${tableName}:`, JSON.stringify(rows, null, 2));
            db.close();
            resolve();
          }
        });
      } else {
        db.close();
        resolve();
      }
    });
  });
}

async function main() {
  await queryDb(path.join("/Users/Utkarsh/.codex", "state_5.sqlite"), "state_5.sqlite");
  await queryDb(path.join("/Users/Utkarsh/.codex", "logs_2.sqlite"), "logs_2.sqlite");
}

main().catch(console.error);

const fs = require("node:fs");
const postgres = require("postgres");

const env = fs.readFileSync(".env.local", "utf8");
const match = env.match(/DATABASE_URL=(.+)/);
if (!match) {
  console.error("DATABASE_URL not found in .env.local");
  process.exit(1);
}
const url = match[1].trim();
console.log("URL host:", new URL(url).host);

const sql = postgres(url, { connect_timeout: 10, idle_timeout: 5 });
sql`select 1 as ok`
  .then((rows) => {
    console.log("CONNECTED", rows);
    return sql.end();
  })
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ERR", e.message);
    process.exit(1);
  });

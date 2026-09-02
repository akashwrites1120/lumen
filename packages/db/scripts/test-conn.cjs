const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");

const envPath = path.resolve(__dirname, "..", "..", "..", ".env.local");
const env = fs.readFileSync(envPath, "utf8");
const match = env.match(/DATABASE_URL=(.+)/);
if (!match) {
  console.error("DATABASE_URL not found in", envPath);
  process.exit(1);
}
const url = match[1].trim();
console.log("URL host:", new URL(url).host);

const sql = postgres(url, { connect_timeout: 10 });
sql`select 1 as ok`
  .then((rows) => {
    console.log("CONNECTED", rows);
    return sql.end();
  })
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ERR:", e.message);
    process.exit(1);
  });

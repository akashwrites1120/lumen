import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

loadEnv({ path: ".env.local", override: false });

// Some Neon endpoints stall on the SSL handshake with
// `channel_binding=require` in the URL. Strip it for drizzle-kit's
// introspection queries — the actual app connection in createDb still
// uses the full URL, so this is safe.
let dbUrl = process.env.DATABASE_URL ?? "postgres://lumen:lumen@localhost:5432/lumen";
if (dbUrl.includes("channel_binding=require")) {
  dbUrl = dbUrl.replace(/[?&]channel_binding=require/, "");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: dbUrl },
  strict: true,
  verbose: true,
});

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type LumenDb = PostgresJsDatabase<typeof schema>;

export function createDb(url: string): { db: LumenDb; client: postgres.Sql } {
  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return { db: drizzle(client, { schema }), client };
}

export * from "./schema.js";

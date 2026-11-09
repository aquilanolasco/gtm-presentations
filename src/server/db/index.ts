import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// The database is self-hosted Postgres on the same VPS as the app (localhost:5432), so
// queries are a local hop with no cold starts. One pooled connection is created lazily on
// first use and reused; nothing connects during build until a query actually runs.
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Add it to .env.local.");
  const pool = new Pool({
    connectionString: url,
    max: 10,
    // localhost Postgres has no TLS; a managed URL that still asks for SSL keeps working.
    ssl: /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  _db = drizzle(pool, { schema });
  return _db;
}

export const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_, prop: string) {
    return getDb()[prop as keyof ReturnType<typeof getDb>];
  },
});

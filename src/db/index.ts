import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL не задан. Скопируйте .env.example в .env и заполните.');
}

// Next в dev перезагружает модули на каждое изменение — без кэша на globalThis
// пул соединений растёт до отказа Postgres.
const globalForDb = globalThis as unknown as { __sqlClient?: ReturnType<typeof postgres> };

export const sql = globalForDb.__sqlClient ?? postgres(connectionString, { max: 10 });
if (process.env.NODE_ENV !== 'production') globalForDb.__sqlClient = sql;

export const db = drizzle(sql, { schema });
export { schema };

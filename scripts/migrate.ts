/** Применяет миграции из ./drizzle к базе из DATABASE_URL. */
import './env';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL не задан');

  const client = postgres(url, { max: 1 });
  await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  await client.end();
  console.log('Миграции применены.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

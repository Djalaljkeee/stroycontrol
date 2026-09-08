import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import postgres from 'postgres';

if (existsSync('.env')) process.loadEnvFile('.env');

/**
 * Готовит отдельную базу для интеграционных тестов.
 *
 * Тесты проверяют точные числа объекта, поэтому не могут работать на рабочей
 * базе: любой введённый прорабом приход их сломает. Поэтому база создаётся
 * заново, в неё прогоняются миграции и импорт, и проверяется именно результат
 * импорта — без ручного ввода.
 */
export async function prepareTestDatabase(): Promise<string | null> {
  const base = process.env.DATABASE_URL;
  if (!base) return null;

  const url = new URL(base);
  const sourceName = url.pathname.replace(/^\//, '');
  const testName = `${sourceName}_test`;
  url.pathname = `/${testName}`;
  const testUrl = url.toString();

  // CREATE DATABASE не работает внутри транзакции, поэтому отдельное соединение
  // к служебной базе postgres.
  const adminUrl = new URL(base);
  adminUrl.pathname = '/postgres';
  // onnotice глушит NOTICE «database does not exist, skipping» от DROP IF EXISTS.
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists "${testName}"`);
    await admin.unsafe(`create database "${testName}"`);
  } finally {
    await admin.end();
  }

  const env = { ...process.env, DATABASE_URL: testUrl };
  const run = (args: string[]) =>
    execFileSync('npx', ['tsx', ...args], { env, stdio: 'pipe', encoding: 'utf8' });

  run(['scripts/migrate.ts']);
  run(['scripts/import/all.ts']);

  return testUrl;
}

export async function dropTestDatabase(testUrl: string): Promise<void> {
  const url = new URL(testUrl);
  const testName = url.pathname.replace(/^\//, '');
  url.pathname = '/postgres';
  const admin = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists "${testName}"`);
  } finally {
    await admin.end();
  }
}

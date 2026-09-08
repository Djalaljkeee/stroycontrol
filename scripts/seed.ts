/**
 * Создаёт учётные записи пилота. Пароль общий на все учётки и берётся из
 * SEED_PASSWORD — предполагается, что после первого входа его меняют.
 */
import './env';
import bcrypt from 'bcryptjs';
import { db, sql } from '../src/db';
import { users } from '../src/db/schema';

const PILOT_USERS = [
  { login: 'foreman', name: 'Прораб участка', role: 'foreman' },
  { login: 'supply', name: 'Снабжение', role: 'supply' },
  { login: 'estimator', name: 'Инженер-сметчик', role: 'estimator' },
  { login: 'viewer', name: 'Наблюдатель', role: 'viewer' },
];

async function main() {
  const password = process.env.SEED_PASSWORD;
  if (!password) throw new Error('SEED_PASSWORD не задан в .env');
  const passwordHash = await bcrypt.hash(password, 12);

  for (const u of PILOT_USERS) {
    await db
      .insert(users)
      .values({ ...u, passwordHash })
      .onConflictDoUpdate({ target: users.login, set: { name: u.name, role: u.role } });
    console.log(`  ${u.login.padEnd(10)} ${u.name} (${u.role})`);
  }

  console.log(`\nПароль для всех учёток взят из SEED_PASSWORD. Смените его после первого входа.`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end().catch(() => {});
  process.exit(1);
});

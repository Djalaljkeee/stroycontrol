/** Загружает .env для скриптов вне Next (Next читает .env сам). */
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

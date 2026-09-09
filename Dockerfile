# Образ собирается из чекаута репозитория целиком: standalone-вывод Next в
# next.config.ts не включён, поэтому рантайму нужны node_modules. Они же нужны
# для db:migrate / db:seed / import:all — эти скрипты гоняются через tsx.
FROM node:22-bookworm-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# npm ci до копирования исходников: слой с зависимостями переиспользуется,
# пока не менялся package-lock.json.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# src/db/index.ts бросает исключение на импорте без DATABASE_URL, а сборка эти
# модули импортирует. Реального обращения к базе на сборке нет: все страницы с
# данными помечены force-dynamic. Значение — заглушка, в рантайме придёт из .env.
ENV DATABASE_URL=postgres://build:build@127.0.0.1:5432/build
# Потолок кучи — под небольшую VPS: без него сборка на 2 vCPU / 4 ГБ уходит
# в своп и тянет за собой соседние сервисы.
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN npm run build

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NODE_OPTIONS=""
EXPOSE 3000
CMD ["npm", "run", "start"]

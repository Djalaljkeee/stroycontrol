#!/usr/bin/env bash
# Обновление развёрнутого пилота: подтянуть коммиты, пересобрать образ,
# накатить миграции, перезапустить приложение.
#
# Импорт исходных данных (import:all) здесь НЕ вызывается намеренно: он
# идемпотентен, но пересоздаёт записи с source = ks6a / prihody, поэтому
# запускается руками после нового ДС или выпуска КЖ:
#   docker compose run --rm app npm run import:all
set -euo pipefail

cd "$(dirname "$0")/.."

git pull --ff-only
docker compose build app
docker compose run --rm app npm run db:migrate
docker compose up -d app
docker compose ps

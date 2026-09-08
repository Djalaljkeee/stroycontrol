#!/usr/bin/env bash
# Локальный кластер Postgres для разработки и проверки пилота.
# Не требует docker: используется initdb из системного пакета postgresql-16.
# В проде вместо этого — обычный сервер Postgres, строка подключения в DATABASE_URL.
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-$(pwd)/.pgdata}"
PGPORT="${PGPORT:-5433}"
PGUSER_NAME="${PGUSER_NAME:-stroycontrol}"
PGDB="${PGDB:-stroycontrol}"

# Postgres отказывается работать под root. Если скрипт запущен от root
# (типично для контейнера), всё, что трогает кластер, выполняется от системного
# пользователя postgres; на обычной машине этот слой ничего не меняет.
if [ "$(id -u)" = "0" ]; then
  RUNAS="setpriv --reuid=postgres --regid=postgres --init-groups --"
  mkdir -p "$PGDATA"
  chown -R postgres:postgres "$PGDATA"
else
  RUNAS=""
fi

case "${1:-up}" in
  up)
    if [ ! -s "$PGDATA/PG_VERSION" ]; then
      echo "==> initdb $PGDATA"
      $RUNAS "$PGBIN/initdb" -D "$PGDATA" -U "$PGUSER_NAME" --auth=trust >/dev/null
    fi
    if $RUNAS "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
      echo "==> Postgres уже запущен на порту $PGPORT"
    else
      echo "==> Запуск Postgres на порту $PGPORT"
      $RUNAS "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PGPORT -k /tmp" -l "$PGDATA/server.log" start
    fi
    if ! $RUNAS "$PGBIN/psql" -h localhost -p "$PGPORT" -U "$PGUSER_NAME" -lqt postgres | cut -d '|' -f1 | grep -qw "$PGDB"; then
      echo "==> Создание базы $PGDB"
      $RUNAS "$PGBIN/createdb" -h localhost -p "$PGPORT" -U "$PGUSER_NAME" "$PGDB"
    fi
    echo "==> DATABASE_URL=postgres://$PGUSER_NAME@localhost:$PGPORT/$PGDB"
    ;;
  down)
    $RUNAS "$PGBIN/pg_ctl" -D "$PGDATA" stop || true
    ;;
  *)
    echo "usage: pg-local.sh [up|down]" >&2
    exit 1
    ;;
esac

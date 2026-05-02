#!/usr/bin/env sh
set -eu

APP_HOME="${PHIRA_MP_HOME:-/app}"
export PHIRA_MP_HOME="$APP_HOME"
cd "$APP_HOME"

CONFIG_PATH="$APP_HOME/server_config.yml"

if [ -n "${SERVER_CONFIG_YAML:-}" ]; then
  printf "%s\n" "$SERVER_CONFIG_YAML" > "$CONFIG_PATH"
else
  if [ ! -f "$CONFIG_PATH" ]; then
    HOST_VALUE="${HOST:-::}"
    PORT_VALUE="${PORT:-12346}"
    HTTP_SERVICE_VALUE="${HTTP_SERVICE:-false}"
    HTTP_PORT_VALUE="${HTTP_PORT:-12347}"
    ROOM_MAX_USERS_VALUE="${ROOM_MAX_USERS:-8}"
    SERVER_NAME_VALUE="${SERVER_NAME:-}"

    {
      printf "HOST: \"%s\"\n" "$HOST_VALUE"
      printf "PORT: %s\n" "$PORT_VALUE"
      printf "HTTP_SERVICE: %s\n" "$HTTP_SERVICE_VALUE"
      printf "HTTP_PORT: %s\n" "$HTTP_PORT_VALUE"
      printf "ROOM_MAX_USERS: %s\n" "$ROOM_MAX_USERS_VALUE"

      if [ -n "${MONITORS:-}" ]; then
        printf "MONITORS:\n"
        old_ifs="${IFS}"
        IFS=",; "
        for m in $MONITORS; do
          m2="$(printf "%s" "$m" | tr -d "\t\r\n" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
          if [ -n "$m2" ]; then
            printf "  - %s\n" "$m2"
          fi
        done
        IFS="${old_ifs}"
      else
        printf "MONITORS:\n  - 2\n"
      fi

      if [ -n "$SERVER_NAME_VALUE" ]; then
        printf "SERVER_NAME: \"%s\"\n" "$SERVER_NAME_VALUE"
      fi
    } > "$CONFIG_PATH"
  fi
fi

if [ "${1:-}" = "node" ] && ! command -v node >/dev/null 2>&1 && [ -x "$APP_HOME/phira-mp-server" ]; then
  exec "$APP_HOME/phira-mp-server"
fi

exec "$@"

#!/usr/bin/env bash
# Rauchtest für das NAKLearn-Image: startet einen Container mit leerem Volume und prüft Grundfunktionen.
#   scripts/smoke-image.sh luna1506/naklearn:latest
set -euo pipefail
IMAGE="${1:?Image angeben}"
NAME="naklearn-smoke-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker volume create "$NAME" >/dev/null
docker run -d --name "$NAME" -e NAKLEARN_PASSWORD=smoke-pass -p 127.0.0.1::8742 -v "$NAME:/data" "$IMAGE" >/dev/null
PORT="$(docker port "$NAME" 8742/tcp | head -1 | sed 's/.*://')"
BASE="http://127.0.0.1:$PORT"

for i in $(seq 1 30); do
  curl -fsS "$BASE/api/health" >/dev/null 2>&1 && break
  [ "$i" = 30 ] && { echo "Server antwortet nicht"; docker logs "$NAME"; exit 1; }
  sleep 1
done

check() { if [ "$2" != "$3" ]; then echo "FEHLER: $1 (erwartet $3, bekommen $2)"; docker logs "$NAME"; exit 1; fi; echo "ok: $1"; }
check "health" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health")" 200
check "web-client" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")" 200
check "api ohne login" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/overview")" 401
check "login falsch" "$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{"name":"luna","password":"x"}' "$BASE/api/login")" 401
check "login richtig" "$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d '{"name":"luna","password":"smoke-pass"}' "$BASE/api/login")" 200
docker exec "$NAME" pdftoppm -v >/dev/null 2>&1 && echo "ok: pdftoppm" || { echo "FEHLER: pdftoppm fehlt"; exit 1; }
docker exec "$NAME" claude --version && echo "ok: claude" || { echo "FEHLER: claude fehlt"; exit 1; }
docker exec "$NAME" test -e /data/naklearn.db && echo "ok: /data beschreibbar" || { echo "FEHLER: keine Datenbank in /data"; exit 1; }
echo "Rauchtest bestanden"

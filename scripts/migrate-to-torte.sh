#!/usr/bin/env bash
# Einmaliger Umzug der Laptop-Daten nach torte (Spec §8). Überschreibt nie eine vorhandene Datenbank.
set -euo pipefail
SRC="${NAKLEARN_DATA_DIR:-$HOME/.local/share/naklearn}"
HOST="${TORTE_HOST:-torte}"
VOLUME=naklearn_naklearn_data
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Karten je Modul als JSON (läuft lokal und im Container mit node:sqlite)
COUNT_JS='const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1],{readOnly:true});console.log(JSON.stringify(db.prepare("SELECT m.name AS name, COUNT(c.id) AS cards FROM module m LEFT JOIN deck d ON d.module_id=m.id LEFT JOIN note n ON n.deck_id=d.id LEFT JOIN card c ON c.note_id=n.id GROUP BY m.id ORDER BY m.name").all()))'

echo "→ Prüfe torte"
ssh "$HOST" 'test -f ~/naklearn/docker-compose.yml && test -f ~/naklearn/.env' \
  || { echo "~/naklearn/docker-compose.yml oder .env fehlt auf $HOST"; exit 1; }
ssh "$HOST" 'cd ~/naklearn && docker compose create --pull missing >/dev/null'
if ssh "$HOST" "docker run --rm -v $VOLUME:/data busybox test -e /data/naklearn.db"; then
  echo "Auf $HOST liegt schon eine naklearn.db im Volume – Abbruch, nichts überschrieben."
  exit 1
fi

echo "→ Stoppe und deaktiviere den Laptop-Dienst"
# deaktivieren, damit er nach Neustart/Login nicht wieder Lernstände annimmt, die torte nie erreichen
if systemctl --user cat naklearn >/dev/null 2>&1; then
  systemctl --user disable --now naklearn
fi
if systemctl --user is-active --quiet naklearn; then
  echo "Der Laptop-Dienst naklearn läuft noch – Abbruch, nichts übertragen."
  exit 1
fi
BEFORE="$(node -e "$COUNT_JS" "$SRC/naklearn.db")"
node -e 'const {DatabaseSync}=require("node:sqlite");new DatabaseSync(process.argv[1]).prepare("VACUUM INTO ?").run(process.argv[2])' "$SRC/naklearn.db" "$STAGE/naklearn.db"

echo "→ Übertrage Daten"
tar -cf - -C "$SRC" config.json slides pdfs backups -C "$STAGE" naklearn.db \
  | ssh "$HOST" "docker run --rm -i -v $VOLUME:/data busybox sh -c 'tar -xf - -C /data && chown -R 1000:1000 /data'"

echo "→ Starte NAKLearn auf torte"
ssh "$HOST" 'cd ~/naklearn && docker compose up -d'
for i in $(seq 1 30); do
  ssh "$HOST" "docker exec naklearn node -e \"fetch('http://127.0.0.1:8742/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))\"" && break
  [ "$i" = 30 ] && { echo "Server auf torte antwortet nicht"; ssh "$HOST" 'docker logs --tail 50 naklearn'; exit 1; }
  sleep 2
done

AFTER="$(ssh "$HOST" "docker exec naklearn node -e '$COUNT_JS' /data/naklearn.db")"
echo "Laptop: $BEFORE"
echo "torte:  $AFTER"
[ "$BEFORE" = "$AFTER" ] && echo "Umzug fertig – Kartenzahlen stimmen." || { echo "Kartenzahlen weichen ab!"; exit 1; }
echo "Hinweis: Laptop-Dienst ist deaktiviert; Daten unter $SRC bleiben als Sicherung liegen."
echo "Ab jetzt nur noch auf https://naklearn.torte-tech.de lernen; das Handy erst nach dem Neu-Koppeln benutzen."

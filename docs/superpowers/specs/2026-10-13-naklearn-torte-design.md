# NAKLearn auf torte – Design

Stand: 2026-10-13

## 1. Ziel

NAKLearn läuft nicht mehr als Home-Manager-Dienst auf dem Laptop (erreichbar fürs
Handy über Tailscale), sondern als Docker-Container auf Lunas Server **torte**
unter **`https://naklearn.torte-tech.de`**. Studio (Web) und Sync-API sind von
überall erreichbar; die Android-App synchronisiert immer mit torte. Die APK kommt
weiterhin über GitHub Releases (Obtainium).

### Erfolgskriterien
- `https://naklearn.torte-tech.de` zeigt eine Login-Seite; nach Anmeldung das
  Studio mit allen bisherigen Daten (Cloud Security: 222 Karten, Lernstand).
- Kartenerzeugung (PDF → Folienbilder → Sonnet-Zusammenfassung → Opus-Karten)
  läuft auf torte mit Lunas Claude-Abo.
- Handy per QR gekoppelt, lernt offline, synchronisiert mit torte.
- Push auf `main` baut, testet und deployt automatisch.
- Laptop hat keinen NAKLearn-Dienst und kein Tailscale mehr.

### Getroffene Entscheidungen
| Frage | Entscheidung |
|---|---|
| Wo läuft die Erzeugung? | Alles auf torte, `claude`-CLI im Container mit `CLAUDE_CODE_OAUTH_TOKEN` |
| Login | Eigenes Passwort-Login mit signiertem Sitzungs-Cookie; App behält Bearer-Token per QR |
| Domain | `naklearn.torte-tech.de` über bestehenden Nginx Proxy Manager |
| Deploy | Wie die anderen torte-Projekte: GitHub Actions → Docker Hub `luna1506/naklearn` (öffentlich) → SSH `docker compose pull && up -d` |
| Image-Tags | `latest` + Commit-SHA; kein automatisches Versions-Tagging (Tags `v0.x.y` gehören den APK-Releases) |

### Nicht Teil dieses Umbaus
Mehrere Nutzer, Off-Site-Backups, Upload aus der App, Änderungen an Lernlogik
oder Kartenerzeugung.

## 2. Umgebung torte (Ist)

Ubuntu 24.04, x86_64, 2 Kerne, 3,7 GB RAM (~1,9 GB frei), Docker. Nginx Proxy
Manager (`jc21/nginx-proxy-manager`) auf 80/443/81 im Docker-Netzwerk `proxy`,
Let's Encrypt. Bestehende Projekte liegen je in `~/<projekt>/docker-compose.yml`
und hängen mit ihren öffentlichen Diensten im Netzwerk `proxy`.

## 3. Image `luna1506/naklearn`

`Dockerfile` im Repo-Root, mehrstufig:

1. **build:** `node:24-bookworm-slim`, `npm ci`, `npm run build` (Web-Client nach
   `apps/client/dist`).
2. **runtime:** `node:24-bookworm-slim` + `poppler-utils` + `@anthropic-ai/claude-code`
   (feste Version, global per npm). Enthält Produktions-Abhängigkeiten, die
   Server-Quellen (Node führt TypeScript direkt aus, wie `npm start` heute) und
   den gebauten Web-Client. Läuft als Benutzer `node` (UID 1000).

Umgebung im Image: `NAKLEARN_DATA_DIR=/data`, `NAKLEARN_PORT=8742`,
`NAKLEARN_HOST=0.0.0.0`, `NAKLEARN_CLAUDE=claude` (aus `PATH`),
`HOME=/home/node` (beschreibbar, für die CLI-Konfiguration). `EXPOSE 8742`,
`VOLUME /data`. Ein `HEALTHCHECK` ruft einen ungeschützten Endpunkt
`GET /api/health` (→ `{ok:true}`) auf.

`.dockerignore`: `node_modules`, `dist`, `result`, `.devdata`, `apps/client/android`,
`docs`, `.git`.

## 4. Betrieb auf torte

`~/naklearn/docker-compose.yml` (liegt als `deploy/docker-compose.yml` im Repo,
wird beim ersten Einrichten kopiert):

```yaml
services:
  naklearn:
    image: luna1506/naklearn:latest
    container_name: naklearn
    restart: unless-stopped
    env_file: .env
    environment:
      NAKLEARN_PUBLIC_URL: https://naklearn.torte-tech.de
    volumes:
      - naklearn_data:/data
    networks:
      - proxy
volumes:
  naklearn_data:
networks:
  proxy:
    external: true
```

`~/naklearn/.env` (Modus 600, nicht im Repo):
`NAKLEARN_PASSWORD=…`, `CLAUDE_CODE_OAUTH_TOKEN=…`; optional
`NAKLEARN_SUMMARY_MODEL`, `NAKLEARN_CARDS_MODEL` (Standard sonnet/opus wie heute).

Kein Port nach außen; Nginx Proxy Manager: Proxy-Host `naklearn.torte-tech.de` →
`naklearn:8742`, SSL per Let's Encrypt, „Force SSL“, Websockets aus. DNS-A-Record
`naklearn.torte-tech.de → 46.225.100.182`. Upload-Grenze: NPM-Standard
(`client_max_body_size` 1m) reicht für PDFs nicht – im Proxy-Host unter
„Advanced“ `client_max_body_size 200m;` setzen.

Backups: unverändert täglich `VACUUM INTO /data/backups/…`, die letzten 7 bleiben.
Job-Wiederaufnahme nach Neustart: unverändert.

## 5. Login und Sicherheit

### Server-Konfiguration
- `NAKLEARN_PASSWORD` Pflicht; fehlt sie, bricht `loadConfig` mit klarer Meldung ab.
- `config.json` bekommt zusätzlich `sessionSecret` (32 Zufallsbytes, wird wie
  `token` beim ersten Start erzeugt).
- `NAKLEARN_PUBLIC_URL` Pflicht für Koppeln (ohne sie liefert `/api/pair`
  `url: null` und die Seite sagt das).

### Authentifizierung (onRequest-Hook)
Die Loopback-Ausnahme entfällt. Ungeschützt sind nur: statische Dateien des
Web-Clients, `POST /api/login`, `GET /api/health`. Jede andere `/api/*`-Anfrage
braucht eins von:
- `Authorization: Bearer <token>` (App), oder
- gültiges Sitzungs-Cookie `naklearn_session` (Browser).

Sonst `401 {error:'unauthorized'}`. Die CSRF-Prüfung (fremde `Origin` bei
schreibenden Requests → 403) bleibt.

### Sitzung
`POST /api/login {password}`: zeitkonstanter Vergleich (`timingSafeEqual` über
SHA-256 beider Werte). Erfolg → Cookie `naklearn_session=<ablauf>.<hmac>` mit
`HMAC-SHA256(sessionSecret, ablauf)`, Ablauf 30 Tage, `HttpOnly; Secure;
SameSite=Lax; Path=/`. Prüfung: HMAC stimmt und Ablauf in der Zukunft.
`POST /api/logout` löscht das Cookie. Token neu erzeugen ändert das
`sessionSecret` nicht. (`Secure` wird nur gesetzt, wenn die Anfrage per HTTPS
kam – laut `X-Forwarded-Proto` –, damit `npm run dev` über http funktioniert.)

### Bremse gegen Durchprobieren
Pro Client-IP höchstens 5 Fehlversuche; danach 15 Minuten lang `429` auf
`/api/login`. Zähler im Speicher (Map, abgelaufene Einträge werden beim Zugriff
entfernt). Fastify `trustProxy: true`, damit `req.ip` die echte IP aus
`X-Forwarded-For` ist (der Container ist nur über den Proxy erreichbar).

### Koppeln
- `GET /api/pair` (Sitzung nötig): `{url, token, payload, qrSvg}`, `url` aus
  `NAKLEARN_PUBLIC_URL`. `detectPublicUrl`/Tailscale-Erkennung entfällt.
- `POST /api/pair/rotate` (nur mit Sitzung, nicht per Bearer): neues Token in
  `config.json`, alte App-Kopplungen werden ungültig (App zeigt dann
  „nicht gekoppelt / 401“ wie bisher bei falschem Token).

### Web-Client
`api.ts` wirft bei 401 einen eigenen Fehlertyp; die App-Hülle zeigt dann die
Login-Seite (Passwortfeld, Fehlermeldung bei falschem Passwort bzw. Sperre).
Nach erfolgreichem Login lädt die aktuelle Seite neu. In den Einstellungen
„Abmelden“; auf der Koppeln-Seite „Token neu erzeugen“ (mit Rückfrage).
Die Android-App (Capacitor, `LocalDataSource`) ist von alldem nicht betroffen.

## 6. Kartenerzeugung im Container

`claude -p` wird wie bisher gestartet; die CLI liest `CLAUDE_CODE_OAUTH_TOKEN`.
Die Meldung bei Login-Fehler wird zu: „Claude-Token ungültig oder abgelaufen –
am Laptop `claude setup-token` ausführen, Token in `~/naklearn/.env` auf torte
eintragen, `docker compose up -d`, dann ‚Fortsetzen‘.“ Weiterhin nur ein Job
gleichzeitig. `pdftoppm` kommt aus `poppler-utils` im Image.

## 7. CI/CD (`.github/workflows/deploy.yml`)

Auslöser: Push auf `main`, `workflow_dispatch`. Ein Job auf `ubuntu-latest`:

1. Checkout, Node 24, `npm ci`, `npm test` (mit `TZ=Asia/Seoul` wie lokal),
   `npm run typecheck`.
2. Docker Buildx, Login Docker Hub (`DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`).
3. Image bauen (`load: true`), **Rauchtest**: Container mit
   `NAKLEARN_PASSWORD=test` starten, `GET /api/health` → 200,
   `POST /api/login` mit falschem Passwort → 401, `docker exec … pdftoppm -v`
   und `claude --version` laufen.
4. Push `luna1506/naklearn:latest` und `:${{ github.sha }}`.
5. Deploy per `appleboy/ssh-action` (`SSH_HOST`, `SSH_USER`, `SSH_KEY`,
   `SSH_PORT`): `cd ~/naklearn && docker compose pull && docker compose up -d`.

`concurrency: deploy-main`. Die Secrets trägt Luna im Repo `Luna1506/naklearn`
ein (wie bei ToolboxOfRandomToolsAndExperiments).

## 8. Einmaliger Umzug (`scripts/migrate-to-torte.sh`)

Voraussetzung: Image einmal gepusht, `~/naklearn/{docker-compose.yml,.env}` auf
torte vorhanden, Container noch nicht gestartet (oder gestoppt).

1. `systemctl --user stop naklearn` am Laptop.
2. `tar` aus `~/.local/share/naklearn`: `naklearn.db` (nach dem Stopp ist die
   WAL leer bzw. wird vorher per `VACUUM INTO` in eine konsistente Kopie
   geschrieben), `config.json`, `slides/`, `pdfs/`, `backups/`.
3. Per `ssh torte` streamen und mit einem Hilfscontainer
   (`docker run --rm -i -v naklearn_naklearn_data:/data busybox`) entpacken,
   `chown -R 1000:1000 /data`.
4. `docker compose up -d`, warten bis `/api/health` antwortet.
5. Prüfung per `docker exec`: Kartenzahl je Modul gleich wie vorher am Laptop
   (Skript gibt beide Zahlen aus).

Das Skript bricht ab, wenn das Volume auf torte schon eine `naklearn.db`
enthält (kein versehentliches Überschreiben). `config.json` zieht mit um;
`token` und `deviceId` bleiben damit gleich.

## 9. Android-App

- `network_security_config.xml`: `ts.net`-Ausnahme entfernen (nur noch HTTPS;
  `10.0.2.2` für den Emulator bleibt).
- Sonst keine Logikänderung; QR-Code enthält `https://naklearn.torte-tech.de`.
- Neue Version **v0.2.0** per `npm run release` (minor).

## 10. Laptop aufräumen

- NAKLearn-Repo: Home-Manager-Modul und Paket im `flake.nix` bleiben vorerst
  (Dev-Shell wird weiter gebraucht); `homeManagerModules` darf bleiben,
  wird aber nicht mehr importiert.
- Dotfiles: `home/luna/modules/naklearn` und Flake-Input `naklearn` entfernen;
  zusammen mit der bereits gestagten Entfernung von Tailscale/Firewall aus
  `modules/networking.nix` committen. Luna führt `rebuild` aus.
- Lokale Daten `~/.local/share/naklearn` bleiben als zusätzliche Sicherung liegen.

## 11. Tests

- **server (Vitest):**
  - Start ohne `NAKLEARN_PASSWORD` → Fehler.
  - Ohne Cookie/Token → 401; mit Bearer → 200; mit gültigem Cookie → 200;
    abgelaufenes oder manipuliertes Cookie → 401.
  - Login falsch → 401; 5× falsch → 6. Versuch 429 (auch mit richtigem Passwort);
    andere IP nicht betroffen; nach 15 min (Fake-Uhr) wieder möglich.
  - Logout löscht das Cookie.
  - `/api/health` und statische Dateien ohne Login.
  - `/api/pair` nur mit Sitzung, URL aus `NAKLEARN_PUBLIC_URL`;
    `/api/pair/rotate` mit Bearer → 401, mit Sitzung → neues Token, altes
    Token → 401.
  - Bestehende Tests, die auf die Loopback-Ausnahme bauen, nutzen künftig
    Token oder Cookie.
- **client:** 401 → Login-Seite; erfolgreicher Login lädt neu.
- **CI-Rauchtest** des Images (Abschnitt 7).
- **Abnahme:**
  1. `https://naklearn.torte-tech.de` → Login → Übersicht mit denselben Zahlen.
  2. Einen zurückgestellten UI/UX-Foliensatz auf torte erzeugen lassen.
  3. APK v0.2.0 per Obtainium, Studio → „Handy koppeln“ → QR scannen.
  4. Flugmodus: lernen, Rückgängig, Karte bearbeiten → Flugmodus aus → Sync;
     Studio zeigt dieselbe Zahl „Heute gelernt“ und die geänderte Karte.

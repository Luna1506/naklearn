# NAKLearn

Lernkarten aus Foliensätzen (NORDAKADEMIE). Server mit Web-Client: https://naklearn.torte-tech.de,
Android-App über die GitHub-Releases (Obtainium), iPhone-App über SideStore (unten).

Entwicklung: `nix develop -c npm test`, Android-Release: `nix develop -c npm run release [patch|minor]`.
Zu jedem Release baut `.github/workflows/ios.yml` eine unsignierte `NAKLearn-<version>.ipa`, hängt sie an das Release
und veröffentlicht sie samt SideStore-Quelle unter https://naklearn.torte-tech.de/ios/source.json
(von Hand: Actions → „iOS (SideStore)“ → Run workflow).

## iPhone-App mit SideStore (kostenlose Apple-ID)

Einmalig, vom Linux-PC aus (offizielle Anleitung: https://docs.sidestore.io/docs/installation/prerequisites):

1. Auf dem iPhone **LocalDevVPN** aus dem App Store installieren, öffnen und „Connect“ (VPN-Konfiguration erlauben).
2. Am PC `usbmuxd` installieren (NixOS: `services.usbmuxd.enable = true;`) und **iloader** von
   https://github.com/nab138/iloader/releases/latest herunterladen (AppImage: `chmod +x` und starten,
   auf NixOS z. B. mit `appimage-run`).
3. iPhone per USB anschließen, „Vertrauen“ und Code eingeben. In iloader mit der Apple-ID anmelden
   (Groß-/Kleinschreibung beachten), Gerät wählen, **„Install SideStore (Stable)“**.
   Wird das iPhone nicht erkannt: `usbmuxd` stoppen und in einem eigenen Terminal `sudo usbmuxd -v -f` starten.
4. Auf dem iPhone: Einstellungen → Allgemein → VPN & Geräteverwaltung → Apple-ID → „Vertrauen“;
   Einstellungen → Datenschutz & Sicherheit → **Entwicklermodus** an (Neustart).
5. LocalDevVPN verbinden, SideStore öffnen, mit derselben Apple-ID anmelden, unter „My Apps“ auf den
   „7 DAYS“-Zähler bei SideStore tippen (Zertifikat-Frage mit „Yes“/„Refresh Now“ bestätigen).

NAKLearn installieren:

- SideStore → **Sources** → „+“ → `https://naklearn.torte-tech.de/ios/source.json` → NAKLearn → Installieren.
  Updates erscheinen nach jedem Release automatisch in SideStore.
- Ohne Quelle geht es auch: die `NAKLearn-<version>.ipa` aus dem GitHub-Release in Safari herunterladen
  (bei GitHub angemeldet, das Repo ist privat) und in SideStore unter „My Apps“ → „+“ importieren.
- In der App mit Name und Passwort anmelden (Server: https://naklearn.torte-tech.de).

Wichtig bei kostenloser Apple-ID:

- **Alle 7 Tage auffrischen**: Apps mit kostenloser Apple-ID laufen nach 7 Tagen ab. In SideStore bei
  verbundenem LocalDevVPN und WLAN auf den Tage-Zähler tippen (oder „Refresh All“) – das geht ohne PC.
  Abgelaufen startet die App nicht mehr; nach dem Auffrischen sind die Daten noch da.
- **Höchstens 3 Apps** gleichzeitig, SideStore zählt mit – also nur 2 weitere Apps (dazu max. 10 App-IDs pro Woche).
- Läuft die Kopplung (Pairing-Datei) einmal ab, SideStore mit iloader neu einrichten
  (https://docs.sidestore.io).

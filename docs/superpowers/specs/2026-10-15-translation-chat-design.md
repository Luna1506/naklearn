# Deutsche Übersetzung und KI-Chat pro Karte

Stand: 2026-10-15 · freigegeben von Luna im Chat

## Ziel

Jede Karte englischsprachiger Module ist zusätzlich auf Deutsch lesbar (Studio und App, offline), und zu jeder Karte
kann man einem KI-Agenten Fragen stellen. Beides läuft über Lunas Claude-Account (das OAuth-Token des Servers).
Usage sparsam, bestehende Karten bleiben unverändert.

## Entscheidungen

- Übersetzung vorab im Hintergrund (Sonnet, ein Aufruf pro Foliensatz), nicht bei Bedarf.
- Chat für alle Mitglieder, Modell Sonnet, Verlauf nur für die offene Karte (nichts gespeichert).

## Daten und Sync

- `note.front_de`, `note.back_de` (TEXT, NULL = nicht übersetzt), neue Kernmigration für Server und Handy.
  Dieselbe Migration löscht `meta.sync_cursor` (nur auf dem Handy vorhanden): Ein Handy, das vorher mit einer alten App
  synchronisiert hat, lädt beim Update alle Notes neu und bekommt so auch schon geschriebene Übersetzungen.
- `Note` bekommt `frontDe`/`backDe` (`string | null`), das Sync-Schema akzeptiert sie optional (alte Apps senden sie nicht).
- Übersetzungen schreibt nur der Server. Gepushte `frontDe`/`backDe` ignoriert er; ändert ein Push oder eine
  Studio-Bearbeitung `front` oder `back`, setzt er beide auf NULL. Das Handy leert sie bei lokaler Bearbeitung ebenfalls.
- Das Schreiben einer Übersetzung vergibt eine neue `seq`, ändert `updated_at` aber nicht (kein LWW-Konflikt mit echten
  Bearbeitungen). Geschrieben wird nur, wenn `front`/`back` noch dem übersetzten Text entsprechen.

## Übersetzungs-Job

- Job-Art `translate` pro Foliensatz, Modell = Zusammenfassungsmodell (Sonnet). Eingabe: alle nicht gelöschten Notes
  des Foliensatzes ohne Übersetzung, durchnummeriert (Art, Vorder-, Rückseite). Ausgabe `{items: [{n, front, back}]}`.
- Regeln: Markdown und `{{cN::…}}`-Marker erhalten, Fachbegriff beim ersten Vorkommen mit englischem Original in Klammern.
- Prüfung: Bei Lückentexten müssen die Lücken-Nummern übereinstimmen, sonst wird das Item verworfen. Unbekannte `n`
  werden ignoriert.
- Module mit Sprache `de` werden nie übersetzt.
- Anstoßen (`enqueueMissingTranslations`): beim Start des Workers und wenn er untätig ist (höchstens einmal pro Minute).
  Ein Foliensatz bekommt einen Job, wenn er eine Note ohne Übersetzung hat, deren `updated_at` nach dem letzten
  `translate`-Job dieses Foliensatzes liegt (oder es noch keinen gab), und kein `translate`-Job wartet oder läuft.
  Dadurch werden verworfene Items und fehlgeschlagene Jobs nicht endlos wiederholt; „Erneut versuchen“ im Studio bleibt.
- Der Status des Foliensatzes ändert sich durch den Job nicht.

## Lernansicht

- `StudyCard` bekommt `frontDe`/`backDe` (gerendert wie `front`/`back`, bei Lückentexten mit derselben Lücke) oder null.
- Umschalter „EN/DE“ in der Kartenkopfzeile; Wahl im `localStorage` gemerkt. Ohne Übersetzung deaktiviert mit Titel
  „Übersetzung folgt“. Taste `t` schaltet um.

## KI-Chat

- `POST /api/cards/:id/ask` mit `{messages: [{role: 'user'|'assistant', content}]}`, letzte Nachricht vom Nutzer.
  Max. 20 Nachrichten, je max. 2000 Zeichen (Antworten max. 8000). Jedes angemeldete Konto (Cookie oder Geräte-Token),
  wie bei den übrigen Karten-Routen.
- Prompt: Modul, Foliensatz, Karte im Original (rohe Note) und auf Deutsch, Text der referenzierten Folien,
  Verlauf. Claude darf die Bilder der referenzierten Folien mit Read öffnen. Antwort auf Deutsch, knapp, Markdown.
- `RunClaude` bekommt einen Textmodus (ohne JSON-Schema → `result` als Text).
- Höchstens 2 gleichzeitige Chat-Aufrufe (sonst 429 „Gerade beschäftigt“), unabhängig von der Job-Warteschlange.
- Fehler: Auth → 503 mit Hinweis aufs Token, Rate-Limit → 429 mit Hinweis, sonst 502.
- `StudyDataSource.ask(cardId, messages)`: Studio per HTTP, App per Fetch mit Geräte-Token (Hinweis bei fehlender Verbindung).
- UI: „Frage stellen“ (Taste `f`) öffnet unter der Karte ein Chatfeld; Verlauf wird beim Kartenwechsel verworfen.

## Tests

Migration und Sync-Rundreise mit Übersetzung; Leeren bei Bearbeitung (Studio, Push, Handy); Übersetzungs-Job (nur
fehlende, Lückenprüfung, Guard bei paralleler Bearbeitung, kein Neu-Anstoßen ohne Änderung, `de` übersprungen);
Chat-Endpunkt mit Stub (Anmeldung, Prompt-Inhalt, Grenzen, Parallelitätsgrenze, Fehlerabbildung); Textmodus des Runners.

## Auslieferung

Push auf `main` (CI deployt, Übersetzung startet selbst), App-Release v0.4.0.

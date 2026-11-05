# Verbrauchsleiste für Claude Code

Zeigt dauerhaft direkt über dem Eingabefeld eine Zeile mit dem aktuellen Verbrauch:

`Kontext 13% (127k/1000k)  ·  Alle Modelle 15% (in 6 T 20 Std)  ·  Fable 25% (in 6 T 20 Std)  ·  Sitzung $0.66`

- **Kontext:** wie voll das Kontextfenster der aktuellen Sitzung ist
- **Alle Modelle / Fable / 5 Std.:** Nutzungslimits des Plans, genau die Zeilen der Einstellungsseite (auch pro Modell), mit Zeit bis zum Zurücksetzen; alle 5 Min und nach jeder Antwort neu abgerufen. Farbe nach der Einstufung des Servers.
- **Sitzung:** bisherige Kosten der Sitzung
- `/verbrauch-rohdaten` zeigt den Aufbau der Limit-Daten (nur Namen und Zahlen) für die Fehlersuche

## Installation

Im Eingabefeld einer Claude-Code-Sitzung:

```
/plugin install verbrauch-leiste --marketplace AC30002025/verbrauch-leiste
```

Die Frage nach dem Marketplace mit `y` bestätigen, dann den Bereich wählen (für alle Projekte: „user“).

Aus der Shell:

```bash
claude plugin install verbrauch-leiste --marketplace AC30002025/verbrauch-leiste
```

Update auf eine neue Version:

```bash
claude plugin marketplace update verbrauch-leiste
claude plugin update verbrauch-leiste@verbrauch-leiste
```

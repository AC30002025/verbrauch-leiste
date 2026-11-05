# Verbrauchsleiste für Claude Code

Zeigt dauerhaft direkt über dem Eingabefeld eine Zeile mit dem aktuellen Verbrauch:

`Kontext 34% (68k/200k)  ·  5 Std. 41% (in 2 Std 13 Min)  ·  7 Tage 18% (in 4 Tagen)  ·  Sitzung $1.87`

- **Kontext:** wie voll das Kontextfenster der aktuellen Sitzung ist
- **5 Std. / 7 Tage:** Auslastung der Abo-Limits, mit Zeit bis zum Zurücksetzen
- **Sitzung:** bisherige Kosten der Sitzung
- ab 70 % gelb, ab 90 % rot; aktualisiert sich nach jeder Antwort

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

Das Repo ist privat: auf dem Rechner muss GitHub angemeldet sein (z. B. `gh auth login`).

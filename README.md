# Verbrauchsleiste für Claude Code

Zeigt dauerhaft direkt über dem Eingabefeld eine Zeile mit dem aktuellen Verbrauch:

`Kontext 13% (127k/1000k)  ·  Alle Modelle 15% (in 6 T 20 Std)  ·  Fable 25% (in 6 T 20 Std)  ·  Sitzung $0.66`

- **Kontext:** wie voll das Kontextfenster der aktuellen Sitzung ist
- **5 Std. / Alle Modelle / Fable …:** Nutzungslimits des Plans wie unter Einstellungen → Nutzung, auch pro Modell, mit Zeit bis zum Zurücksetzen (alle 5 Min und nach jeder Antwort neu abgerufen)
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

Update auf eine neue Version:

```bash
claude plugin marketplace update verbrauch-leiste
claude plugin update verbrauch-leiste@verbrauch-leiste
```

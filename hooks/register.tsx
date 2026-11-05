import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit, SessionCost } from 'claude-code'

import type { Limit, Verbrauch } from '../types'

const stand = atom({ plugin: 'verbrauch-leiste', key: 'stand' } as const, null)
const plan = atom({ plugin: 'verbrauch-leiste', key: 'plan' } as const, null)

// Dieselbe Quelle wie „Einstellungen → Nutzungslimits des Plans“ (auch Limits pro Modell).
const PLAN_URL = 'https://api.anthropic.com/api/oauth/usage'
const PLAN_ABSTAND_MS = 60_000

// Namen der Fenster, wie Claude Code sie selbst benennt.
const FENSTER_NAMEN: Record<string, string> = {
  five_hour: '5 Std.',
  seven_day: 'Alle Modelle',
  seven_day_overage_included: 'Fable',
  seven_day_opus: 'Opus',
  seven_day_sonnet: 'Sonnet',
}

function fensterName(kind: string): string | null {
  if (kind in FENSTER_NAMEN) return FENSTER_NAMEN[kind]!
  // Unbekannte Fenster (z. B. seven_day_cowork, seven_day_oauth_apps) zeigt auch die Einstellungsseite nicht.
  return null
}

function baue(context: SessionContextUsage, rateLimits: SessionRateLimit[], cost?: SessionCost): Verbrauch {
  const limits: Limit[] = []
  for (const r of rateLimits) {
    const n = fensterName(r.kind)
    if (n) limits.push({ kind: n, percentUsed: r.percentUsed, resetsAt: r.resetsAt ?? null, severity: null })
  }
  return {
    kontextProzent: context.percent ?? null,
    kontextTokens: context.tokens ?? null,
    fenster: context.window,
    limits,
    usd: cost ? cost.usd : null,
  }
}

type Obj = Record<string, unknown>
const istObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
const zahl = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// Liest die Zeilen der Antwort (`limits[]`), wie Claude Code sie beschreibt:
// kind 'session' | 'weekly_all' | 'weekly_scoped', percent 0–100, resets_at, scope.model.display_name, severity.
function ausZeilen(rows: unknown[]): Limit[] {
  const out: Limit[] = []
  for (const row of rows) {
    if (!istObj(row)) continue
    const percent = zahl(row.percent)
    const kind = text(row.kind) ?? ''
    if (percent === null) continue
    const scope = istObj(row.scope) ? row.scope : null
    const model = scope && istObj(scope.model) ? text(scope.model.display_name) : null
    const surface = scope && istObj(scope.surface) ? text(scope.surface.display_name) : null
    let name: string | null = null
    if (kind === 'session') name = '5 Std.'
    else if (kind === 'weekly_all') name = 'Alle Modelle'
    else if (model) name = model
    else if (surface) continue // Aufteilung nach Oberfläche (Claude Code / Chats / Cowork) ist kein Limit
    else continue
    if (out.some(l => l.kind === name)) continue
    out.push({
      kind: name,
      percentUsed: Math.round(percent * 10) / 10,
      resetsAt: text(row.resets_at),
      severity: text(row.severity),
    })
  }
  return out
}

// Ältere Antworten ohne `limits[]`: die Fenster liegen oben, utilization in Prozent.
function ausFenstern(json: Obj): Limit[] {
  const out: Limit[] = []
  for (const kind of Object.keys(FENSTER_NAMEN)) {
    const v = json[kind]
    if (!istObj(v)) continue
    const p = zahl(v.utilization)
    if (p === null) continue
    out.push({
      kind: FENSTER_NAMEN[kind]!,
      percentUsed: Math.round(p * 10) / 10,
      resetsAt: text(v.resets_at),
      severity: null,
    })
  }
  return out
}

export function planLimits(json: unknown): Limit[] {
  if (!istObj(json)) return []
  const rows = json.limits
  if (Array.isArray(rows)) {
    const aus = ausZeilen(rows)
    if (aus.length > 0) return aus
  }
  return ausFenstern(json)
}

// Zeigt den Aufbau der Antwort (Schlüssel, Zahlen, kurze Texte) – für die Fehlersuche.
function aufbau(v: unknown, tiefe = 0): unknown {
  if (tiefe > 6) return '…'
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'string') return v.length <= 40 ? v : `<Text ${v.length} Zeichen>`
  if (Array.isArray(v)) return v.slice(0, 20).map(x => aufbau(x, tiefe + 1))
  if (typeof v === 'object') {
    const r: Obj = {}
    for (const [k, x] of Object.entries(v as Obj)) r[k] = aufbau(x, tiefe + 1)
    return r
  }
  return typeof v
}

let letzteRohdaten = ''
let letzterAbruf = 0

async function holePlan($: EngineInterface, erzwingen = false): Promise<void> {
  const jetzt = await $.clock.now()
  if (!erzwingen && jetzt - letzterAbruf < PLAN_ABSTAND_MS) return
  letzterAbruf = jetzt
  try {
    const a = await $.session.authorize()
    if (!a || a.kind !== 'bearer') {
      letzteRohdaten = 'Keine Claude-Anmeldung in dieser Sitzung – Plan-Limits nicht abrufbar.'
      return
    }
    const res = await $.http.fetch(PLAN_URL, {
      auth: a.handle,
      headers: { 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json' },
    })
    if (!res.ok) {
      letzteRohdaten = `Abruf fehlgeschlagen: HTTP ${res.status}\n${res.text.slice(0, 300)}`
      return
    }
    const json: unknown = JSON.parse(res.text)
    letzteRohdaten = JSON.stringify(aufbau(json), null, 2)
    const limits = planLimits(json)
    if (limits.length > 0) await update($, plan, () => ({ limits, abgerufen: jetzt }))
  } catch (err) {
    letzteRohdaten = `Abruf fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`
  }
}

function kTok(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

function reset(iso: string | null, jetzt: number): string {
  if (!iso) return ''
  const ms = Date.parse(iso) - jetzt
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const min = Math.floor(ms / 60000)
  if (min < 60) return ` (in ${min} Min)`
  const std = Math.floor(min / 60)
  if (std < 48) return ` (in ${std} Std ${min % 60} Min)`
  return ` (in ${Math.floor(std / 24)} T ${std % 24} Std)`
}

function farbe(l: Limit): string | undefined {
  if (l.severity === 'critical') return 'red'
  if (l.severity === 'warning') return 'yellow'
  if (l.severity) return undefined
  if (l.percentUsed >= 90) return 'red'
  if (l.percentUsed >= 70) return 'yellow'
  return undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    try {
      const u = await $.session.usage()
      await update($, stand, () => baue(u.context, u.rateLimits, u.cost))
    } catch {
      // keine Zahlen verfügbar – Leiste zeigt Platzhalter
    }
    await $.command.register({
      name: 'verbrauch-rohdaten',
      description: 'Zeigt den Aufbau der Plan-Limits (für die Fehlersuche, ohne Zugangsdaten)',
    })
    await holePlan($, true)
    $.clock.every(5 * 60_000, () => {
      void holePlan($)
    })
    return r
  })

  on('command.run', { command: 'verbrauch-rohdaten' }, async $ => {
    await holePlan($, true)
    return { text: letzteRohdaten ? '```json\n' + letzteRohdaten + '\n```' : 'Noch keine Daten abgerufen.' }
  })

  on('session.measure', async ($, e, next) => {
    await update($, stand, () => baue(e.context, e.rateLimits, e.cost))
    if (e.changed.includes('rateLimits') || e.changed.includes('cost')) await holePlan($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const s = await read($, stand)
    const p = await read($, plan)
    const jetzt = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)

    if (s === null && p === null) {
      return (
        <Box>
          <Text dimColor>Verbrauch: noch keine Messung – kommt nach der ersten Antwort.</Text>
        </Box>
      )
    }

    // Plan-Limits (wie in den Einstellungen) haben Vorrang vor den Werten aus der letzten Antwort.
    const limits = p !== null ? p.limits : s?.limits ?? []

    const teile: { key: string; text: string; color?: string }[] = []
    if (s !== null) {
      const k = s.kontextProzent
      teile.push({
        key: 'kontext',
        text:
          k === null
            ? `Kontext –/${kTok(s.fenster)}`
            : `Kontext ${k}% (${kTok(s.kontextTokens ?? 0)}/${kTok(s.fenster)})`,
        color: k === null ? undefined : k >= 90 ? 'red' : k >= 70 ? 'yellow' : undefined,
      })
    }
    for (const l of limits) {
      teile.push({
        key: l.kind,
        text: `${l.kind} ${l.percentUsed}%${reset(l.resetsAt, jetzt)}`,
        color: farbe(l),
      })
    }
    if (s !== null && s.usd !== null) {
      teile.push({ key: 'usd', text: `Sitzung $${s.usd.toFixed(2)}` })
    }

    return (
      <Box flexDirection="row" flexWrap="wrap">
        {teile.map((t, i) => (
          <Text key={t.key} dimColor color={t.color}>
            {(i > 0 ? '  ·  ' : '') + t.text}
          </Text>
        ))}
      </Box>
    )
  })
}

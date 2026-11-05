import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit, SessionCost } from 'claude-code'

import type { Limit, Verbrauch } from '../types'

const stand = atom({ plugin: 'verbrauch-leiste', key: 'stand' } as const, null)
const plan = atom({ plugin: 'verbrauch-leiste', key: 'plan' } as const, null)

// Dieselbe Quelle wie „Einstellungen → Nutzungslimits des Plans“ (inkl. Limits pro Modell).
const PLAN_URL = 'https://api.anthropic.com/api/oauth/usage'
const PLAN_ABSTAND_MS = 60_000

function baue(context: SessionContextUsage, rateLimits: SessionRateLimit[], cost?: SessionCost): Verbrauch {
  return {
    kontextProzent: context.percent ?? null,
    kontextTokens: context.tokens ?? null,
    fenster: context.window,
    limits: rateLimits.map(r => ({ kind: schoen(r.kind), percentUsed: r.percentUsed, resetsAt: r.resetsAt ?? null })),
    usd: cost ? cost.usd : null,
  }
}

const AUSBLENDEN = /extra|overage|credit|spend|billing/i
const LABEL_FELDER = ['display_name', 'model_name', 'model', 'name', 'label', 'title']

function schoen(roh: string): string {
  if (roh === 'five_hour') return '5 Std.'
  if (roh === 'seven_day') return 'Alle Modelle'
  const m = /^seven_day_(.+)$/.exec(roh)
  const rest = m ? m[1]! : roh
  return rest
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(w => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')
}

function zahl(o: Record<string, unknown>): number | null {
  for (const k of ['utilization', 'percent_used', 'percentUsed', 'used_percentage', 'percent']) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

function zeit(o: Record<string, unknown>): string | null {
  for (const k of ['resets_at', 'resetsAt', 'reset_at', 'resets']) {
    const v = o[k]
    if (typeof v === 'string') return v
  }
  return null
}

// Durchsucht die ganze Antwort (auch verschachtelt, auch Listen) nach Fenstern mit Prozentwert.
function planLimits(json: unknown): Limit[] {
  const out: Limit[] = []
  const gesehen = new Set<string>()
  const lauf = (v: unknown, pfad: string[], tiefe: number) => {
    if (tiefe > 5 || !v || typeof v !== 'object') return
    if (Array.isArray(v)) {
      v.forEach((x, i) => lauf(x, [...pfad, String(i)], tiefe + 1))
      return
    }
    const o = v as Record<string, unknown>
    const p = zahl(o)
    if (p !== null) {
      const benannt = LABEL_FELDER.map(k => o[k]).find((x): x is string => typeof x === 'string' && x.length > 0)
      const schluessel = [...pfad].reverse().find(k => !/^\d+$/.test(k)) ?? 'limit'
      const pfadText = pfad.join('.')
      if (!AUSBLENDEN.test(pfadText)) {
        const label = benannt ? schoen(benannt) : schoen(schluessel)
        if (!gesehen.has(label)) {
          gesehen.add(label)
          out.push({ kind: label, percentUsed: Math.round(p * 10) / 10, resetsAt: zeit(o) })
        }
      }
    }
    for (const [k, x] of Object.entries(o)) {
      if (x && typeof x === 'object') lauf(x, [...pfad, k], tiefe + 1)
    }
  }
  lauf(json, [], 0)
  const rang = (k: string) => (k === '5 Std.' ? 0 : k === 'Alle Modelle' ? 1 : 2)
  return out.sort((a, b) => rang(a.kind) - rang(b.kind))
}

// Zeigt den Aufbau der Antwort: Schlüssel, Zahlen, kurze Texte – für die Fehlersuche.
function aufbau(v: unknown, tiefe = 0): unknown {
  if (tiefe > 6) return '…'
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'string') return v.length <= 40 ? v : `<Text ${v.length} Zeichen>`
  if (Array.isArray(v)) return v.slice(0, 20).map(x => aufbau(x, tiefe + 1))
  if (typeof v === 'object') {
    const r: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) r[k] = aufbau(x, tiefe + 1)
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
    if (!a || a.kind !== 'bearer') return
    const res = await $.http.fetch(PLAN_URL, {
      auth: a.handle,
      headers: { 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json' },
    })
    if (!res.ok) {
      letzteRohdaten = `Abruf fehlgeschlagen: HTTP ${res.status}`
      return
    }
    const json: unknown = JSON.parse(res.text)
    letzteRohdaten = JSON.stringify(aufbau(json), null, 2)
    const limits = planLimits(json)
    if (limits.length > 0) await update($, plan, () => ({ limits, abgerufen: jetzt }))
  } catch {
    // Abruf fehlgeschlagen: die Leiste zeigt weiter die Werte aus der letzten Antwort.
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

function farbe(p: number): string | undefined {
  if (p >= 90) return 'red'
  if (p >= 70) return 'yellow'
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
      teile.push({
        key: 'kontext',
        text:
          s.kontextProzent === null
            ? `Kontext –/${kTok(s.fenster)}`
            : `Kontext ${s.kontextProzent}% (${kTok(s.kontextTokens ?? 0)}/${kTok(s.fenster)})`,
        color: s.kontextProzent === null ? undefined : farbe(s.kontextProzent),
      })
    }
    for (const l of limits) {
      teile.push({
        key: l.kind,
        text: `${l.kind} ${l.percentUsed}%${reset(l.resetsAt, jetzt)}`,
        color: farbe(l.percentUsed),
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

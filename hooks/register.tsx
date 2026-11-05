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
    limits: rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt ?? null })),
    usd: cost ? cost.usd : null,
  }
}

function name(kind: string): string {
  if (kind === 'five_hour') return '5 Std.'
  if (kind === 'seven_day') return 'Alle Modelle'
  if (kind === 'spend_limit') return 'Budget'
  const m = /^seven_day_(.+)$/.exec(kind)
  const rest = m ? m[1]! : kind
  return rest
    .split('_')
    .map(w => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ')
}

// Liest jedes Fenster mit Prozentwert aus der Antwort, egal wie viele Modelle es gibt.
function planLimits(json: unknown): Limit[] {
  const out: Limit[] = []
  if (!json || typeof json !== 'object') return out
  for (const [kind, v] of Object.entries(json as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    const p = typeof o.utilization === 'number' ? o.utilization : null
    if (p === null) continue
    const r = typeof o.resets_at === 'string' ? o.resets_at : null
    out.push({ kind, percentUsed: Math.round(p * 10) / 10, resetsAt: r })
  }
  const rang = (k: string) => (k === 'five_hour' ? 0 : k === 'seven_day' ? 1 : 2)
  return out.sort((a, b) => rang(a.kind) - rang(b.kind))
}

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
    if (!res.ok) return
    const limits = planLimits(JSON.parse(res.text))
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
    await holePlan($, true)
    $.clock.every(5 * 60_000, () => {
      void holePlan($)
    })
    return r
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
        text: `${name(l.kind)} ${l.percentUsed}%${reset(l.resetsAt, jetzt)}`,
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

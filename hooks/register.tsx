import { atom, read, update } from 'claude-code'
import type { Register, SessionContextUsage, SessionRateLimit, SessionCost } from 'claude-code'

import type { Verbrauch } from '../types'

const stand = atom({ plugin: 'verbrauch-leiste', key: 'stand' } as const, null)

const NAMEN: Record<string, string> = { five_hour: '5 Std.', seven_day: '7 Tage', spend_limit: 'Budget' }

function baue(context: SessionContextUsage, rateLimits: SessionRateLimit[], cost?: SessionCost): Verbrauch {
  return {
    kontextProzent: context.percent ?? null,
    kontextTokens: context.tokens ?? null,
    fenster: context.window,
    limits: rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt ?? null })),
    usd: cost ? cost.usd : null,
  }
}

function kTok(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

function reset(iso: string | null, jetzt: number): string {
  if (!iso) return ''
  const ms = Date.parse(iso) - jetzt
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const min = Math.round(ms / 60000)
  if (min < 60) return ` (in ${min} Min)`
  const std = Math.floor(min / 60)
  if (std < 48) return ` (in ${std} Std ${min % 60} Min)`
  return ` (in ${Math.round(std / 24)} Tagen)`
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
    return r
  })

  on('session.measure', async ($, e, next) => {
    await update($, stand, () => baue(e.context, e.rateLimits, e.cost))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const s = await read($, stand)
    const jetzt = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)

    if (s === null) {
      return (
        <Box>
          <Text dimColor>Verbrauch: noch keine Messung – kommt nach der ersten Antwort.</Text>
        </Box>
      )
    }

    const kontext =
      s.kontextProzent === null
        ? `Kontext –/${kTok(s.fenster)}`
        : `Kontext ${s.kontextProzent}% (${kTok(s.kontextTokens ?? 0)}/${kTok(s.fenster)})`

    return (
      <Box flexDirection="row" flexWrap="wrap">
        <Text dimColor color={s.kontextProzent === null ? undefined : farbe(s.kontextProzent)}>
          {kontext}
        </Text>
        {s.limits.map(l => (
          <Text key={l.kind} dimColor color={farbe(l.percentUsed)}>
            {`  ·  ${NAMEN[l.kind] ?? l.kind} ${l.percentUsed}%${reset(l.resetsAt, jetzt)}`}
          </Text>
        ))}
        {s.usd === null ? null : (
          <Text key="usd" dimColor>{`  ·  Sitzung $${s.usd.toFixed(2)}`}</Text>
        )}
      </Box>
    )
  })
}

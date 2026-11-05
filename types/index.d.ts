export type Limit = { kind: string; percentUsed: number; resetsAt: string | null }

export type Verbrauch = {
  kontextProzent: number | null
  kontextTokens: number | null
  fenster: number
  limits: Limit[]
  usd: number | null
}

export type PlanStand = { limits: Limit[]; abgerufen: number }

declare module 'claude-code' {
  interface PluginState {
    'verbrauch-leiste': { stand: Verbrauch | null; plan: PlanStand | null }
  }
}

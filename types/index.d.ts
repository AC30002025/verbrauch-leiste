export type Verbrauch = {
  kontextProzent: number | null
  kontextTokens: number | null
  fenster: number
  limits: { kind: string; percentUsed: number; resetsAt: string | null }[]
  usd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'verbrauch-leiste': { stand: Verbrauch | null }
  }
}

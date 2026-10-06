export type PaneView = { lines: string[] }

declare module 'claude-code' {
  interface PluginState {
    hourslip: { pane: PaneView }
  }
}

/**
 * Attention time: how long a person actually spent on a board, not how long it sat open. A stretch of time counts only
 * while the board is on screen, the window has focus, and they did something (moved, scrolled, typed, clicked) within
 * the last minute. Stepping away for two hours counts as nothing; reading without touching anything still counts.
 */
export const IDLE_MS = 60_000;
export const TICK_MS = 5_000;

export class AttentionMeter {
  private lastInput = -Infinity;
  private lastTick: number | null = null;
  private pending = 0;
  /** The person did something. */
  input(now: number) { this.lastInput = now; }
  /** Call every TICK_MS: counts the time since the last tick when the board was seen, focused and recently touched. */
  tick(now: number, visible: boolean, focused: boolean) {
    if (this.lastTick !== null && visible && focused && now - this.lastInput <= IDLE_MS) this.pending += Math.min(now - this.lastTick, 2 * TICK_MS);
    this.lastTick = now;
  }
  /** Active ms counted since the last take. */
  take(): number { const p = this.pending; this.pending = 0; return p; }
}

/** One report from the browser: [when it was sent, active ms in it]. */
export type Span = [number, number];

/** Active time since `since` (ms since epoch) and in total. */
export function attentionOf(spans: Span[], since: number | null) {
  let total = 0, after = 0;
  for (const [at, ms] of spans) { total += ms; if (since === null || at >= since) after += ms; }
  return { total, after };
}

export const duration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

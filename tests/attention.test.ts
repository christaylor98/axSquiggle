import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttentionMeter, attentionOf, duration, IDLE_MS, TICK_MS } from '../src/core/attention';
import { BoardServer } from '../server/state';
import { callTool } from '../server/tools';

/** Drive a meter for `secs` seconds, ticking every TICK_MS; `act` says whether the person touches it at each tick. */
function run(m: AttentionMeter, t0: number, secs: number, o: { visible?: boolean; focused?: boolean; act?: boolean }) {
  let t = t0;
  for (; t <= t0 + secs * 1000; t += TICK_MS) { if (o.act) m.input(t); m.tick(t, o.visible ?? true, o.focused ?? true); }
  return t;
}

describe('attention meter', () => {
  it('counts time while the person is working on the board', () => {
    const m = new AttentionMeter(); run(m, 0, 120, { act: true });
    expect(m.take()).toBe(120_000);
  });
  it('counts reading without input for up to a minute, then stops', () => {
    const m = new AttentionMeter(); m.input(0); run(m, 0, 600, {});
    expect(m.take()).toBe(IDLE_MS);
  });
  it('counts nothing while the tab is hidden or the window is not focused, even with input', () => {
    const m = new AttentionMeter(); run(m, 0, 300, { act: true, visible: false }); run(m, 400_000, 300, { act: true, focused: false });
    expect(m.take()).toBe(0);
  });
  it('a two-hour gap between ticks (laptop asleep) counts at most two ticks', () => {
    const m = new AttentionMeter(); m.input(0); m.tick(0, true, true); m.input(7_200_000); m.tick(7_200_000, true, true);
    expect(m.take()).toBeLessThanOrEqual(2 * TICK_MS);
  });
  it('take empties it', () => { const m = new AttentionMeter(); run(m, 0, 10, { act: true }); m.take(); expect(m.take()).toBe(0); });
  it('splits time by the last AI write', () => {
    expect(attentionOf([[100, 5000], [200, 7000]], 150)).toEqual({ total: 12000, after: 7000 });
    expect(duration(65_000)).toBe('1m 5s');
  });
});

describe('attention on the bridge', () => {
  it('stores reports per board, keeps them on disk, and get_review shows time since the AI last wrote', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'axsq-attn-'));
    const s = new BoardServer(dir);
    expect(s.addAttention(30_000)).toBe(true);
    expect(s.addAttention(0)).toBe(false);
    expect(s.addAttention(10 * 60_000)).toBe(false);   // a report can never claim more than a minute
    await callTool(s, 'add_note', { frame: 1, text: 'hi' });   // an AI write: the clock for "since" restarts
    s.addAttention(20_000);
    expect(s.attention()).toMatchObject({ total: 50_000, after: 20_000 });
    const review = (await callTool(s, 'get_review', {})) as { text: string };
    expect(review.text).toMatch(/Attention .*: 20s since your last write .*, 50s in total/);
    expect(new BoardServer(dir).attention()).toMatchObject({ total: 50_000, after: 20_000 });
  });
});

import type { Board, Frame, Pt, Shape } from './types';

/**
 * Choices ("knobs"): a row of options of which one is on, e.g. a quality questionnaire. Outline:
 *
 *   choose How long can it take? | instant | a few seconds | a couple of minutes | *don't care
 *
 * The first cell is the question, the rest the options; `*` marks the one that is on. One click on an option turns it
 * on (the others off); every change is kept in the board's knob log (when, who, from, to), so where the focus moved,
 * and when, can be read back. The person can also just say it in a note ("more focus on speed for x, y") and the AI
 * sets the knobs with set_choice.
 */
export interface KnobChange { at: number; frame: string; q: string; from: string | null; to: string; by: 'person' | 'AI' }

type Rect = Extract<Shape, { k: 'rect' }>;
const isOpt = (s: Shape): s is Rect & { choice: string; opt: string } => s.k === 'rect' && typeof s.choice === 'string' && typeof s.opt === 'string';

/** The option button under a point, if any. */
export function choiceAt(f: Frame, p: Pt): number | null {
  for (let i = f.shapes.length - 1; i >= 0; i--) { const s = f.shapes[i]; if (isOpt(s) && p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) return i; }
  return null;
}

/** Every question on a frame and the option that is on (null when none is). */
export function knobsOf(f: Frame): { q: string; on: string | null; options: string[] }[] {
  const by = new Map<string, { q: string; on: string | null; options: string[] }>();
  for (const s of f.shapes) if (isOpt(s)) {
    const k = by.get(s.choice) ?? { q: s.choice, on: null, options: [] };
    k.options.push(s.opt); if (s.on) k.on = s.opt; by.set(s.choice, k);
  }
  return [...by.values()];
}

/** Turn option `idx` on in its question (the others off) and log the change. Returns it, or null if nothing changed. */
export function choose(b: Board, fi: number, idx: number, by: KnobChange['by']): KnobChange | null {
  const f = b.frames[fi], s = f.shapes[idx];
  if (!s || !isOpt(s) || s.on) return null;
  let from: string | null = null;
  for (const o of f.shapes) if (isOpt(o) && o.choice === s.choice) {
    if (o.on) from = o.opt;
    if (o === s) { o.on = true; o.tone = 'amber'; } else { delete o.on; delete o.tone; }
  }
  const ch: KnobChange = { at: Date.now(), frame: f.id, q: s.choice, from, to: s.opt, by };
  (b.knobLog ??= []).push(ch);
  if (b.knobLog.length > 500) b.knobLog.splice(0, b.knobLog.length - 500);
  return ch;
}

/** Set a knob by words: the question containing `q` and its option containing `opt` (case-insensitive). */
export function setChoice(b: Board, fi: number, q: string, opt: string, by: KnobChange['by']): KnobChange | null {
  const f = b.frames[fi], lq = q.toLowerCase().trim(), lo = opt.toLowerCase().trim();
  const qs = knobsOf(f).filter((k) => k.q.toLowerCase().includes(lq));
  if (qs.length !== 1) throw new Error(qs.length ? `"${q}" matches ${qs.length} questions: ${qs.map((k) => k.q).join(' / ')}` : `No question containing "${q}" on that frame. Questions: ${knobsOf(f).map((k) => k.q).join(' / ') || 'none'}`);
  const exact = f.shapes.findIndex((s) => isOpt(s) && s.choice === qs[0].q && s.opt.toLowerCase() === lo);
  const idx = exact >= 0 ? exact : f.shapes.findIndex((s) => isOpt(s) && s.choice === qs[0].q && s.opt.toLowerCase().includes(lo));
  if (idx < 0) throw new Error(`"${qs[0].q}" has no option "${opt}". Options: ${qs[0].options.join(' / ')}`);
  return choose(b, fi, idx, by);
}

/** Every question on the board, in frame order: the questionnaire mode walks these one at a time. */
export interface Question { fi: number; caption: string; q: string; options: { opt: string; idx: number; on: boolean }[]; at: [number, number, number, number] }
export function questionsOf(b: Board): Question[] {
  const out: Question[] = [];
  b.frames.forEach((f, fi) => {
    const by = new Map<string, Question>();
    f.shapes.forEach((s, idx) => {
      if (!isOpt(s)) return;
      let q = by.get(s.choice);
      if (!q) { q = { fi, caption: f.caption, q: s.choice, options: [], at: [s.x, s.y, s.w, s.h] }; by.set(s.choice, q); out.push(q); }
      q.options.push({ opt: s.opt, idx, on: !!s.on });
      q.at = [Math.min(q.at[0], s.x), Math.min(q.at[1], s.y), Math.max(q.at[0] + q.at[2], s.x + s.w) - Math.min(q.at[0], s.x), s.h];
    });
  });
  return out;
}

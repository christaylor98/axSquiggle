import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyOutline, diffBoards, reviewPacket } from '../src/core/agent';
import { choiceAt, choose, knobsOf, setChoice } from '../src/core/choice';
import { freshBoard, validateBoard } from '../src/core/model';
import { cloneBoard, type Shape } from '../src/core/types';
import { BoardServer } from '../server/state';
import { callTool } from '../server/tools';

const knobBoard = () => {
  const b = freshBoard();
  applyOutline(b, 1, 'header Quality\nchoose How long can it take? | instant | a few seconds | *don\'t care\nchoose If a number is off? | exact | close | *don\'t care', 'replace');
  return b;
};
const optIdx = (b: ReturnType<typeof freshBoard>, opt: string) => b.frames[0].shapes.findIndex((s) => s.k === 'rect' && (s as { opt?: string }).opt === opt);

describe('knobs (choose)', () => {
  it('builds a question with its options, * on', () => {
    const k = knobsOf(knobBoard().frames[0]);
    expect(k).toEqual([
      { q: 'How long can it take?', on: "don't care", options: ['instant', 'a few seconds', "don't care"] },
      { q: 'If a number is off?', on: "don't care", options: ['exact', 'close', "don't care"] },
    ]);
  });
  it('a click on an option turns it on, the others in that question off, and logs it', () => {
    const b = knobBoard(), i = optIdx(b, 'instant'), s = b.frames[0].shapes[i] as Extract<Shape, { k: 'rect' }>;
    expect(choiceAt(b.frames[0], { x: s.x + 5, y: s.y + 5 })).toBe(i);
    const c = choose(b, 0, i, 'person');
    expect(c).toMatchObject({ q: 'How long can it take?', from: "don't care", to: 'instant', by: 'person' });
    expect(knobsOf(b.frames[0])[0].on).toBe('instant');
    expect(knobsOf(b.frames[0])[1].on).toBe("don't care");   // the other question is untouched
    expect(b.frames[0].shapes.filter((x) => x.k === 'rect' && (x as { on?: boolean }).on).length).toBe(2);
    expect(choose(b, 0, i, 'person')).toBeNull();   // already on: nothing logged
    expect(b.knobLog).toHaveLength(1);
  });
  it('set by words (what the AI does for "more focus on speed"), survives save/load, shows in review and diff', () => {
    const b = knobBoard(), base = cloneBoard(b);
    setChoice(b, 0, 'how long', 'instant', 'AI');
    expect(() => setChoice(b, 0, 'how long', 'warp speed', 'AI')).toThrow(/no option/);
    const back = validateBoard(JSON.parse(JSON.stringify(b)))!;
    expect(knobsOf(back.frames[0])[0].on).toBe('instant');
    expect(back.knobLog?.[0]).toMatchObject({ to: 'instant', by: 'AI' });
    expect(diffBoards(base, b).join('\n')).toMatch(/knob "How long can it take\?" set to "instant" \(was "don't care"\)/);
    expect(reviewPacket(b, base, 2).text).toMatch(/How long can it take\? = instant/);
  });
  it('the set_choice tool sets a knob on the board', async () => {
    const s = new BoardServer(mkdtempSync(join(tmpdir(), 'axsq-knob-')));
    await callTool(s, 'edit_frame', { frame: 1, mode: 'replace', outline: 'choose Speed? | fast | *don\'t care' });
    const r = (await callTool(s, 'set_choice', { frame: 1, question: 'speed', option: 'fast' })) as string | { text: string };
    expect(typeof r === 'string' ? r : r.text).toMatch(/Speed\?: don't care -> fast/);
    expect(knobsOf(s.board.frames[0])[0].on).toBe('fast');
  });
});

describe('a long text label wraps inside the frame', () => {
  it('edit_element with a long label never runs off the edge', async () => {
    const s = new BoardServer(mkdtempSync(join(tmpdir(), 'axsq-wrap-')));
    await callTool(s, 'edit_frame', { frame: 1, mode: 'replace', outline: 'text short\ntext below' });
    const long = 'These answers steer where the building effort goes. Leave them as don\'t care for sensible defaults. Come back any time and change them.';
    await callTool(s, 'edit_element', { frame: 1, label: 'short', set_label: long });
    const t = s.board.frames[0].shapes.find((x) => x.k === 'text' && x.s.startsWith('These')) as Extract<Shape, { k: 'text' }>;
    expect(t.s.split('\n').length).toBeGreaterThan(1);
    const below = s.board.frames[0].shapes.find((x) => x.k === 'text' && x.s === 'below') as Extract<Shape, { k: 'text' }>;
    expect(below.y).toBeGreaterThan(t.y + 20 * (t.s.split('\n').length - 1));
  });
});

import { describe, expect, it } from 'vitest';
import { addNote, resolveNotes, reviewPacket } from '../src/core/agent';
import { freshBoard, validateBoard } from '../src/core/model';

describe('note timestamps (the attention clock)', () => {
  const board = () => freshBoard();
  it('stamps a note when written and when resolved, and the review shows the times', () => {
    const b = board(), t0 = Date.now();
    const id = addNote(b, 1, 'pick this one', []);
    const n = b.frames[0].notes[0];
    expect(n.at).toBeGreaterThanOrEqual(t0);
    expect(reviewPacket(b, null, 1).text).toMatch(/\(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\): pick this one/);
    expect(reviewPacket(b, null, 1).text).toMatch(/Open review notes: 1 \(written .* to .*\)/);
    resolveNotes(b, [id], 'done');
    expect(n.doneAt).toBeGreaterThanOrEqual(n.at!);
  });
  it('keeps the times through save and load', () => {
    const b = board(); addNote(b, 1, 'x', []); resolveNotes(b, [b.frames[0].notes[0].id]);
    const back = validateBoard(JSON.parse(JSON.stringify(b)));
    expect(back?.frames[0].notes[0].at).toBe(b.frames[0].notes[0].at);
    expect(back?.frames[0].notes[0].doneAt).toBe(b.frames[0].notes[0].doneAt);
  });
});

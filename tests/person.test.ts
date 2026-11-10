import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BoardServer } from '../server/state';
import { callTool } from '../server/tools';
import { knobsOf, setChoiceExact } from '../src/core/choice';

describe('a person\'s answer is never lost to an AI write', () => {
  it('an answer sent after the AI changed the board still lands (a whole-board PUT from the old rev would be refused)', async () => {
    const s = new BoardServer(mkdtempSync(join(tmpdir(), 'axsq-person-')));
    await callTool(s, 'edit_frame', { frame: 1, mode: 'replace', outline: 'choose Park? | picture 1 | picture 2 | *not sure' });
    const seenRev = s.rev, fid = s.board.frames[0].id;
    await callTool(s, 'add_note', { frame: 1, text: 'the AI writes while the person is answering' });
    expect(s.userWrite(s.board, seenRev).ok).toBe(false);          // the old way: refused, and the page dropped the answer
    s.personWrite((b) => { setChoiceExact(b, b.frames.findIndex((f) => f.id === fid), 'Park?', 'picture 1', 'person'); });
    expect(knobsOf(s.board.frames[0])[0].on).toBe('picture 1');
    expect(s.board.frames[0].notes.length).toBe(1);                  // the AI's note is kept too
    expect(s.board.knobLog?.at(-1)).toMatchObject({ by: 'person', to: 'picture 1' });
  });
});

import { describe, expect, it } from 'vitest';
import { addNote, applyOutline, describeBoard, diffBoards, draftBoard, editElement, findElement, listElements, resolveNotes, reviewPacket } from '../src/core/agent';
import { linksOf } from '../src/core/links';
import { freshBoard } from '../src/core/model';
import { cloneBoard } from '../src/core/types';

const draft = () => {
  const b = freshBoard();
  draftBoard(b, [
    { caption: 'Login', outline: 'header Acme\ncard Sign in\n  input Email\n  input Password\n  button Sign in -> 2' },
    { caption: 'Dashboard home', device: 'phone', outline: 'header Dashboard\nbutton Log out -> Login' },
  ]);
  return b;
};

describe('agent core', () => {
  it('drafts frames from outlines and resolves links between them', () => {
    const b = draft();
    expect(b.frames.map((f) => f.caption)).toEqual(['Login', 'Dashboard home']);
    expect(b.frames[1].device).toBe('phone');
    expect(linksOf(b).map((l) => [l.from, l.label, l.to])).toEqual([[0, 'Sign in', 1], [1, 'Log out', 0]]);
    const text = describeBoard(b, 3);
    expect(text).toContain('Board rev 3: 2 frame(s)');
    expect(text).toContain('Button "Sign in"');
    expect(text).toContain('-> frame 2');
  });

  it('edits elements by label, index and kind, and rejects ambiguity', () => {
    const b = draft();
    expect(editElement(b, 1, { label: 'Email' }, { label: 'Work email' })).toContain('Work email');
    expect(listElements(b.frames[0]).some((x) => x.el.label === 'Work email')).toBe(true);
    expect(() => editElement(b, 1, { role: 'Input' }, { label: 'x' })).toThrow(/2 elements match/);
    const idx = findElement(b.frames[0], { label: 'Password' }).n;
    expect(editElement(b, 'Login', { index: idx }, { kind: 'text' })).toContain('now a text');
    expect(editElement(b, 1, { label: 'Acme' }, { remove: true })).toContain('Removed');
    expect(() => editElement(b, 9, { label: 'x' }, {})).toThrow(/No such frame/);
  });

  it('appends outline text to a frame and reports bad link targets', () => {
    const b = draft();
    const warn = applyOutline(b, 'dashboard', 'button Settings -> nowhere');
    expect(warn[0]).toMatch(/nowhere/);
    expect(listElements(b.frames[1]).map((x) => x.el.label)).toContain('Settings');
  });

  it('describes what the person changed since the draft, and turns notes into a review packet', () => {
    const b = draft(), base = cloneBoard(b);
    const mine = cloneBoard(b);
    editElement(mine, 1, { label: 'Email' }, { label: 'Work email' });
    applyOutline(mine, 1, 'button Forgot password?');
    editElement(mine, 2, { label: 'Log out' }, { remove: true });
    const id = addNote(mine, 1, 'Make the sign in button more prominent', ['Button "Sign in"']);
    const changes = diffBoards(base, mine);
    expect(changes).toEqual(expect.arrayContaining([
      expect.stringContaining('Input "Email" is now "Work email"'),
      expect.stringContaining('added Button "Forgot password?"'),
      expect.stringContaining('removed Button "Log out"'),
      expect.stringContaining(`new note [${id}]`),
    ]));
    const pk = reviewPacket(mine, base, 5);
    expect(pk.text).toContain('Make the sign in button more prominent');
    expect(pk.openNotes).toHaveLength(1);
    expect(pk.openNotes[0].frame).toBe(1);
    expect(resolveNotes(mine, [id], 'Made it a primary button')).toBe(1);
    const after = reviewPacket(mine, base, 6);
    expect(after.openNotes).toHaveLength(0);
    expect(describeBoard(mine)).toContain('reply: Made it a primary button');
  });
});

describe('reference images', () => {
  it('keeps the muted image behind a frame when an AI redrafts the board', () => {
    const b = draft();
    b.frames[0].bg = 'data:image/png;base64,AAAA';
    draftBoard(b, [{ caption: 'Login v2', outline: 'header Acme v2' }, { outline: 'header Home' }]);
    expect(b.frames[0].bg).toBe('data:image/png;base64,AAAA');
    expect(b.frames[1].bg).toBeUndefined();
    applyOutline(b, 1, 'button Go', 'replace');
    expect(b.frames[0].bg).toBe('data:image/png;base64,AAAA');   // editing a frame never drops it either
  });
});

describe('frame management', () => {
  it('duplicates and moves frames; links and notes survive', async () => {
    const { duplicateFrameAt, moveFrameTo, addNote } = await import('../src/core/agent');
    const b = draft();
    addNote(b, 1, 'check the heading');
    duplicateFrameAt(b, 1);
    expect(b.frames).toHaveLength(3);
    expect(b.frames[1].caption).toBe(b.frames[0].caption);
    expect(b.frames[1].id).not.toBe(b.frames[0].id);
    expect(b.frames[1].notes[0].id).not.toBe(b.frames[0].notes[0].id);       // notes get their own ids
    expect(b.frames[1].notes[0].text).toBe('check the heading');
    const before = linksOf(b).map((l) => `${b.frames[l.from].id}>${l.toId}`).sort();
    moveFrameTo(b, 3, 1);                                                     // the old second frame goes first
    expect(b.frames[0].caption).toBe('Dashboard home');
    expect(linksOf(b).map((l) => `${b.frames[l.from].id}>${l.toId}`).sort()).toEqual(before);   // links follow ids, not numbers
    expect(linksOf(b).every((l) => l.to !== null)).toBe(true);
  });
});

describe('image height', () => {
  const imgH = (b: ReturnType<typeof freshBoard>, fi = 0) => (b.frames[fi].shapes.find((s) => s.k === 'img') as { y: number; h: number });
  it('the outline sets an image height with {h=N}, with a link and label alongside', () => {
    const b = freshBoard();
    draftBoard(b, [{ outline: 'header Cam\nimage Cockpit view {h=320} -> 2\nbutton Go' }, { outline: 'image Plain\ncard Big {height: 400}' }]);
    expect(imgH(b).h).toBe(320);
    expect(b.frames[0].shapes.some((s) => s.k === 'text' && s.s === 'Cockpit view')).toBe(true);
    expect(imgH(b, 1).h).toBe(160);
    expect(b.frames[1].shapes.find((s) => s.k === 'rect' && s.h === 400)).toBeTruthy();
    const goY = (f: typeof b.frames[0]) => (f.shapes.find((s) => s.k === 'rect' && s.role === 'Button') as { y: number }).y;
    const b2 = freshBoard(); draftBoard(b2, [{ outline: 'header Cam\nimage Cockpit view\nbutton Go' }]);
    expect(goY(b.frames[0]) - goY(b2.frames[0])).toBe(160);   // the button below moved down by the extra height
  });
  it('edit_element resizes an image and moves what is below it', () => {
    const b = freshBoard();
    draftBoard(b, [{ outline: 'image Cockpit view\nbutton Go' }]);
    const goY = () => (b.frames[0].shapes.find((s) => s.k === 'rect' && s.role === 'Button') as { y: number }).y;
    const y0 = goY();
    expect(editElement(b, 1, { role: 'Image' }, { height: 300 })).toContain('height 300');
    expect(imgH(b).h).toBe(300);
    expect(goY()).toBe(y0 + 140);
    editElement(b, 1, { role: 'Image' }, { height: 100 });
    expect(goY()).toBe(y0 - 60);
    expect(() => editElement(b, 1, { role: 'Button' }, { height: 100 })).toThrow(/Only an Image or a Card/);
  });
});

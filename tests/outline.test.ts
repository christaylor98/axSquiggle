import { describe, expect, it } from 'vitest';
import { bounds } from '../src/core/geom';
import { buildFromText, convertElement, kindChange, parseCell, setLabel } from '../src/core/layout';
import { classify, smartSize } from '../src/core/semantics';
import { newFrame, newNote } from '../src/core/types';

const SPEC = `header Acme Portal
Invoices
  input Customer
  input Amount | input Due date
  checkbox Send by email
  button Save | button Cancel
paragraph`;

describe('outline builder', () => {
  const built = buildFromText(newFrame('desktop'), SPEC, null);
  const f = smartSize(built.frame);
  const c = classify(f);
  const roles = c.els.map((e) => `${e.role}${e.label ? ':' + e.label : ''}`);

  it('classifies every element of the acceptance example', () => {
    expect(roles).toEqual([
      'Header:Acme Portal', 'Card:Invoices', 'Input:Customer', 'Input:Amount', 'Input:Due date',
      'Checkbox:Send by email', 'Button:Save', 'Button:Cancel', 'Paragraph',
    ]);
  });

  it('nests the form inside the Invoices card and leaves the paragraph outside', () => {
    const card = c.els.find((e) => e.role === 'Card')!;
    const kids = c.els.filter((e) => e.parent === card.i).map((e) => e.role);
    expect(kids).toEqual(['Input', 'Input', 'Input', 'Checkbox', 'Button', 'Button']);
    expect(c.els.find((e) => e.role === 'Paragraph')!.parent).toBeNull();
    expect(c.els.find((e) => e.role === 'Header')!.parent).toBeNull();
  });

  it('puts two inputs side by side on one row, and Save/Cancel on one row', () => {
    const by = (l: string) => bounds(f.shapes[c.els.find((e) => e.label === l)!.i]);
    expect(by('Amount').y).toBe(by('Due date').y);
    expect(by('Amount').x + by('Amount').w).toBeLessThan(by('Due date').x);
    expect(by('Customer').y).toBeLessThan(by('Amount').y);
    expect(by('Save').y).toBe(by('Cancel').y);
  });

  it('is stable under smart sizing and keeps 16px padding in the card', () => {
    expect(smartSize(f).shapes).toEqual(f.shapes);
    const card = bounds(f.shapes[c.els.find((e) => e.role === 'Card')!.i]);
    const cust = bounds(f.shapes[c.els.find((e) => e.label === 'Customer')!.i]);
    expect(cust.x - card.x).toBe(16);
    expect(card.x + card.w - (cust.x + cust.w)).toBe(16);
  });

  it('works on the phone frame too', () => {
    const p = smartSize(buildFromText(newFrame('phone'), SPEC, null).frame);
    expect(classify(p).els.map((e) => e.role)).toEqual(
      ['Header', 'Card', 'Input', 'Input', 'Input', 'Checkbox', 'Button', 'Button', 'Paragraph'],
    );
  });
});

describe('outline editing', () => {
  it('unknown first word becomes plain text', () => {
    expect(parseCell('Hello world')).toMatchObject({ kind: 'text', label: 'Hello world', keyword: false });
  });
  it('Add box places under the anchor and shifts what follows', () => {
    const a = buildFromText(newFrame('desktop'), 'input Email\nbutton Go', null);
    const email = classify(a.frame).els.find((e) => e.label === 'Email')!;
    const b = buildFromText(a.frame, 'input Password', email.i);
    const els = classify(b.frame).els;
    expect(els.map((e) => e.label)).toEqual(['Email', 'Password', 'Go']);
  });
  it('creates a missing label in the right place', () => {
    const a = buildFromText(newFrame('desktop'), 'header Top\ninput\nbutton', null);
    const input = classify(a.frame).els.find((e) => e.role === 'Input')!;
    expect(input.label).toBe('');
    const f = setLabel(a.frame, input, 'Name');
    expect(classify(f).els.find((e) => e.role === 'Input')!.label).toBe('Name');
  });
  it('typing a different kind keyword over a Card converts it in place', () => {
    const a = buildFromText(newFrame('desktop'), 'card Details', null);
    const card = classify(a.frame).els[0];
    expect(card.role).toBe('Card');
    const cell = kindChange(card, 'input Email')!;
    const { frame } = convertElement(a.frame, card, cell);
    const e = classify(frame).els;
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ role: 'Input', label: 'Email' });
  });
});

describe('paragraph text', () => {
  it('lets the outline set, grow and clear paragraph copy', async () => {
    const { classify } = await import('../src/core/semantics');
    const { setLabel, buildFromText } = await import('../src/core/layout');
    const { newFrame } = await import('../src/core/types');
    const f = newFrame();
    f.shapes.push({ k: 'tlines', x: 40, y: 40, w: 200, h: 60 }, { k: 'rect', x: 40, y: 120, w: 200, h: 40 });
    const para = classify(f).els.find((e) => e.role === 'Paragraph')!;
    expect(para.label).toBe('');
    const long = 'The quick brown fox jumps over the lazy dog and keeps running across the whole screen until it is tired';
    const g = setLabel(f, para, long);
    const t = g.shapes[0] as { s?: string; h: number };
    expect(t.s).toBe(long);
    expect(t.h).toBeGreaterThan(60);
    expect((g.shapes[1] as { y: number }).y).toBe(120 + (t.h - 60)); // what sat below moved down with it
    expect(classify(g).els.find((e) => e.role === 'Paragraph')!.label).toBe(long);
    const cleared = setLabel(g, classify(g).els.find((e) => e.role === 'Paragraph')!, '');
    expect((cleared.shapes[0] as { s?: string }).s).toBeUndefined();
    const built = buildFromText(newFrame(), 'paragraph Hello there', null).frame;
    expect((built.shapes[0] as { s?: string }).s).toBe('Hello there');
  });
});

describe('canvas stamps', () => {
  it('drops real elements from a slash command, with stacks for comma lists', async () => {
    const { stampFromText } = await import('../src/core/layout');
    const { classify } = await import('../src/core/semantics');
    const { newFrame } = await import('../src/core/types');
    const ctx = { W: 960, phone: false };
    const r = stampFromText('/radio Email, SMS, Push', 100, 100, ctx)!;
    const f = newFrame(); f.shapes.push(...r.shapes);
    const roles = classify(f).els.map((e) => `${e.role}:${e.label}`);
    expect(roles).toEqual(['Card:', 'Radio:Email', 'Radio:SMS', 'Radio:Push']);   // the three radios share a bordered group
    const ys = classify(f).els.filter((e) => e.role === 'Radio').map((e) => bounds(f.shapes[e.i]).y);
    expect(ys[1]).toBeGreaterThan(ys[0]); expect(ys[2]).toBeGreaterThan(ys[1]);
    const c = newFrame(); c.shapes.push(...stampFromText('/cb Remember me', 40, 40, ctx)!.shapes);
    expect(classify(c).els[0]).toMatchObject({ role: 'Checkbox', label: 'Remember me' });
    const b = newFrame(); b.shapes.push(...stampFromText('/btn Save, Cancel', 40, 40, ctx)!.shapes);
    const bs = classify(b).els.map((e) => `${e.role}:${e.label}`);
    expect(bs).toEqual(['Button:Save', 'Button:Cancel']);
    expect(stampFromText('/nope', 0, 0, ctx)).toBeNull();
    expect(stampFromText('plain text', 0, 0, ctx)).toBeNull();
  });
});

describe('outline containment', () => {
  it('lists each container followed by what it contains, with depth per level', () => {
    const f = newFrame();
    f.shapes.push(
      { k: 'rect', x: 40, y: 100, w: 300, h: 300 },             // 0 card
      { k: 'rect', x: 400, y: 104, w: 200, h: 200 },            // 1 sibling card, beside the first at nearly the same y
      { k: 'rect', x: 60, y: 140, w: 120, h: 40 },              // 2 button inside card 0
      { k: 'text', x: 80, y: 168, s: 'Go' },
      { k: 'rect', x: 60, y: 300, w: 20, h: 20 },               // 4 checkbox inside card 0
      { k: 'rect', x: 80, y: 200, w: 200, h: 80 },              // 5 nested card inside card 0
      { k: 'rect', x: 100, y: 220, w: 100, h: 30 },             // 6 button inside the nested card
      { k: 'text', x: 110, y: 242, s: 'Deep' },
    );
    const els = classify(f).els;
    const order = els.map((e) => e.i);
    expect(order.indexOf(0)).toBeLessThan(order.indexOf(2));
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(1)); // card 0's children all come before the sibling card
    expect(order.indexOf(4)).toBeLessThan(order.indexOf(1));
    expect(order.indexOf(6)).toBeLessThan(order.indexOf(1));
    const depth = (i: number) => els.find((e) => e.i === i)!.depth;
    expect([depth(0), depth(1), depth(2), depth(5), depth(6)]).toEqual([0, 0, 1, 1, 2]);
  });
});

describe('search across frames', () => {
  it('finds labels, paragraph copy, kinds, captions and notes in every frame', async () => {
    const { searchBoard } = await import('../src/core/search');
    const a = newFrame(); a.caption = 'Login screen';
    a.shapes.push({ k: 'rect', x: 40, y: 100, w: 120, h: 40 }, { k: 'text', x: 60, y: 128, s: 'Sign in' });
    const b = newFrame();
    b.shapes.push({ k: 'tlines', x: 40, y: 40, w: 300, h: 60, s: 'Forgot your password? Reset it here.' }, { k: 'rect', x: 40, y: 300, w: 120, h: 40 }, { k: 'text', x: 60, y: 328, s: 'Reset' });
    b.notes.push(newNote('Password rules unclear', [0, 0, 1, 1], []));
    const board = { frames: [a, b] };
    expect(searchBoard(board, 'sign').map((h) => [h.frame, h.role])).toEqual([[0, 'Button']]);
    expect(searchBoard(board, 'PASSWORD').map((h) => [h.frame, h.kind])).toEqual([[1, 'element'], [1, 'note']]);
    expect(searchBoard(board, 'button').map((h) => h.frame)).toEqual([0, 1]);
    expect(searchBoard(board, 'login').map((h) => h.kind)).toEqual(['caption']);
    expect(searchBoard(board, 'reset button').map((h) => h.text)).toEqual(['Reset']);
    expect(searchBoard(board, '  ')).toEqual([]);
    expect(searchBoard(board, 'zzz')).toEqual([]);
  });
});

describe('multi-select helpers', () => {
  it('moveGroup carries a label and a container\'s contents; selectedOf ignores stale extras', async () => {
    const { moveGroup } = await import('../src/core/semantics');
    const f = newFrame();
    f.shapes.push({ k: 'rect', x: 40, y: 100, w: 400, h: 300 }, { k: 'rect', x: 60, y: 140, w: 120, h: 40 }, { k: 'text', x: 80, y: 168, s: 'Go' }, { k: 'rect', x: 600, y: 100, w: 120, h: 40 });
    const c = classify(f);
    expect([...moveGroup(f, c, 0)].sort()).toEqual([0, 1, 2]);   // card + button + button's label
    expect([...moveGroup(f, c, 3)]).toEqual([3]);
    const { selectedOf } = await import('../src/ui/store');
    const base = { sel: 1, more: [3, 1], moreFor: 1, moreLen: 4 } as never;
    expect(selectedOf(base)).toEqual([1, 3]);
    expect(selectedOf({ sel: 2, more: [3], moreFor: 1, moreLen: 4 } as never)).toEqual([2]);
    expect(selectedOf({ sel: null, more: [3], moreFor: 1, moreLen: 4 } as never)).toEqual([]);
  });
});

describe('parts', () => {
  it('captures a selection with its label and wired arrows, and stamps fresh copies', async () => {
    const { makePart, partName } = await import('../src/core/parts');
    const { stampFromText, instantiate } = await import('../src/core/layout');
    const { validateBoard, toRawJSON, fromRawJSON } = await import('../src/core/model');
    const f = newFrame();
    f.shapes.push(
      { k: 'rect', x: 100, y: 200, w: 120, h: 40, link: 'f123' }, { k: 'text', x: 120, y: 228, s: 'Back' },
      { k: 'rect', x: 400, y: 200, w: 120, h: 40 }, { k: 'text', x: 420, y: 228, s: 'Next' },
      { k: 'line', x1: 220, y1: 220, x2: 400, y2: 220, arrow: true },
      { k: 'rect', x: 700, y: 500, w: 100, h: 40 },
    );
    const part = makePart(f, [0, 2])!;
    expect(part.shapes).toHaveLength(5);                                   // two buttons, two labels, the arrow between them
    expect(part.w).toBe(420); expect(part.h).toBe(40);
    expect((part.shapes[0] as { x: number; y: number; link?: string })).toMatchObject({ x: 0, y: 0 });
    expect((part.shapes[0] as { link?: string }).link).toBeUndefined();     // links are frame-specific
    const ctx = { W: 960, phone: false };
    const r = stampFromText('/pager', 40, 300, ctx, { pager: part })!;
    expect(r.kind).toBe('part');
    expect(r.shapes).toHaveLength(5);
    expect((r.shapes[0] as { x: number; y: number })).toMatchObject({ x: 40, y: 300 });
    expect(instantiate(part, 900, 10, 960).every((s) => !('x' in s) || (s as { x: number }).x + 0 >= 20)).toBe(true); // pulled back inside
    expect(partName('Nav Bar!')).toBe('nav-bar');
    expect(partName('button')).toBeNull();                                  // reserved
    expect(partName('   ')).toBeNull();
    const board = { frames: [f], parts: { pager: part } };
    const back = fromRawJSON(toRawJSON(board as never))!;
    expect(back.parts!.pager.shapes).toHaveLength(5);
    expect(validateBoard({ frames: [f], parts: { 'Bad Name': part } })!.parts).toBeUndefined();
  });
});

describe('frame links', () => {
  it('parses "-> target" in the outline, resolves it to frame ids and lists links', async () => {
    const { buildFromText, parseCell } = await import('../src/core/layout');
    const { resolveLinks, linksOf, dropLinksTo, linkAt, setLinks } = await import('../src/core/links');
    const { markdown } = await import('../src/core/exporters');
    expect(parseCell('button Sign in -> 2')).toMatchObject({ kind: 'button', label: 'Sign in', link: '2' });
    expect(parseCell('button Back -> Dashboard home')).toMatchObject({ label: 'Back', link: 'Dashboard home' });
    expect(parseCell('button Plain').link).toBeUndefined();
    const a = newFrame('desktop', 'Login'), b = newFrame('desktop', 'Dashboard home'), c = newFrame('desktop', 'Settings');
    const built = buildFromText(a, 'button Sign in -> 2 | button Settings -> settings | button Nope -> 9', null).frame;
    const bad = resolveLinks(built, [built, b, c]);
    expect(bad).toEqual(['9']);
    const board = { frames: [built, b, c] };
    const ls = linksOf(board);
    expect(ls.map((l) => [l.label, l.to])).toEqual([['Sign in', 1], ['Settings', 2]]);
    expect(markdown(board)).toContain('Button “Sign in” → Frame 2: Dashboard home');
    // click-through hit test and editing
    const rect = built.shapes.find((s) => s.k === 'rect' && s.link) as { x: number; y: number };
    expect(linkAt(built, { x: rect.x + 5, y: rect.y + 5 })).not.toBeNull();
    expect(linkAt(built, { x: 900, y: 590 })).toBeNull();
    const idx = built.shapes.findIndex((s) => s.k === 'rect' && s.link);
    expect(setLinks(built, [idx], null)).toBe(1);
    dropLinksTo(board, b.id); dropLinksTo(board, c.id);
    expect(linksOf(board)).toEqual([]);
  });
});

describe('radio and checkbox groups, multi-line labels and sub-labels', () => {
  it('splits a label into lines, treating indented later lines as sub-labels', async () => {
    const { textLines, textBlock } = await import('../src/core/geom');
    expect(textLines('Email\n  We send a receipt\nsecond line\n\n   fine print')).toEqual([
      { text: 'Email', sub: false, dy: 0 },
      { text: 'We send a receipt', sub: true, dy: 18 },
      { text: 'second line', sub: false, dy: 40 },
      { text: 'fine print', sub: true, dy: 58 },
    ]);
    expect(textBlock('One').h).toBeLessThan(textBlock('One\n  two').h);
  });

  it('boxes a stack of radios or checkboxes, however it was made', async () => {
    const { stampFromText, buildFromText, borderFor } = await import('../src/core/layout');
    const { classify } = await import('../src/core/semantics');
    const ctx = { W: 960, phone: false };
    const stamped = stampFromText('/radio Email, SMS, Push', 100, 100, ctx)!.shapes;
    expect(stamped[0].k).toBe('rect');                                   // the border comes first
    const f = newFrame(); f.shapes.push(...stamped);
    const c = classify(f);
    expect(c.els.filter((e) => e.role === 'Radio')).toHaveLength(3);
    expect(c.els.filter((e) => e.role === 'Radio').every((e) => e.parent === 0)).toBe(true);   // all three sit inside it
    expect(stampFromText('/radio Solo', 100, 100, ctx)!.shapes.some((s) => s.k === 'rect')).toBe(false);   // one radio needs no border
    const built = buildFromText(newFrame(), 'checkbox Terms\ncheckbox Newsletter\nbutton Go', null).frame;
    expect(built.shapes.filter((s) => s.k === 'rect' && (s as { w: number }).w > 100 && (s as { h: number }).h > 40).length).toBeGreaterThan(0);
    expect(classify(built).els.find((e) => e.role === 'Button')!.parent).toBeNull();           // the button is outside the group
    const b = borderFor([{ k: 'rect', x: 40, y: 40, w: 20, h: 20 }, { k: 'text', x: 70, y: 56, s: 'Hi' }]) as { x: number; y: number; h: number };
    expect([b.x, b.y]).toEqual([30, 30]);
    expect(b.h).toBeGreaterThanOrEqual(40);
  });

  it('turns indented text under a radio into its sub-label and keeps the stack spaced', async () => {
    const { buildFromText, setLabel } = await import('../src/core/layout');
    const { classify } = await import('../src/core/semantics');
    const { bounds } = await import('../src/core/geom');
    let f = buildFromText(newFrame(), 'radio Email\n  We send a receipt\nradio SMS\nradio Push', null).frame;
    let c = classify(f);
    const radios = c.els.filter((e) => e.role === 'Radio');
    expect(radios.map((e) => e.label)).toEqual(['Email\n  We send a receipt', 'SMS', 'Push']);
    const top = (i: number) => bounds(f.shapes[radios[i].i]).y;
    expect(top(1) - top(0)).toBeGreaterThan(top(2) - top(1) + 8);          // the first row is taller, the rest follow below it
    // typing a second line into SMS pushes Push down and grows the border
    const before = top(2);
    const border = f.shapes.findIndex((s) => s.k === 'rect' && (s as { w: number }).w > 60) ;
    const bh = (f.shapes[border] as { h: number }).h;
    f = setLabel(f, radios[1], 'SMS\n  standard rates apply');
    c = classify(f);
    const r2 = c.els.filter((e) => e.role === 'Radio');
    expect(bounds(f.shapes[r2[2].i]).y).toBeGreaterThan(before);
    expect((f.shapes[border] as { h: number }).h).toBeGreaterThan(bh);
  });

  it('draws sub-labels smaller and muted in SVG', async () => {
    const { shapeSVG } = await import('../src/core/exporters');
    const svg = shapeSVG({ k: 'text', x: 10, y: 20, s: 'Email\n  receipts only' }, 'sans-serif');
    expect(svg).toMatch(/font-size="18"[^>]*>Email</);
    expect(svg).toMatch(/y="38"[^>]*font-size="14"[^>]*fill="#868e96">receipts only</);
  });
});

describe('auto-fit', () => {
  it('sizes boxes to their text and keeps borders and stacks tidy without manual resizing', async () => {
    const { smartSize, classify } = await import('../src/core/semantics');
    const { bounds } = await import('../src/core/geom');
    const { setLabel, borderFor } = await import('../src/core/layout');
    // a button whose label is far wider than the button, and a two-line button
    const f = newFrame();
    f.shapes.push({ k: 'rect', x: 40, y: 40, w: 60, h: 30 }, { k: 'text', x: 44, y: 60, s: 'Create my account today' });
    f.shapes.push({ k: 'rect', x: 40, y: 140, w: 120, h: 30 }, { k: 'text', x: 50, y: 160, s: 'Save\n  and close' });
    const g = smartSize(f);
    const [a, b] = classify(g).els.filter((e) => e.role === 'Button');
    expect(bounds(g.shapes[a.i]).w).toBeGreaterThanOrEqual(bounds(g.shapes[a.labelIdx!]).w + 40);   // label fits with padding
    expect(bounds(g.shapes[b.i]).h).toBeGreaterThanOrEqual(bounds(g.shapes[b.labelIdx!]).h + 16);   // two lines fit
    // radios drifting a few pixels apart snap to one left edge, and their border hugs them
    const r = newFrame();
    r.shapes.push(
      { k: 'ell', x: 100, y: 100, w: 20, h: 20 }, { k: 'text', x: 128, y: 115, s: 'Email' },
      { k: 'ell', x: 108, y: 140, w: 20, h: 20 }, { k: 'text', x: 136, y: 155, s: 'SMS' },
    );
    r.shapes.push(borderFor(r.shapes));
    r.shapes[4] = { ...(r.shapes[4] as object), x: 40, w: 400 } as never;          // a border that is far too wide
    const t = smartSize(r);
    const radios = classify(t).els.filter((e) => e.role === 'Radio');
    expect(new Set(radios.map((e) => bounds(t.shapes[e.i]).x)).size).toBe(1);
    const border = t.shapes[4] as { w: number; x: number };
    expect(border.w).toBeLessThan(160);                                              // hugs the content again
    // a longer label in a bordered row widens the border by itself
    const radio = classify(t).els.find((e) => e.role === 'Radio')!;
    const u = setLabel(t, radio, 'Email me every single morning at dawn');
    expect((u.shapes[4] as { w: number }).w).toBeGreaterThan(border.w);
    // a paragraph fits its copy exactly: it shrinks as well as grows
    const p = newFrame(); p.shapes.push({ k: 'tlines', x: 40, y: 40, w: 600, h: 200 }, { k: 'rect', x: 40, y: 300, w: 120, h: 40 });
    const q = setLabel(p, classify(p).els.find((e) => e.role === 'Paragraph')!, 'Short.');
    expect((q.shapes[0] as { h: number }).h).toBe(60);
    expect((q.shapes[1] as { y: number }).y).toBe(300 - 140);
  });
});

describe('columns and long pages', () => {
  it('lays children side by side with ratios and equal-height cards, and grows the frame for long content', async () => {
    const { buildFromText } = await import('../src/core/layout');
    const { smartSize, classify } = await import('../src/core/semantics');
    const { bounds } = await import('../src/core/geom');
    const { frameSize } = await import('../src/core/types');
    const f = smartSize(buildFromText(newFrame(), 'header Top\ncolumns 1:3\n  card Menu\n    list One\n    list Two\n    list Three\n  card Content\n    text Hello\nbutton Done', null).frame);
    const cards = classify(f).els.filter((e) => e.role === 'Card');
    expect(cards).toHaveLength(2);
    expect(classify(f).els.filter((e) => e.role === 'List item')).toHaveLength(3);   // the intent survives a narrow column
    const [menu, content] = cards.map((e) => bounds(f.shapes[e.i]));
    expect(content.x).toBeGreaterThan(menu.x + menu.w);            // side by side
    expect(content.w).toBeGreaterThan(menu.w * 2);                 // 1:3
    expect(menu.h).toBe(content.h);                                // the shorter card stretches to the taller one
    expect(Math.abs(menu.y - content.y)).toBeLessThan(2);
    const done = classify(f).els.find((e) => e.role === 'Button' && e.label === 'Done')!;
    expect(bounds(f.shapes[done.i]).y).toBeGreaterThan(menu.y + menu.h);   // what follows sits below the columns
    // a long page makes the frame taller, and a short one shrinks it back
    const long = smartSize(buildFromText(newFrame(), Array.from({ length: 14 }, (_, i) => `input Field ${i}`).join('\n'), null).frame);
    expect(frameSize(long).h).toBeGreaterThan(600);
    expect(long.h).toBe(frameSize(long).h);
    long.shapes.splice(6);
    expect(frameSize(smartSize(long)).h).toBe(600);
  });

  it('gives toolbar buttons one width', async () => {
    const { buildFromText } = await import('../src/core/layout');
    const { smartSize, classify } = await import('../src/core/semantics');
    const { bounds } = await import('../src/core/geom');
    const f = smartSize(buildFromText(newFrame(), 'button Go | button Smart sizing | button Undo', null).frame);
    const ws = classify(f).els.filter((e) => e.role === 'Button').map((e) => bounds(f.shapes[e.i]).w);
    expect(new Set(ws).size).toBe(1);
  });
});

describe('long button rows', () => {
  it('wraps a toolbar that would run off the edge onto further lines', async () => {
    const { buildFromText } = await import('../src/core/layout');
    const { smartSize, classify } = await import('../src/core/semantics');
    const { bounds } = await import('../src/core/geom');
    const f = smartSize(buildFromText(newFrame(), 'button Grid | button Roles | button Smart sizing | button Tidy frame | button Undo | button Find | button MCP | button Export', null).frame);
    const bs = classify(f).els.filter((e) => e.role === 'Button').map((e) => bounds(f.shapes[e.i]));
    expect(bs).toHaveLength(8);
    expect(Math.max(...bs.map((b) => b.x + b.w))).toBeLessThanOrEqual(940);   // inside the frame
    expect(new Set(bs.map((b) => Math.round(b.y))).size).toBeGreaterThan(1);  // wrapped
    expect(new Set(bs.map((b) => b.w)).size).toBeLessThanOrEqual(2);          // one width per line
  });
});

describe('toolbar element', () => {
  it('makes compact label-sized buttons in one row, and keeps them compact through auto-fit', async () => {
    const { buildFromText } = await import('../src/core/layout');
    const { smartSize, classify } = await import('../src/core/semantics');
    const { bounds } = await import('../src/core/geom');
    const f = smartSize(buildFromText(newFrame(), 'toolbar Find / | All keys Ctrl K | Flow F | Draw D | Text T | Select V | Erase E | Review R | Grid G | Roles O | Undo | Image P | MCP | Export W', null).frame);
    const bs = classify(f).els.filter((e) => e.role === 'Button');
    expect(bs).toHaveLength(14);
    const boxes = bs.map((e) => bounds(f.shapes[e.i]));
    expect(new Set(boxes.map((b) => b.h))).toEqual(new Set([28]));                  // small
    expect(new Set(boxes.map((b) => b.w)).size).toBeGreaterThan(3);                  // each hugs its own label
    expect(new Set(boxes.map((b) => Math.round(b.y))).size).toBeLessThanOrEqual(2);  // 14 buttons take one or two slim rows, not four fat ones
    expect(Math.max(...boxes.map((b) => b.x + b.w))).toBeLessThanOrEqual(940);
    const x = classify(f).els.find((e) => e.label.startsWith('Flow'))!;
    expect(bounds(f.shapes[x.labelIdx!]).w).toBeLessThanOrEqual(bounds(f.shapes[x.i]).w - 12);   // label inside its button
  });
});

describe('copy and paste helpers', () => {
  it('finds where a selection sits, and a copy of it instantiates elsewhere with its label', async () => {
    const { makePart, selectionOrigin } = await import('../src/core/parts');
    const { instantiate } = await import('../src/core/layout');
    const { classify } = await import('../src/core/semantics');
    const f = newFrame();
    f.shapes.push({ k: 'rect', x: 100, y: 200, w: 120, h: 40, role: 'Button' }, { k: 'text', x: 120, y: 228, s: 'Save' }, { k: 'rect', x: 400, y: 400, w: 80, h: 40 });
    const sel = [0];
    expect(selectionOrigin(f, sel)).toEqual({ x: 100, y: 200 });
    const part = makePart(f, sel)!;
    expect(part.shapes).toHaveLength(2);                            // the button and its label travel together
    const g = newFrame(); g.shapes.push(...instantiate(part, 140, 220, 960));
    const el = classify(g).els.find((e) => e.role === 'Button')!;
    expect(el.label).toBe('Save');
    expect((g.shapes[0] as { x: number }).x).toBe(140);
  });
});

describe('slash suggestions', () => {
  it('ranks names before short names, and includes saved parts', async () => {
    const { slashMatches } = await import('../src/core/layout');
    const parts = { 'nav-bar': { w: 560, h: 44, shapes: [] } };
    expect(slashMatches('nav', parts as never).map((s) => s.name)).toEqual(['nav-bar', 'header']);     // the part by name, then /header whose short name is nav
    expect(slashMatches('', parts as never).length).toBeGreaterThan(12);                              // "/" alone lists everything
    expect(slashMatches('ra')[0].name).toBe('radio');
    expect(slashMatches('zzzz')).toEqual([]);
  });
});

describe('palette search', () => {
  it('filters actions, stamps and parts; a leading slash means commands only', async () => {
    const { filterItems } = await import('../src/core/palette');
    const items = [
      { kind: 'action' as const, key: 'g', label: 'Grid snap', hint: 'Edit' },
      { kind: 'action' as const, key: 'f', label: 'Flow', hint: 'Tools' },
      { kind: 'stamp' as const, label: '/radio', hint: 'radio buttons', also: ['rb'] },
      { kind: 'stamp' as const, label: '/header', hint: 'full-width top bar', also: ['nav'] },
      { kind: 'part' as const, label: '/nav-bar', hint: 'Top navigation links' },
    ];
    expect(filterItems(items, '')).toHaveLength(5);
    expect(filterItems(items, 'grid').map((i) => i.label)).toEqual(['Grid snap']);
    expect(filterItems(items, '/nav').map((i) => i.label)).toEqual(['/nav-bar', '/header']);        // part by name, then the short name
    expect(filterItems(items, '/f')).toEqual([]);                                                    // "Flow" is an action, not a / command
    expect(filterItems(items, 'navigation').map((i) => i.label)).toEqual(['/nav-bar']);              // matches the one-line description
    expect(filterItems(items, '/rb').map((i) => i.label)).toEqual(['/radio']);
  });

  it('keeps a part\'s one-line description through save, clone and slash suggestions', async () => {
    const { validateBoard } = await import('../src/core/model');
    const { cloneBoard } = await import('../src/core/types');
    const { slashMatches } = await import('../src/core/layout');
    const part = { w: 100, h: 40, shapes: [{ k: 'rect', x: 0, y: 0, w: 100, h: 40 }], note: 'Top navigation links' };
    const b = validateBoard({ frames: [newFrame()], parts: { 'nav-bar': part } })!;
    expect(b.parts!['nav-bar'].note).toBe('Top navigation links');
    expect(cloneBoard(b).parts!['nav-bar'].note).toBe('Top navigation links');
    expect(slashMatches('nav', b.parts)[0].hint).toBe('Top navigation links');
  });
});

describe('ghost hints in inputs', () => {
  it('reads a quoted hint or an indented line, keeps the box an input, and moves with it', async () => {
    const { buildFromText, parseCell, setHint, deleteElement, stampFromText, slashMatches } = await import('../src/core/layout');
    const { classify, smartSize, moveGroup } = await import('../src/core/semantics');
    const { bounds } = await import('../src/core/geom');
    expect(parseCell('input Email "you@example.com"')).toMatchObject({ kind: 'input', label: 'Email', hint: 'you@example.com' });
    expect(parseCell('input "Search..."')).toMatchObject({ label: '', hint: 'Search...' });
    const f = smartSize(buildFromText(newFrame(), 'input Email "you@example.com"\ninput Password\n  at least 8 characters\ninput Plain', null).frame);
    const inputs = classify(f).els.filter((e) => e.role === 'Input');
    expect(inputs.map((e) => [e.label, e.hint])).toEqual([['Email', 'you@example.com'], ['Password', 'at least 8 characters'], ['Plain', '']]);
    // the hint sits inside its box, greyed, and does not become a separate element
    const e0 = inputs[0], box = bounds(f.shapes[e0.i]), g = bounds(f.shapes[e0.ghostIdx!]);
    expect(g.x).toBeGreaterThan(box.x); expect(g.y).toBeGreaterThan(box.y); expect(g.y + g.h).toBeLessThan(box.y + box.h + 4);
    expect((f.shapes[e0.ghostIdx!] as { ghost?: boolean }).ghost).toBe(true);
    expect(classify(f).els.filter((e) => e.role === 'Text')).toHaveLength(0);
    expect(moveGroup(f, classify(f), e0.i).has(e0.ghostIdx!)).toBe(true);
    // set / change / clear / delete
    let h = setHint(f, inputs[2], 'optional');
    expect(classify(h).els.find((e) => e.label === 'Plain')!.hint).toBe('optional');
    h = setHint(h, classify(h).els.find((e) => e.label === 'Plain')!, '');
    expect(classify(h).els.find((e) => e.label === 'Plain')!.hint).toBe('');
    const gone = deleteElement(f, inputs[0]);
    expect(gone.shapes.some((s) => s.k === 'text' && (s as { s: string }).s === 'you@example.com')).toBe(false);
    // stamps accept it too, and a hint in a wide input does not turn it into a button
    const st = newFrame(); st.shapes.push(...stampFromText('/field Email "you@example.com"', 40, 40, { W: 960, phone: false })!.shapes);
    expect(classify(st).els.map((e) => e.role)).toEqual(['Input']);
    void slashMatches;
  });

  it('shows saved parts in the "/" list even when nothing else is typed, ahead of the built-ins', async () => {
    const { slashMatches } = await import('../src/core/layout');
    const parts = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`part-${i}`, { w: 100, h: 40, shapes: [], note: `mine ${i}` }]));
    const all = slashMatches('', parts as never).map((s) => s.name);
    expect(all.slice(0, 4)).toEqual(['part-0', 'part-1', 'part-2', 'part-3']);
    expect(all).toContain('radio');
    expect(all.length).toBe(4 + 16);
  });

  it('draws the hint greyed and italic in SVG', async () => {
    const { shapeSVG } = await import('../src/core/exporters');
    expect(shapeSVG({ k: 'text', x: 10, y: 20, s: 'you@example.com', ghost: true }, 'sans-serif')).toMatch(/font-style="italic" fill="#868e96">you@example.com</);
  });
});

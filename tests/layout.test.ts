import { describe, it, expect } from "vitest";
import { buildFromText, stampFromText } from "../src/core/layout";
import { classify, smartSize } from "../src/core/semantics";
import { lineD, lineHops } from "../src/core/exporters";
import { textWidth } from "../src/core/geom";
import { newFrame, type Shape } from "../src/core/types";

describe('group title stamp', () => {
  it('puts the title above the border', () => {
    const r = stampFromText('/radio Contact by: Email, SMS', 20, 20, { W: 960, phone: false })!;
    const title = r.shapes.find((s) => s.k === 'text' && s.s === 'Contact by')!;
    const border = r.shapes.find((s) => s.k === 'rect' && s.grp)!;
    expect((title as any).y).toBeLessThan((border as any).y);
    expect(r.shapes.some((s) => s.k === 'text' && s.s === 'Email')).toBe(true);
  });
});

describe('basic controls', () => {
  it('builds dropdown, search, button group and badge from the outline', () => {
    const f = { device: 'desktop', caption: '', notes: [], id: 'f', shapes: [] } as any;
    const r = buildFromText(f, 'dropdown Country "Pick one"\nsearch\ntabs Day | Week | Month\nbadge New', null).frame;
    const texts = r.shapes.filter((s: any) => s.k === 'text').map((s: any) => s.s);
    expect(texts).toEqual(expect.arrayContaining(['Country', 'Pick one   \u25BE', 'Search', 'Day', 'Week', 'Month', 'New']));
    const btns = r.shapes.filter((s: any) => s.k === 'rect' && s.sm) as any[];
    expect(btns[1].x).toBe(btns[0].x + btns[0].w);   // the group's buttons touch
  });
});

describe('card of radios', () => {
  it('is just the group: title above one border, no second box', () => {
    const f = { device: 'desktop', caption: '', notes: [], id: 'f', shapes: [] } as any;
    const r = buildFromText(f, 'card Contact by\n  radio Email\n  radio SMS', null).frame;
    const rects = r.shapes.filter((s: any) => s.k === 'rect') as any[];
    expect(rects).toHaveLength(1);
    expect(rects[0].grp).toBe(true);
    const title = r.shapes.find((s: any) => s.k === 'text' && s.s === 'Contact by') as any;
    expect(title.y).toBeLessThan(rects[0].y);
  });
});

describe('card title over radios', () => {
  it('moves a title that sits among the options up above the card, and keeps it owned', () => {
    const f = { device: 'desktop', caption: '', notes: [], id: 'f', shapes: [
      { k: 'rect', x: 20, y: 60, w: 90, h: 130, role: 'Card' }, { k: 'text', s: 'fart', x: 30, y: 96 },
      { k: 'ell', x: 30, y: 76, w: 20, h: 20, role: 'Radio' }, { k: 'text', s: 'a', x: 58, y: 92 },
      { k: 'ell', x: 30, y: 110, w: 20, h: 20, role: 'Radio' }, { k: 'text', s: 'b', x: 58, y: 126 },
    ] } as any;
    const z = smartSize(f);
    expect((z.shapes[1] as any).y).toBeLessThan((z.shapes[0] as any).y);
    expect(classify(z).els.find((e) => e.role === 'Card')!.label).toBe('fart');
  });
});

describe('label placement on boxes and circles', () => {
  const frame = (...shapes: Shape[]) => { const f = newFrame(); f.shapes.push(...shapes); return f; };
  const label = (f: ReturnType<typeof frame>, i = 0) => { const c = classify(f); return c.byIndex.get(i)?.labelIdx ?? null; };
  const box = { k: 'rect', x: 200, y: 200, w: 200, h: 100 } as const;
  const word = { k: 'text', x: 230, y: 250, s: 'Title' } as const;
  const at = (host: object, t: Shape = word) => smartSize(frame({ ...box, ...host } as Shape, t)).shapes[1] as { x: number; y: number };

  it('vertical: above, inside or underneath, and the label is still owned', () => {
    expect(label(smartSize(frame({ ...box, lbl: 'top' }, word)))).toBe(1);
    expect(at({ lbl: 'top' }).y).toBeLessThan(200);
    const inTop = at({ lbl: 'inTop' }).y, mid = at({ lbl: 'middle' }).y, inBottom = at({ lbl: 'inBottom' }).y;
    expect(inTop).toBeGreaterThan(200); expect(inTop).toBeLessThan(mid); expect(mid).toBeLessThan(inBottom); expect(inBottom).toBeLessThan(300);
    expect(at({ lbl: 'bottom' }).y).toBeGreaterThan(300);
  });

  it('justification works at every vertical position', () => {
    for (const lbl of ['top', 'inTop', 'middle', 'inBottom', 'bottom']) {
      const l = at({ lbl, lj: 'left' }).x, c = at({ lbl, lj: 'center' }).x, r = at({ lbl, lj: 'right' }).x;
      expect(l).toBeLessThan(c); expect(c).toBeLessThan(r);
    }
  });

  it('a circle grows to hold its words, and detached text is nobody\'s label', () => {
    const f = smartSize(frame({ k: 'ell', x: 100, y: 100, w: 60, h: 60, role: 'Circle', lbl: 'middle' }, { k: 'text', x: 105, y: 135, s: 'A rather long caption' }));
    expect((f.shapes[0] as { w: number }).w).toBeGreaterThan(60);
    expect(label(f)).toBe(1);
    const free = frame({ ...box, lbl: 'middle' }, { ...word, free: true });
    expect(label(free)).toBeNull();
    expect(JSON.stringify(smartSize(free).shapes[1])).toBe(JSON.stringify(free.shapes[1])); // not re-placed either
  });

  it('wraps long words to fit inside, and only grows the shape when the wrapped text still does not fit', () => {
    const long = 'A fairly long sentence that cannot sit on one line of a small box';
    const big = smartSize(frame({ ...box, h: 200, lbl: 'middle' }, { ...word, s: long }));
    const t = big.shapes[1] as { wrap?: number };
    expect(t.wrap).toBeGreaterThan(0);
    expect((big.shapes[0] as { w: number; h: number }).w).toBe(200);          // width untouched
    expect((big.shapes[0] as { w: number; h: number }).h).toBe(200);          // it fits wrapped: no growth
    const small = smartSize(frame({ ...box, h: 40, lbl: 'middle' }, { ...word, s: long }));
    expect((small.shapes[0] as { w: number; h: number }).w).toBe(200);
    expect((small.shapes[0] as { w: number; h: number }).h).toBeGreaterThan(40); // too tall wrapped: grows
    const short = smartSize(frame({ ...box, lbl: 'middle' }, word)).shapes[1] as { wrap?: number };
    expect(short.wrap).toBeUndefined();
    const circ = smartSize(frame({ k: 'ell', x: 100, y: 100, w: 100, h: 100, lbl: 'middle' }, { ...word, x: 120, y: 150, s: long }));
    const cs = circ.shapes[0] as { w: number; h: number };
    expect(cs.w).toBe(cs.h);                                                  // still round
    expect(cs.w).toBeGreaterThan(100);
  });

  it('several lines line up the way the label is justified', async () => {
    const { textLines } = await import('../src/core/geom');
    const long = 'A fairly long sentence that cannot sit on one line of a small box';
    const centred = smartSize(frame({ ...box, h: 200, lbl: 'middle', lj: 'center' }, { ...word, s: long })).shapes[1] as { s: string; wrap?: number; al?: 'center' | 'right' };
    expect(centred.al).toBe('center');
    const ls = textLines(centred.s, centred.wrap, centred.al);
    expect(ls.length).toBeGreaterThan(1);
    expect(Math.max(...ls.map((l) => l.dx ?? 0))).toBeGreaterThan(0);              // a short line is pushed in toward the middle
    expect(ls.some((l) => !l.dx)).toBe(true);                             // the longest line is not
    const left = smartSize(frame({ ...box, h: 200, lbl: 'middle', lj: 'left' }, { ...word, s: long })).shapes[1] as { al?: string };
    expect(left.al).toBeUndefined();
    const right = smartSize(frame({ ...box, h: 200, lbl: 'middle', lj: 'right' }, { ...word, s: long })).shapes[1] as { s: string; wrap?: number; al?: 'center' | 'right' };
    expect(textLines(right.s, right.wrap, right.al).every((l) => (l.dx ?? 0) >= 0)).toBe(true);
  });
});

describe('shrinking a shape with words in it', () => {
  it('keeps it a circle/box with its label, and a resized shape keeps its size', () => {
    const f = newFrame();
    f.shapes.push({ k: 'ell', x: 100, y: 200, w: 40, h: 40, lbl: 'middle' } as any, { k: 'text', x: 106, y: 225, s: 'Hello there' } as any);
    const c = classify(f);
    expect(c.els[0].role).toBe('Circle');
    expect(c.els[0].labelIdx).not.toBeNull();
    const g = smartSize(f, 0);
    expect(g.shapes[0]).toMatchObject({ w: 40, h: 40 });
  });
});

describe('turned shapes keep their words', () => {
  it('a label turns with its box and stays owned', () => {
    const f = newFrame();
    f.shapes.push({ k: 'rect', x: 200, y: 200, w: 160, h: 90, rot: 90, lbl: 'inTop' } as any, { k: 'text', x: 240, y: 230, s: 'Hello' } as any);
    const g = smartSize(f);
    const t = g.shapes[1] as any;
    expect(t.rot).toBe(90);                      // the words lie the same way as the box
    expect(classify(g).els[0].labelIdx).toBe(1);   // and still belong to it
    const c = classify(g);
    expect(c.owner.get(1)).toBe(0);
  });
});

describe('hops over turned shapes', () => {
  it('follow the turned outline', async () => {
    const { lineHops } = await import('../src/core/exporters');
    const f = newFrame();
    f.shapes.push({ k: 'rect', x: 200, y: 200, w: 160, h: 40, rot: 90 } as any, { k: 'line', x1: 100, y1: 160, x2: 400, y2: 160, arrow: true } as any);
    expect(lineHops(f).get(1)?.length).toBe(2);
  });
});

describe('turned cards', () => {
  it('a label does not drift when smartSize runs again', () => {
    const f = newFrame();
    f.shapes.push({ k: 'rect', x: 200, y: 200, w: 200, h: 140, rot: 30 } as any, { k: 'text', x: 240, y: 230, s: 'Title' } as any);
    const g = smartSize(f), h = smartSize(smartSize(g));
    expect(h.shapes[1]).toEqual(g.shapes[1]);
  });
});

describe('arrow labels', () => {
  it('words beside an arrow are its label, sit on its run and follow it', () => {
    const f = newFrame();
    f.shapes.push({ k: 'line', x1: 100, y1: 300, x2: 400, y2: 300, arrow: true } as any, { k: 'text', x: 200, y: 280, s: 'yes' } as any);
    const c = classify(f);
    expect(c.els).toHaveLength(1);
    expect(c.els[0].labelIdx).toBe(1);
    const g = smartSize(f), t = g.shapes[1] as any;
    expect(Math.abs(t.y - 306)).toBeLessThan(8);         // printed on the line, not above it
    expect(Math.abs(t.x + textWidth('yes') / 2 - 250)).toBeLessThan(2);   // centred on its middle
    const hp = lineHops(g).get(0)!;
    expect(hp.some((h) => h.gap !== undefined && h.seg === 0)).toBe(true);   // and the line breaks there
    expect(lineD(g.shapes[0] as any, hp)).toContain('M');
    const lone = newFrame();
    lone.shapes.push({ k: 'line', x1: 100, y1: 300, x2: 400, y2: 300, arrow: true } as any, { k: 'text', x: 200, y: 450, s: 'far' } as any);
    expect(classify(lone).els).toHaveLength(2);          // too far to be a label
  });
});

describe('image descriptions and pictures', () => {
  const PIC = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  it('text under an image is its description and is centred beneath it', () => {
    const f = newFrame();
    f.shapes.push({ k: 'img', x: 100, y: 100, w: 200, h: 120 } as any, { k: 'text', x: 110, y: 250, s: 'Team photo' } as any);
    const c = classify(f);
    expect(c.els).toHaveLength(1);
    expect(c.els[0].role).toBe('Image');
    expect(c.els[0].label).toBe('Team photo');
    const t = smartSize(f).shapes[1] as any;
    expect(Math.abs(t.x + textWidth('Team photo') / 2 - 200)).toBeLessThan(2);
    expect(t.y).toBeGreaterThan(220);
  });
  it('keeps a picture through save and load, and shows it in the SVG', async () => {
    const { fromRawJSON, toRawJSON } = await import('../src/core/model');
    const { frameSVG } = await import('../src/core/exporters');
    const f = newFrame();
    f.shapes.push({ k: 'img', x: 100, y: 100, w: 200, h: 120, src: PIC } as any);
    const b = fromRawJSON(toRawJSON({ frames: [f] } as any))!;
    expect((b.frames[0].shapes[0] as any).src).toBe(PIC);
    expect(frameSVG(b.frames[0])).toContain('<image');
    const bad = fromRawJSON(JSON.stringify({ frames: [{ id: 'a', device: 'desktop', caption: '', notes: [], shapes: [{ k: 'img', x: 1, y: 1, w: 9, h: 9, src: 'javascript:alert(1)' }] }] }))!;
    expect((bad.frames[0].shapes[0] as any).src).toBeUndefined();
  });
});

describe('arrow labels through re-routing', () => {
  it('keep their arrow when a shape it joins moves a long way', async () => {
    const { connect } = await import('../src/core/connect');
    const { arrowLabelOwners, placeArrowLabels } = await import('../src/core/semantics');
    const f = newFrame();
    f.shapes.push({ k: 'rect', x: 100, y: 200, w: 120, h: 60 } as any, { k: 'rect', x: 500, y: 200, w: 120, h: 60 } as any,
      { k: 'line', x1: 220, y1: 230, x2: 500, y2: 230, arrow: true } as any, { k: 'text', x: 340, y: 216, s: 'yes' } as any);
    expect(arrowLabelOwners(f).get(2)).toBe(3);
    const owners = arrowLabelOwners(f);
    (f.shapes[1] as any).y = 420; (f.shapes[1] as any).x = 380;   // far from where the label was
    connect(f, 2, 0, 1);
    placeArrowLabels(f, owners);
    expect(arrowLabelOwners(f).get(2)).toBe(3);
  });
});

describe('arrow labels are remembered, not guessed', () => {
  it('stay with their arrow however far it moves, and survive a pasted copy', async () => {
    const { smartSize } = await import('../src/core/semantics');
    let f = newFrame();
    f.shapes.push({ k: 'line', x1: 100, y1: 300, x2: 400, y2: 300, arrow: true } as any, { k: 'text', x: 200, y: 290, s: 'yes' } as any);
    f = smartSize(f);
    const id = (f.shapes[0] as any).id;
    expect(id).toBeTruthy();
    expect((f.shapes[1] as any).of).toBe(id);
    // the arrow jumps 300px away without the words: still its label
    const l = f.shapes[0] as any; l.y1 += 300; l.y2 += 300;
    expect(classify(f).byIndex.get(0)!.labelIdx).toBe(1);
    // a copy of the arrow (same id) does not steal it, and gets its own id
    f.shapes.push({ ...l, y1: 900, y2: 900 });   // a duplicate id that is farther away
    const g = smartSize(f);
    expect(classify(g).byIndex.get(0)!.labelIdx).toBe(1);
    expect((g.shapes[2] as any).id).not.toBe(id);
  });
  it('a pasted part gets new ids for its arrows and labels', async () => {
    const { instantiate } = await import('../src/core/layout');
    const part = { w: 300, h: 40, shapes: [{ k: 'line', x1: 0, y1: 10, x2: 300, y2: 10, arrow: true, id: 'a1' }, { k: 'text', x: 100, y: 0, s: 'yes', of: 'a1' }] } as any;
    const out = instantiate(part, 50, 50) as any[];
    expect(out[0].id).toBeTruthy();
    expect(out[0].id).not.toBe('a1');
    expect(out[1].of).toBe(out[0].id);
  });
  it('a box keeps its label too, even when the words end up well outside it', async () => {
    const { smartSize } = await import('../src/core/semantics');
    let f = newFrame();
    f.shapes.push({ k: 'rect', x: 100, y: 200, w: 200, h: 40 } as any, { k: 'text', x: 120, y: 226, s: 'Save' } as any);
    f = smartSize(f);
    const id = (f.shapes[0] as any).id;
    expect(id).toBeTruthy();
    expect((f.shapes[1] as any).of).toBe(id);
    (f.shapes[1] as any).x = 600; (f.shapes[1] as any).y = 500;   // words land nowhere near the box
    expect(classify(f).byIndex.get(0)!.labelIdx).toBe(1);
    expect(classify(f).els).toHaveLength(1);
    (f.shapes[1] as any).free = true; delete (f.shapes[1] as any).of;   // D: cut loose
    expect(classify(f).els).toHaveLength(2);
  });
});

describe('compact buttons in a row', () => {
  it('stay clear of each other after they hug their labels', () => {
    const f = newFrame();
    const w = [60, 60, 60], x = [20, 80, 150];   // drawn too narrow for their words
    ['Pause training', 'Reset car', 'Save checkpoint'].forEach((s, k) => {
      f.shapes.push({ k: 'rect', x: x[k], y: 92, w: w[k], h: 28, sm: true, role: 'Button' } as any, { k: 'text', x: x[k] + 6, y: 112, s } as any);
    });
    const g = smartSize(f);
    const r = [0, 2, 4].map((i) => g.shapes[i] as any);
    expect(r[0].x + r[0].w).toBeLessThanOrEqual(r[1].x);
    expect(r[1].x + r[1].w).toBeLessThanOrEqual(r[2].x);
  });
});

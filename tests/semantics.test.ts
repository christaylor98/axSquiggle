import { describe, expect, it } from 'vitest';
import { classify, smartSize } from '../src/core/semantics';
import { exampleBoard } from '../src/core/model';
import { textWidth } from '../src/core/geom';
import { newFrame, type Role, type Shape } from '../src/core/types';

const summary = (f: ReturnType<typeof newFrame>) => classify(f).els.map((e) => `${e.role}${e.label ? ':' + e.label : ''}`);

describe('semantics: the example board', () => {
  const [login, dash, phone] = exampleBoard().frames;

  it('login screen', () => {
    expect(summary(login)).toEqual(['Header:Acme', 'Card:Sign in', 'Input:Email', 'Input:Password', 'Checkbox:Remember me', 'Button:Sign in', 'Text:Forgot password?']);
  });
  it('dashboard', () => {
    const roles = summary(dash);
    expect(roles).toContain('Header:Dashboard');
    expect(roles).toContain('Avatar');
    expect(roles).toContain('Sidebar:Menu');
    for (const t of ['Revenue', 'Users', 'Orders', 'Recent activity']) expect(roles).toContain(`Card:${t}`);
    expect(roles.filter((r) => r.startsWith('List item')).length).toBe(2);
    expect(roles).toContain('Paragraph');
  });
  it('phone task list', () => {
    const roles = summary(phone);
    expect(roles.filter((r) => r.startsWith('Checkbox')).length).toBe(3);
    expect(roles.filter((r) => r.startsWith('List item')).length).toBe(3);
    expect(roles).toEqual(expect.arrayContaining(['Header:Tasks', 'Avatar', 'Input:New task', 'Button:Add task']));
  });
  it('is idempotent under smart sizing', () => {
    for (const f of [login, dash, phone]) expect(smartSize(f).shapes).toEqual(f.shapes);
  });
});

describe('semantics: other roles', () => {
  const f = newFrame('desktop');
  f.shapes = [
    { k: 'img', x: 20, y: 100, w: 100, h: 80 }, { k: 'line', x1: 20, y1: 200, x2: 200, y2: 200 },
    { k: 'line', x1: 20, y1: 220, x2: 200, y2: 260, arrow: true }, { k: 'free', pts: [[300, 300], [320, 330], [340, 300]] },
    { k: 'ell', x: 400, y: 300, w: 20, h: 20 }, { k: 'ell', x: 500, y: 300, w: 120, h: 120 },
  ] as Shape[];
  it('maps shape kinds to roles', () => {
    const r = classify(f).els.map((e) => e.role);
    expect(r.sort()).toEqual((['Image', 'Divider', 'Arrow', 'Sketch', 'Radio', 'Circle'] as Role[]).sort());
  });
});

describe('smart sizing', () => {
  it('a sloppy 243x57 input above a 260-wide input becomes 260x44', () => {
    const f = newFrame('desktop');
    f.shapes = [{ k: 'rect', x: 100, y: 100, w: 243, h: 57 }, { k: 'rect', x: 100, y: 200, w: 260, h: 44 }];
    const out = smartSize(f);
    expect(summary(f)).toEqual(['Input', 'Input']);
    expect(out.shapes[0]).toMatchObject({ x: 100, w: 260, h: 44 });
    expect(out.shapes[1]).toMatchObject({ x: 100, w: 260, h: 44 });
  });
  it('a 60x52 button labelled Continue becomes >=120x40 with the label centred', () => {
    const f = newFrame('desktop');
    f.shapes = [{ k: 'rect', x: 100, y: 100, w: 60, h: 52 }, { k: 'text', x: 102, y: 132, s: 'Continue' }];
    expect(summary(f)).toEqual(['Button:Continue']);
    const out = smartSize(f);
    const r = out.shapes[0] as { x: number; y: number; w: number; h: number };
    const t = out.shapes[1] as { x: number; y: number };
    expect(r.w).toBeGreaterThanOrEqual(120);
    expect(r.h).toBe(40);
    expect(Math.abs(t.x + textWidth('Continue') / 2 - (r.x + r.w / 2))).toBeLessThan(1);
    expect(t.y).toBeGreaterThan(r.y);
    expect(t.y).toBeLessThan(r.y + r.h + 4);
  });
  it('uses 48-high buttons and inputs on phone', () => {
    const f = newFrame('phone');
    f.shapes = [{ k: 'rect', x: 20, y: 100, w: 150, h: 60 }, { k: 'text', x: 40, y: 135, s: 'Go' }];
    expect((smartSize(f).shapes[0] as { h: number }).h).toBe(48);
  });
  it('stretches a header to full width with even margins', () => {
    const f = newFrame('desktop');
    f.shapes = [{ k: 'rect', x: 33, y: 10, w: 800, h: 60 }];
    expect(smartSize(f).shapes[0]).toMatchObject({ x: 20, w: 920 });
  });
  it('places an input label 8px above its top-left', () => {
    const f = newFrame('desktop');
    f.shapes = [{ k: 'rect', x: 100, y: 200, w: 300, h: 50 }, { k: 'text', x: 110, y: 188, s: 'Name' }];
    expect(summary(f)).toEqual(['Input:Name']);
    expect(smartSize(f).shapes[1]).toMatchObject({ x: 100, y: 192 });
  });
});

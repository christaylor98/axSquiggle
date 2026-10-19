import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { excalidraw, figmaSVG, frameSVG, markdown, storyboardHTML } from '../src/core/exporters';
import { exampleBoard, fromRawJSON, toRawJSON } from '../src/core/model';
import { newNote } from '../src/core/types';

function parseXML(src: string) {
  const errors: string[] = [];
  const doc = new DOMParser({ onError: (_l: string, m: string) => errors.push(m) }).parseFromString(src, 'image/svg+xml');
  expect(errors).toEqual([]);
  return doc;
}

const board = exampleBoard();
board.frames[0].notes.push(newNote('Make <this> & that bigger', [0, 0, 10, 10], ['Button "Sign in"']));

describe('exports', () => {
  it('SVG per frame parses as XML', () => {
    for (const f of board.frames) {
      const doc = parseXML(frameSVG(f));
      expect(doc.documentElement!.tagName).toBe('svg');
      expect(doc.getElementsByTagName('text').length).toBeGreaterThan(0);
    }
  });

  it('Figma SVG parses, has one group per screen and "Role / label" ids in Inter', () => {
    const svg = figmaSVG(board);
    const doc = parseXML(svg);
    const ids = Array.from(doc.getElementsByTagName('g')).map((g) => g.getAttribute('id'));
    expect(ids).toContain('Button / Sign in');
    expect(ids).toContain('Input / Email');
    expect(ids.filter((i) => i?.startsWith('Frame '))).toHaveLength(3);
    expect(svg).toContain('font-family="Inter');
    expect(new Set(ids).size).toBe(ids.length);
    // frames laid left to right
    const xs = Array.from(doc.getElementsByTagName('g')).filter((g) => g.getAttribute('id')?.startsWith('Frame ')).map((g) => Number(/translate\(([-\d.]+)/.exec(g.getAttribute('transform')!)![1]));
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(3);
  });

  it('Excalidraw JSON has a valid elements array', () => {
    const j = JSON.parse(excalidraw(board));
    expect(j.type).toBe('excalidraw');
    expect(Array.isArray(j.elements)).toBe(true);
    expect(j.elements.length).toBeGreaterThan(30);
    const ids = new Set<string>();
    for (const e of j.elements) {
      for (const k of ['id', 'type', 'x', 'y', 'width', 'height', 'angle', 'strokeColor', 'seed', 'version', 'versionNonce', 'isDeleted']) expect(e).toHaveProperty(k);
      expect(['rectangle', 'ellipse', 'line', 'arrow', 'text']).toContain(e.type);
      expect(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.width) && Number.isFinite(e.height)).toBe(true);
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
      if (e.type === 'text') expect(typeof e.text).toBe('string');
      if (e.type === 'line' || e.type === 'arrow') expect(e.points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('Excalidraw uses the arrow type for arrows and lays frames left to right', () => {
    const b = exampleBoard();
    b.frames[0].shapes.push({ k: 'line', x1: 0, y1: 0, x2: 50, y2: 50, arrow: true });
    const j = JSON.parse(excalidraw(b));
    expect(j.elements.filter((e: { type: string }) => e.type === 'arrow')).toHaveLength(1);
    const outlines = j.elements.filter((e: { strokeStyle: string }) => e.strokeStyle === 'dashed');
    expect(outlines.map((e: { x: number }) => e.x)).toEqual([0, 1080, 2160]);
  });

  it('Markdown has captions, frame-N.png refs and Review notes', () => {
    const md = markdown(board);
    expect(md).toContain('![Frame 1](frame-1.png)');
    expect(md).toContain('![Frame 3](frame-3.png)');
    expect(md).toContain('### Review notes');
    expect(md).toContain('Make <this> & that bigger');
    expect(md).toContain('Login');
  });

  it('single-file HTML storyboard is self-contained and well-formed per frame', () => {
    const html = storyboardHTML(board);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect((html.match(/<svg /g) ?? []).length).toBe(3);
    expect(html).toContain('Make &lt;this&gt; &amp; that bigger');
  });

  it('raw JSON round-trips through import', () => {
    const back = fromRawJSON(toRawJSON(board))!;
    expect(back.frames).toHaveLength(3);
    expect(back.frames[1].shapes).toEqual(board.frames[1].shapes);
    expect(fromRawJSON('not json')).toBeNull();
    expect(fromRawJSON('{"frames":[{"shapes":[{"k":"nope"}]}]}')!.frames[0].shapes).toEqual([]);
  });
});

describe('avatar icon', () => {
  it('draws a person glyph inside avatar circles in the editor, SVG, Figma and Excalidraw exports', () => {
    const svg = frameSVG(board.frames[1]);                         // the dashboard has a header avatar
    expect(svg).toMatch(/<ellipse[^>]*rx="20"[^>]*\/><path d="M[\d. ]+A/);
    expect(figmaSVG(board)).toMatch(/Avatar[^>]*>.*<path d="M[\d. ]+A/);
    const ex = JSON.parse(excalidraw(board)).elements.filter((e: { type: string }) => e.type === 'ellipse');
    expect(ex.length).toBeGreaterThan(2);                          // the ring plus the glyph's head
    parseXML(svg);                                                  // still valid XML
  });
});

describe('clickable prototype', () => {
  it('is one offline file with every frame inline and a hotspot per link', async () => {
    const { prototypeHTML } = await import('../src/core/exporters');
    const { setLinks } = await import('../src/core/links');
    const b = JSON.parse(JSON.stringify(exampleBoard()));
    const btn = b.frames[0].shapes.findIndex((s: { k: string; role?: string }) => s.k === 'rect' && s.role === 'Button');
    const i = btn >= 0 ? btn : b.frames[0].shapes.findIndex((s: { k: string }) => s.k === 'rect');
    setLinks(b.frames[0], [i], b.frames[1].id);
    const html = prototypeHTML(b, 'Demo <flow>');
    expect((html.match(/<svg class="frame"/g) ?? []).length).toBe(b.frames.length);
    expect(html).toContain('<a href="#2"');
    expect((html.match(/<rect class="hs"/g) ?? []).length).toBe(1);
    expect(html).toContain('Demo &lt;flow&gt;');                                   // the title is escaped
    expect(html.replace(/xmlns="[^"]*"/g, '')).not.toMatch(/(src|href)="https?:/);   // nothing is fetched from anywhere
    const js = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
    expect(() => new Function(js)).not.toThrow();                                   // the script parses
    expect(js).toContain('hashchange');
    expect(js).not.toMatch(/\\d\+\$/);                                            // no template-literal-mangled regex left behind
    expect(html.length).toBeLessThan(200_000);
  });
});

import { describe, expect, it } from 'vitest';
import { describeBoard, draftBoard } from '../src/core/agent';
import { parseDiagram } from '../src/core/diagram';
import { frameSVG } from '../src/core/exporters';
import { bounds } from '../src/core/geom';
import { freshBoard, fromRawJSON, toRawJSON } from '../src/core/model';

const SRC = `group Products\n  axChat "● 296 · 4 d"\n  axFlow\ngroup Data\n  axVerity\n  axStorage\naxFlow -> axVerity : stores runs\naxChat ~> axVerity\naxStorage -- axVerity\naxFlow -> ghost`;

describe('diagram element', () => {
  it('parses groups, boxes with a second line, arrows, related, plain and labels; a box named only in an arrow is still a box', () => {
    const d = parseDiagram(SRC);
    expect(d.groups.map((g) => [g.title, g.nodes.map((n) => n.name)])).toEqual([['', ['ghost']], ['Products', ['axChat', 'axFlow']], ['Data', ['axVerity', 'axStorage']]]);
    expect(d.groups[1].nodes[0].sub).toBe('● 296 · 4 d');
    expect(d.edges.map((e) => [e.a, e.kind, e.b, e.label ?? ''])).toEqual([['axFlow', 'arrow', 'axVerity', 'stores runs'], ['axChat', 'related', 'axVerity', ''], ['axStorage', 'plain', 'axVerity', ''], ['axFlow', 'arrow', 'ghost', '']]);
  });

  it('draws boxes and routed arrows that never pass through a box they do not join', () => {
    const b = freshBoard();
    draftBoard(b, [{ caption: 'Map', outline: 'header Map\ndiagram\n' + SRC.split('\n').map((l) => '  ' + l).join('\n') + '\nbutton Done' }]);
    const f = b.frames[0];
    const rects = f.shapes.filter((s) => s.k === 'rect' && s.role === 'Card');
    expect(rects).toHaveLength(5);
    const lines = f.shapes.filter((s): s is Extract<typeof s, { k: 'line' }> => s.k === 'line');
    expect(lines.map((l) => [!!l.arrow, !!l.dash, !!l.conn])).toEqual([[true, false, false], [true, true, false], [false, false, true], [true, false, false]]);
    expect(describeBoard(b)).toContain('"stores runs"');
    const done = f.shapes.find((s) => s.k === 'text' && s.s === 'Done')!;
    expect(bounds(done).y).toBeGreaterThan(Math.max(...rects.map((r) => bounds(r).y + bounds(r).h)));   // what follows sits below the diagram
    expect(frameSVG(f)).toContain('stroke-dasharray="7 6"');
    expect(fromRawJSON(toRawJSON(b))!.frames[0].shapes.filter((s) => s.k === 'line' && s.dash)).toHaveLength(1);
  });
});

describe('tones and arrows in the preview', () => {
  it('a {tone} after a box fills it on the canvas export and in the preview; arrows show in the preview', async () => {
    const { previewHTML } = await import('../src/core/preview');
    const b = freshBoard();
    draftBoard(b, [{ caption: 'T', outline: 'diagram\n  hot one {hot}\n  cold one "quiet" {cold}\n  hot one -> cold one : why' }]);
    const rects = b.frames[0].shapes.filter((s) => s.k === 'rect');
    expect(rects.map((r) => (r as { tone?: string }).tone)).toEqual(['hot', 'cold']);
    expect(frameSVG(b.frames[0])).toContain('fill="#ffc078"');
    const html = previewHTML(b);
    expect(html).toContain('class="wires"');
    expect(html).toContain('background:#e9ecef');
    expect(html).toContain('wire-lbl');
    expect(fromRawJSON(toRawJSON(b))!.frames[0].shapes.filter((s) => s.k === 'rect' && s.tone)).toHaveLength(2);
  });
});

it('auto-sizing leaves diagram boxes where the layout put them (the gaps the arrows run in stay open)', () => {
  const b = freshBoard();
  draftBoard(b, [{ caption: 'G', outline: 'diagram\n  group G\n    a long project name here "and a long second line" {hot}\n    b\n    c' }]);
  const r = b.frames[0].shapes.filter((s) => s.k === 'rect') as { x: number; w: number }[];
  expect(r[1].x - (r[0].x + r[0].w)).toBeGreaterThanOrEqual(16);
});

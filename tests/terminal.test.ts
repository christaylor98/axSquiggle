import { describe, expect, it } from 'vitest';
import { describeBoard, draftBoard } from '../src/core/agent';
import { excalidraw, frameSVG, markdown } from '../src/core/exporters';
import { parseOutline } from '../src/core/layout';
import { freshBoard, fromRawJSON, toRawJSON } from '../src/core/model';
import { classify } from '../src/core/semantics';
import { previewHTML } from '../src/core/preview';

const SESSION = '$ du-break ~/dev\n  212.4G  100%  ~/dev\n   96.1G   45%  ├─ work | big\n(10 of 57 shown)';
const OUTLINE = `header du-break\nterminal\n${SESSION.split('\n').map((l) => '  ' + l).join('\n')}\nbutton Run again`;

const board = () => { const b = freshBoard(); draftBoard(b, [{ caption: 'Normal run', outline: OUTLINE }]); return b; };
const term = (b: ReturnType<typeof board>) => b.frames[0].shapes.find((s) => s.k === 'tlines');

describe('terminal element', () => {
  it('keeps the lines indented under "terminal" verbatim, | and spaces included, and ends at the next line at its level', () => {
    const nodes = parseOutline(OUTLINE);
    expect(nodes.map((n) => n.cells[0].kind)).toEqual(['header', 'terminal', 'button']);
    expect(nodes[1].cells[0].label).toBe(SESSION);
    expect(nodes[1].children).toEqual([]);
  });

  it('builds a mono text-lines block, tall enough for every line, that reads back as a Terminal', () => {
    const b = board(), s = term(b);
    expect(s).toMatchObject({ k: 'tlines', mono: true, s: SESSION });
    expect(s && 'h' in s && s.h).toBeGreaterThanOrEqual(4 * 18);
    const el = classify(b.frames[0]).els.find((e) => e.role === 'Terminal');
    expect(el?.label).toBe(SESSION);
    const text = describeBoard(b);
    expect(text).toContain('Terminal (');
    expect(text).toContain('| $ du-break ~/dev');
    expect(text).toContain('|    96.1G   45%  ├─ work | big');
  });

  it('survives save and load, and exports as monospace (SVG, Excalidraw, Markdown, preview)', () => {
    const b = board();
    expect(term(fromRawJSON(toRawJSON(b)))).toMatchObject({ mono: true, s: SESSION });
    const svg = frameSVG(b.frames[0]);
    expect(svg).toContain('monospace');
    expect(svg).toContain('xml:space="preserve"');
    expect(JSON.stringify(excalidraw(b))).toContain('$ du-break ~/dev');
    expect(markdown(b)).toContain('```console\n' + SESSION + '\n```');
    expect(previewHTML(b)).toContain('<pre class="e term');
  });

  it('a one-line "terminal $ cmd" is its own content', () => {
    expect(parseOutline('terminal $ du-break --help')[0].cells[0]).toMatchObject({ kind: 'terminal', label: '$ du-break --help' });
  });
});

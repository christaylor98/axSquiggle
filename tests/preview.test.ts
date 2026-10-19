import { describe, expect, it } from 'vitest';
import { previewHTML, PREVIEW_STYLES } from '../src/core/preview';
import { setLinks } from '../src/core/links';
import { exampleBoard } from '../src/core/model';

describe('realistic preview', () => {
  const b = JSON.parse(JSON.stringify(exampleBoard()));
  const btn = b.frames[0].shapes.findIndex((s: { k: string; role?: string }) => s.k === 'rect' && s.role === 'Button');
  setLinks(b.frames[0], [btn >= 0 ? btn : b.frames[0].shapes.findIndex((s: { k: string }) => s.k === 'rect')], b.frames[1].id);
  it('builds every screen, with working links and a style menu', () => {
    const html = previewHTML(b, 'Demo <x>');
    expect(html.match(/<section class="frame"/g)).toHaveLength(b.frames.length);
    expect(html).toContain('data-to="2"');
    expect(html).toContain('Demo &lt;x&gt;');
    for (const s of PREVIEW_STYLES) expect(html).toContain(`body[data-style="${s.name}"]`);
    const js = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
    expect(() => new Function(js)).not.toThrow();
    expect(html.replace(/xmlns="[^"]*"/g, '')).not.toMatch(/(src|href)="https?:/);
  });
  it('starts in the style asked for', () => {
    expect(previewHTML(b, 'x', 'dark')).toContain('<body data-style="dark">');
  });
});

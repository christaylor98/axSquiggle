// List overlapping buttons (and buttons overlapping anything else solid) per frame: npx tsx scripts/overlaps.ts board.json [fromFrame]
import { readFileSync } from 'node:fs';
import { fromRawJSON } from '../src/core/model';
import { classify } from '../src/core/semantics';
import { bounds } from '../src/core/geom';
const b = fromRawJSON(readFileSync(process.argv[2], 'utf8'))!;
const from = Number(process.argv[3] ?? 1);
b.frames.forEach((f, fi) => {
  if (fi + 1 < from) return;
  const c = classify(f);
  const els = c.els.filter((e) => ['Button', 'Input', 'Card', 'Image', 'List item', 'Paragraph', 'Header'].includes(e.role));
  const out: string[] = [];
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = bounds(f.shapes[els[i].i]), d = bounds(f.shapes[els[j].i]);
    const ox = Math.min(a.x + a.w, d.x + d.w) - Math.max(a.x, d.x), oy = Math.min(a.y + a.h, d.y + d.h) - Math.max(a.y, d.y);
    if (ox <= 1 || oy <= 1) continue;
    const contains = (p: typeof a, q: typeof a) => p.x <= q.x + 1 && p.y <= q.y + 1 && p.x + p.w >= q.x + q.w - 1 && p.y + p.h >= q.y + q.h - 1;
    if (contains(a, d) || contains(d, a)) continue;   // nesting is fine
    if (els[i].role !== 'Button' && els[j].role !== 'Button') continue;
    out.push(`  ${els[i].role} "${els[i].label}" (${Math.round(a.x)},${Math.round(a.y)} ${Math.round(a.w)}x${Math.round(a.h)})  x  ${els[j].role} "${els[j].label}" (${Math.round(d.x)},${Math.round(d.y)} ${Math.round(d.w)}x${Math.round(d.h)})  overlap ${Math.round(ox)}x${Math.round(oy)}`);
  }
  if (out.length) console.log(`Frame ${fi + 1} "${f.caption}"\n${out.join('\n')}`);
});

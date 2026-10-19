import { rotatePt, rotOf } from './rotate';
import { bounds, center, justifyDx, lineLabelSpot, linePts, paragraphDy, PARA_LINE, SUB_PX, textLines, textWidth, wrapText } from './geom';
import { classify } from './semantics';
import { linksOf } from './links';
import { frameSize, type Board, type Frame, type Pt, type Shape } from './types';
import { toRawJSON } from './model';

export const INK = '#1f2328';
export const INK_W = 2.25;
export const HAND_FONT = "Kalam, 'Comic Sans MS', 'Segoe Print', cursive";

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n1 = (v: number) => String(Math.round(v * 10) / 10);

/** Quadratic-smoothed path through the points (midpoint technique). */
export function freePath(pts: number[][]): string {
  if (pts.length < 2) return '';
  let d = `M${n1(pts[0][0])} ${n1(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += `Q${n1(pts[i][0])} ${n1(pts[i][1])} ${n1(mx)} ${n1(my)}`;
  }
  const l = pts[pts.length - 1];
  return d + `L${n1(l[0])} ${n1(l[1])}`;
}

export function arrowHead(x1: number, y1: number, x2: number, y2: number, len = 14): [number, number, number, number] {
  const a = Math.atan2(y2 - y1, x2 - x1), s = 0.5;
  len = Math.min(len, Math.max(5, 0.7 * Math.hypot(x2 - x1, y2 - y1))); // never longer than the run it sits on
  return [x2 - len * Math.cos(a - s), y2 - len * Math.sin(a - s), x2 - len * Math.cos(a + s), y2 - len * Math.sin(a + s)];
}

/** Arrowhead barbs for a sketched path: oriented by the last stretch of the stroke, not just its final jittery segment. */
export function pathHead(pts: number[][], len = 14): [number, number, number, number] {
  const [x2, y2] = pts[pts.length - 1];
  let k = pts.length - 2;
  while (k > 0 && Math.hypot(pts[k][0] - x2, pts[k][1] - y2) < 8) k--;
  return arrowHead(pts[k][0], pts[k][1], x2, y2, len);
}

/** Head and shoulders drawn inside an avatar's circle (centre c, radius r), so it reads as a person icon rather than an empty ring. */
export function avatarPath(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2, hr = 0.27 * r, hy = cy - 0.2 * r;
  const f = (v: number) => n1(v);
  return `M${f(cx + hr)} ${f(hy)}A${f(hr)} ${f(hr)} 0 1 0 ${f(cx - hr)} ${f(hy)}A${f(hr)} ${f(hr)} 0 1 0 ${f(cx + hr)} ${f(hy)}`
    + `M${f(cx - 0.62 * r)} ${f(cy + 0.72 * r)}C${f(cx - 0.62 * r)} ${f(cy + 0.2 * r)} ${f(cx + 0.62 * r)} ${f(cy + 0.2 * r)} ${f(cx + 0.62 * r)} ${f(cy + 0.72 * r)}`;
}

/** SVG path of the person glyph for every shape the classifier calls an Avatar (shape index -> path). */
export function avatarGlyphs(f: Frame): Map<number, string> {
  const out = new Map<number, string>();
  if (!f.shapes.some((s) => s.k === 'ell')) return out;
  for (const e of classify(f).els) {
    if (e.role !== 'Avatar') continue;
    const b = bounds(f.shapes[e.i]);
    out.set(e.i, avatarPath(b.x, b.y, b.w, b.h));
  }
  return out;
}

/** A hop: where a run of a line leaps over another line that crosses it (segment index, the crossing point). */
export interface Hop { seg: number; x: number; y: number; /** a label sits here: leave this much clear either side along the run */ gap?: number }
const HOP_R = 6;

/** Does this line arc over lines it crosses? Arrows do by default, dividers don't; `hop` overrides either way. */
export const doesHop = (s: Shape): boolean => s.k === 'line' && (s.hop ?? !!(s.arrow || s.tail || s.conn));

/**
 * For every line that hops, the places it crosses another line or the edge of a box or circle, so it can arc over it instead of seeming to pass through.
 * The later line hops; if it doesn't hop, the earlier one does. A horizontal run bulges up, a vertical run bulges right.
 */
/** An outline's points turned with its shape. */
const turnedPts = (pts: Pt[], s: Shape): Pt[] => { const r = rotOf(s); return r ? pts.map((q) => rotatePt(q, { x: (s as { x: number }).x + (s as { w: number }).w / 2, y: (s as { y: number }).y + (s as { h: number }).h / 2 }, r)) : pts; };

export function lineHops(f: Frame): Map<number, Hop[]> {
  const out = new Map<number, Hop[]>();
  const lines: [number, Pt[]][] = [];
  const edges: Pt[][] = [];   // outlines of boxes and ellipses: a line crossing one arcs over its edge too
  f.shapes.forEach((s, i) => {
    if (s.k === 'line') lines.push([i, linePts(s)]);
    else if (s.k === 'rect' || s.k === 'img') edges.push(turnedPts([{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }, { x: s.x, y: s.y }], s));
    else if (s.k === 'ell') edges.push(turnedPts(Array.from({ length: 49 }, (_, k) => ({ x: s.x + s.w / 2 + (s.w / 2) * Math.cos(((k + 0.5) / 48) * 2 * Math.PI), y: s.y + s.h / 2 + (s.h / 2) * Math.sin(((k + 0.5) / 48) * 2 * Math.PI) })), s));
  });
  if (!lines.length) return out;
  for (const [i] of lines) {   // a label on the line breaks it: leave a gap where the words are printed
    const ln = f.shapes[i] as Extract<Shape, { k: 'line' }>;
    for (const t of f.shapes) {
      if (t.k !== 'text' || t.free || t.ghost) continue;
      const sp = lineLabelSpot(ln, t.s);
      if (Math.abs(t.x - sp.x) <= 1.5 && Math.abs(t.y - sp.y) <= 1.5) {
        const lp = linePts(ln), seg = Math.hypot(lp[sp.seg + 1].x - lp[sp.seg].x, lp[sp.seg + 1].y - lp[sp.seg].y);
        if (sp.half * 2 <= seg - 16) (out.get(i) ?? out.set(i, []).get(i)!).push({ seg: sp.seg, x: sp.mid.x, y: sp.mid.y, gap: sp.half });   // a run too short is left whole
        break;
      }
    }
  }
  for (const [i, pa] of lines) {
    if (!doesHop(f.shapes[i])) continue;
    const others = [...lines.filter(([j]) => j !== i && !(j > i && doesHop(f.shapes[j]))).map(([, q]) => q), ...edges]; // a later line that hops takes the hop itself
    for (let a = 0; a + 1 < pa.length; a++) {
      const p = pa[a], q = pa[a + 1], dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy);
      if (len < 2 * (HOP_R + 2)) continue;
      for (const pb of others) {
        for (let b = 0; b + 1 < pb.length; b++) {
          const u = pb[b], v = pb[b + 1], ex = v.x - u.x, ey = v.y - u.y, den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-6) continue;                                   // parallel
          const t = ((u.x - p.x) * ey - (u.y - p.y) * ex) / den, w = ((u.x - p.x) * dy - (u.y - p.y) * dx) / den;
          if (t * len < HOP_R + 2 || (1 - t) * len < HOP_R + 2) continue;        // clear of this run's ends
          const el = Math.hypot(ex, ey);
          if (w * el < 2 || (1 - w) * el < 2) continue;                          // a real crossing, not a touch or a T
          const list = out.get(i) ?? out.set(i, []).get(i)!, hx = p.x + t * dx, hy = p.y + t * dy;
          if (!list.some((h) => h.seg === a && Math.hypot(h.x - hx, h.y - hy) < 2 * HOP_R + 2)) list.push({ seg: a, x: hx, y: hy }); // one hop for crossings that coincide
        }
      }
    }
  }
  return out;
}

/** SVG path of a line, with a small semicircle over each crossing it hops. */
export function lineD(s: Extract<Shape, { k: 'line' }>, hops: Hop[] = []): string {
  const lp = linePts(s);
  let d = `M${n1(lp[0].x)} ${n1(lp[0].y)}`;
  for (let a = 1; a < lp.length; a++) {
    const p = lp[a - 1], q = lp[a], len = Math.hypot(q.x - p.x, q.y - p.y) || 1, ux = (q.x - p.x) / len, uy = (q.y - p.y) / len;
    const sweep = ux > 0 || (ux === 0 && uy > 0) ? 1 : 0;   // keeps the bulge up / right whichever way the run travels
    const gp = hops.find((h) => h.seg === a - 1 && h.gap !== undefined);
    const hs = hops.filter((h) => h.seg === a - 1 && (h.gap !== undefined || !gp || Math.hypot(h.x - gp.x, h.y - gp.y) > gp.gap! + HOP_R)).sort((m, n) => Math.hypot(m.x - p.x, m.y - p.y) - Math.hypot(n.x - p.x, n.y - p.y));
    for (const h of hs) {
      if (h.gap !== undefined) { d += `L${n1(h.x - ux * h.gap)} ${n1(h.y - uy * h.gap)}M${n1(h.x + ux * h.gap)} ${n1(h.y + uy * h.gap)}`; continue; }
      d += `L${n1(h.x - ux * HOP_R)} ${n1(h.y - uy * HOP_R)}A${HOP_R} ${HOP_R} 0 0 ${sweep} ${n1(h.x + ux * HOP_R)} ${n1(h.y + uy * HOP_R)}`;
    }
    d += `L${n1(q.x)} ${n1(q.y)}`;
  }
  return d;
}

export const tlineCount = (h: number) => Math.max(1, Math.round(h / 20));

const STROKE = `fill="none" stroke="${INK}" stroke-width="${INK_W}" stroke-linecap="round" stroke-linejoin="round"`;

const wrapParagraph = (s: { s?: string; w: number }): string[] => wrapText(s.s ?? '', s.w);

export function shapeSVG(s: Shape, font: string, hops?: Hop[]): string {
  const r = rotOf(s);
  if (!r) return shapeSVGRaw(s, font, hops);
  const c = center(bounds(s));
  return `<g transform="rotate(${n1(r)} ${n1(c.x)} ${n1(c.y)})">${shapeSVGRaw(s, font, hops)}</g>`;
}

function shapeSVGRaw(s: Shape, font: string, hops?: Hop[]): string {
  switch (s.k) {
    case 'rect': return `<rect x="${n1(s.x)}" y="${n1(s.y)}" width="${n1(s.w)}" height="${n1(s.h)}" rx="3" ${STROKE}/>`;
    case 'ell': return `<ellipse cx="${n1(s.x + s.w / 2)}" cy="${n1(s.y + s.h / 2)}" rx="${n1(s.w / 2)}" ry="${n1(s.h / 2)}" ${STROKE}/>`;
    case 'img': if (s.src) return `<svg x="${n1(s.x)}" y="${n1(s.y)}" width="${n1(s.w)}" height="${n1(s.h)}" viewBox="0 0 ${n1(s.w)} ${n1(s.h)}" preserveAspectRatio="xMidYMid slice"><image href="${s.src}" width="${n1(s.w)}" height="${n1(s.h)}" preserveAspectRatio="xMidYMid slice"/></svg><rect x="${n1(s.x)}" y="${n1(s.y)}" width="${n1(s.w)}" height="${n1(s.h)}" rx="3" ${STROKE}/>`;
      return `<rect x="${n1(s.x)}" y="${n1(s.y)}" width="${n1(s.w)}" height="${n1(s.h)}" rx="3" ${STROKE}/><path d="M${n1(s.x)} ${n1(s.y)}L${n1(s.x + s.w)} ${n1(s.y + s.h)}M${n1(s.x + s.w)} ${n1(s.y)}L${n1(s.x)} ${n1(s.y + s.h)}" ${STROKE}/>`;
    case 'tlines': {
      if (s.s) return wrapParagraph(s).map((ln, i, all) => `<text x="${n1(s.x + justifyDx(ln, s.w, s.al))}" y="${n1(s.y + paragraphDy(all.length, s.h, s.av) + 18 + i * PARA_LINE)}" font-family="${esc(font)}" font-size="18" fill="${INK}">${esc(ln)}</text>`).join('');
      const n = tlineCount(s.h);
      let d = '';
      for (let i = 0; i < n; i++) {
        const y = s.y + (s.h * (i + 0.5)) / n;
        d += `M${n1(s.x)} ${n1(y)}L${n1(s.x + (i === n - 1 && n > 1 ? s.w * 0.6 : s.w))} ${n1(y)}`;
      }
      return `<path d="${d}" fill="none" stroke="#9aa0a6" stroke-width="${INK_W}" stroke-linecap="round"/>`;
    }
    case 'line': {
      const lp = linePts(s);
      let d = lineD(s, hops);
      if (s.arrow) { const pv = lp[lp.length - 2]; const [ax, ay, bx, by] = arrowHead(pv.x, pv.y, s.x2, s.y2); d += `M${n1(ax)} ${n1(ay)}L${n1(s.x2)} ${n1(s.y2)}L${n1(bx)} ${n1(by)}`; }
      if (s.tail) { const nx = lp[1]; const [ax, ay, bx, by] = arrowHead(nx.x, nx.y, s.x1, s.y1); d += `M${n1(ax)} ${n1(ay)}L${n1(s.x1)} ${n1(s.y1)}L${n1(bx)} ${n1(by)}`; }
      return `<path d="${d}" ${STROKE}/>`;
    }
    case 'text': return textLines(s.s, s.wrap, s.al).map((l) => `<text x="${n1(s.x + (l.dx ?? 0))}" y="${n1(s.y + l.dy)}" font-family="${esc(font)}" font-size="${l.sub ? SUB_PX : 18}"${s.ghost ? ' font-style="italic"' : ''} fill="${l.sub || s.ghost ? '#868e96' : INK}">${esc(l.text)}</text>`).join('');
    case 'free': {
      let d = freePath(s.pts);
      if (s.arrow) { const [ax, ay, bx, by] = pathHead(s.pts), [ex, ey] = s.pts[s.pts.length - 1]; d += `M${n1(ax)} ${n1(ay)}L${n1(ex)} ${n1(ey)}L${n1(bx)} ${n1(by)}`; }
      return `<path d="${d}" ${STROKE}/>`;
    }
  }
}

export interface SvgOpts { font?: string; embedBg?: boolean }

export function frameInnerSVG(f: Frame, o: SvgOpts = {}): string {
  const { w, h } = frameSize(f);
  const font = o.font ?? HAND_FONT;
  let out = `<rect width="${w}" height="${h}" fill="#ffffff"/>`;
  if (f.bg && o.embedBg !== false) out += `<image href="${esc(f.bg)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" opacity="0.45"/>`;
  const av = avatarGlyphs(f);
  const hp = lineHops(f);
  f.shapes.forEach((s, i) => { out += shapeSVG(s, font, hp.get(i)); const g = av.get(i); if (g) out += `<path d="${g}" ${STROKE}/>`; });
  return out;
}

export function frameSVG(f: Frame, o: SvgOpts = {}): string {
  const { w, h } = frameSize(f);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${frameInnerSVG(f, o)}</svg>`;
}

// ---------------- Figma: one SVG, layers named "Role / label" ----------------

export function figmaSVG(b: Board): string {
  const GAP = 120, CAP = 60;
  let x = 0, maxH = 0;
  let body = '';
  const used = new Set<string>();
  b.frames.forEach((f, fi) => {
    const { w, h } = frameSize(f);
    const c = classify(f);
    const names = new Map<number, string>();
    const uniq = (base: string) => { let n = base, k = 2; while (used.has(n)) n = `${base} ${k++}`; used.add(n); return n; };
    for (const e of c.els) names.set(e.i, uniq(`${e.role}${e.label ? ' / ' + e.label : ''}`.replace(/^(\w[\w ]*?)( \/ )/, '$1 / ')));
    let inner = `<rect id="${esc(uniq('Background'))}" width="${w}" height="${h}" fill="#ffffff" stroke="#c9ced6"/>`;
    if (f.bg) inner += `<image id="${esc(uniq('Screenshot'))}" href="${esc(f.bg)}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" opacity="0.45"/>`;
    const av = avatarGlyphs(f), hp = lineHops(f);
    f.shapes.forEach((s, i) => {
      const name = names.get(i);
      const owner = c.owner.get(i);
      if (name) {
        const lbl = c.byIndex.get(i)?.labelIdx;
        let g = shapeSVG(s, 'Inter, sans-serif', hp.get(i));
        if (av.has(i)) g += `<path d="${av.get(i)}" ${STROKE}/>`;
        if (lbl != null) g += shapeSVG(f.shapes[lbl], 'Inter, sans-serif');
        inner += `<g id="${esc(name)}">${g}</g>`;
      } else if (owner === undefined) {
        inner += shapeSVG(s, 'Inter, sans-serif', hp.get(i));
      }
    });
    const title = `Frame ${fi + 1}${f.caption ? ' / ' + f.caption : ''}`;
    body += `<g id="${esc(title)}" transform="translate(${x} ${CAP})">${inner}<text x="0" y="${-16}" font-family="Inter, sans-serif" font-size="18" font-weight="600" fill="${INK}">${esc(title)}</text></g>`;
    x += w + GAP;
    maxH = Math.max(maxH, h);
  });
  const W = Math.max(1, x - GAP), H = maxH + CAP + 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
}

// ---------------- Markdown + HTML storyboard ----------------

export function markdown(b: Board, title = 'Storyboard'): string {
  const out = [`# ${title}`, ''];
  b.frames.forEach((f, i) => {
    const { w, h } = frameSize(f);
    out.push(`## Frame ${i + 1}${f.caption ? ': ' + f.caption : ''}`, '', `![Frame ${i + 1}](frame-${i + 1}.png)`, '', `Device: ${f.device} (${w}x${h})`, '');
    const links = linksOf(b).filter((l) => l.from === i);
    if (links.length) {
      out.push('### Links', '');
      for (const l of links) out.push(`- ${l.role}${l.label ? ` “${l.label}”` : ''} → ${l.to === null ? '(missing frame)' : `Frame ${l.to + 1}${b.frames[l.to].caption ? ': ' + b.frames[l.to].caption : ''}`}`);
      out.push('');
    }
    if (f.notes.length) {
      out.push('### Review notes', '');
      f.notes.forEach((n, k) => out.push(`${k + 1}. ${n.text}${n.about.length ? ` (about: ${n.about.join(', ')})` : ''}`));
      out.push('');
    }
  });
  return out.join('\n');
}

export function storyboardHTML(b: Board, title = 'Storyboard'): string {
  const frames = b.frames.map((f, i) => {
    const notes = f.notes.length
      ? `<h3>Review notes</h3><ol>${f.notes.map((n) => `<li>${esc(n.text)}${n.about.length ? ` <small>(${esc(n.about.join(', '))})</small>` : ''}</li>`).join('')}</ol>`
      : '';
    return `<section><h2>Frame ${i + 1}${f.caption ? ': ' + esc(f.caption) : ''}</h2>${frameSVG(f)}${notes}</section>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:1040px;margin:0 auto;padding:24px;background:#fafafa;color:#1f2328}section{margin:0 0 40px}svg{max-width:100%;height:auto;border:1px solid #ccd;background:#fff}h2{font-size:18px}</style></head><body><h1>${esc(title)}</h1>\n${frames}\n</body></html>`;
}

// ---------------- clickable prototype ----------------

/**
 * One self-contained HTML file that plays the board as a click-through prototype: every frame is inline SVG, every linked element
 * is a clickable hotspot, and navigation is the address hash (#2), so the browser's Back button works. No network, no scripts to load.
 * Keys: left/right step frames, Backspace goes back, H shows the hotspots.
 */
export function prototypeHTML(b: Board, title = 'Prototype'): string {
  const links = linksOf(b);
  const frames = b.frames.map((f, fi) => {
    const { w, h } = frameSize(f);
    const spots = links.filter((l) => l.from === fi && l.to !== null).map((l) => {
      const r = bounds(f.shapes[l.idx]);
      return `<a href="#${l.to! + 1}" aria-label="Go to frame ${l.to! + 1}${b.frames[l.to!].caption ? `: ${esc(b.frames[l.to!].caption)}` : ''}"><rect class="hs" x="${n1(r.x - 3)}" y="${n1(r.y - 3)}" width="${n1(r.w + 6)}" height="${n1(r.h + 6)}" rx="5"/></a>`;
    }).join('');
    return `<svg class="frame" data-i="${fi + 1}" viewBox="0 0 ${w} ${h}" role="group" aria-label="Frame ${fi + 1}${f.caption ? `: ${esc(f.caption)}` : ''}" font-family="${esc(HAND_FONT)}">${frameInnerSVG(f, { embedBg: false })}${spots}</svg>`;
  }).join('\n');
  const caps = JSON.stringify(b.frames.map((f) => f.caption || ''));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
*{box-sizing:border-box}html,body{height:100%}body{margin:0;display:flex;flex-direction:column;background:#e9e7e2;color:#1f2328;font:14px system-ui,sans-serif}
#bar{display:flex;align-items:center;gap:8px;padding:6px 12px;background:#1f2328;color:#fff;flex-wrap:wrap}#bar b{font-weight:600}#cap{opacity:.75;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#bar button,#bar select{font:inherit;color:#fff;background:#3a3f45;border:1px solid #555b63;border-radius:6px;padding:3px 10px;cursor:pointer}#bar button:hover{border-color:#e8590c}
#stage{flex:1;min-height:0;padding:14px;display:flex;align-items:center;justify-content:center}
.frame{display:none;width:100%;height:100%;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,.22);border-radius:6px}.frame.on{display:block}
.hs{fill:transparent;cursor:pointer}.show .hs,.hs:hover{fill:rgba(232,89,12,.14);stroke:#e8590c;stroke-width:2;stroke-dasharray:6 4}
.flash .hs{animation:hint 1.1s ease 2}@keyframes hint{50%{fill:rgba(232,89,12,.22);stroke:#e8590c;stroke-width:2;stroke-dasharray:6 4}}
#foot{padding:4px 12px;font-size:12px;opacity:.6;text-align:center}@media(prefers-reduced-motion:reduce){.flash .hs{animation:none}}
</style></head><body>
<div id="bar"><b>${esc(title)}</b><span id="cap"></span><button id="back" title="Back (Backspace)">&larr; Back</button><select id="jump" aria-label="Jump to frame"></select><button id="h" title="Show the clickable areas (H)">Show links</button></div>
<main id="stage">${frames}</main>
<div id="foot">Click the highlighted areas to move between screens. &larr; &rarr; step frames, Backspace goes back, H shows the links. Made with axSquiggle.</div>
<script>
(function(){
var caps=${caps},fr=[].slice.call(document.querySelectorAll('.frame')),sel=document.getElementById('jump'),cap=document.getElementById('cap'),st=document.getElementById('stage'),cur=0,base=document.title;
caps.forEach(function(c,i){var o=document.createElement('option');o.value=i+1;o.textContent=(i+1)+(c?'. '+c:'');sel.appendChild(o);});
function show(){var n=parseInt(location.hash.slice(1),10);if(!(n>=1&&n<=fr.length))n=1;cur=n-1;fr.forEach(function(f,i){f.classList.toggle('on',i===cur);});sel.value=n;cap.textContent=caps[cur]||'';
st.classList.remove('flash');void st.offsetWidth;st.classList.add('flash');document.title=base+' \u2013 frame '+n;}
function go(n){if(n>=1&&n<=fr.length)location.hash='#'+n;}
addEventListener('hashchange',show);sel.onchange=function(){go(+sel.value);};
document.getElementById('back').onclick=function(){history.length>1?history.back():go(1);};
document.getElementById('h').onclick=function(){st.classList.toggle('show');};
addEventListener('keydown',function(e){if(e.target.tagName==='SELECT')return;if(e.key==='ArrowRight')go(cur+2);else if(e.key==='ArrowLeft')go(cur);else if(e.key==='Backspace'){e.preventDefault();history.back();}else if(e.key==='h'||e.key==='H')st.classList.toggle('show');});
show();
})();
</script></body></html>`;
}

// ---------------- Excalidraw ----------------

let seedCounter = 1;
export function excalidraw(b: Board): string {
  const els: Record<string, unknown>[] = [];
  let n = 0;
  const base = (type: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}) => ({
    id: `axsq-${++n}`, type, x, y, width: w, height: h, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent',
    fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null,
    roundness: null, seed: seedCounter++, version: 1, versionNonce: seedCounter++, isDeleted: false, boundElements: null,
    updated: 1, link: null, locked: false, ...extra,
  });
  const text = (s: string, x: number, y: number, size = 20, extra: Record<string, unknown> = {}) =>
    base('text', x, y, Math.max(10, (textWidth(s) * size) / 18), size * 1.25, {
      text: s, originalText: s, fontSize: size, fontFamily: 1, textAlign: 'left', verticalAlign: 'top', baseline: size,
      containerId: null, lineHeight: 1.25, autoResize: true, ...extra,
    });
  const line = (x1: number, y1: number, x2: number, y2: number, arrow = false, color = '#1e1e1e', via: number[][] = [], ox = 0, tail = false) => {
    const rel = [[0, 0], ...via.map(([vx, vy]) => [ox + vx - x1, vy - y1]), [x2 - x1, y2 - y1]];
    const xs = rel.map((q) => q[0]), ys = rel.map((q) => q[1]);
    return base(arrow || tail ? 'arrow' : 'line', x1, y1, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), {
      points: rel, lastCommittedPoint: null, startBinding: null, endBinding: null,
      startArrowhead: tail ? 'arrow' : null, endArrowhead: arrow ? 'arrow' : null, strokeColor: color,
    });
  };

  let ox = 0;
  b.frames.forEach((f, fi) => {
    const { w, h } = frameSize(f);
    els.push(base('rectangle', ox, 0, w, h, { strokeColor: '#adb5bd', strokeStyle: 'dashed', strokeWidth: 1 }));
    els.push(text(`${fi + 1}. ${f.caption || 'Frame ' + (fi + 1)}`, ox, -36, 22));
    const avatars = avatarGlyphs(f);
    for (const s of f.shapes) {
      switch (s.k) {
        case 'rect': els.push(base('rectangle', ox + s.x, s.y, s.w, s.h, { roundness: { type: 3 }, angle: ((s.rot ?? 0) * Math.PI) / 180 })); break;
        case 'ell': {
          els.push(base('ellipse', ox + s.x, s.y, s.w, s.h, { angle: ((s.rot ?? 0) * Math.PI) / 180 }));
          if (avatars.has(f.shapes.indexOf(s))) {
            const r = Math.min(s.w, s.h) / 2, cx = ox + s.x + s.w / 2, cy = s.y + s.h / 2, hr = 0.27 * r;
            els.push(base('ellipse', cx - hr, cy - 0.2 * r - hr, 2 * hr, 2 * hr));
            els.push(line(cx - 0.62 * r, cy + 0.72 * r, cx + 0.62 * r, cy + 0.72 * r, false, '#1e1e1e', [[cx - 0.55 * r, cy + 0.4 * r], [cx, cy + 0.27 * r], [cx + 0.55 * r, cy + 0.4 * r]].map(([a, b2]) => [a - ox, b2]), ox));
          }
          break;
        }
        case 'img':
          els.push(base('rectangle', ox + s.x, s.y, s.w, s.h));
          els.push(line(ox + s.x, s.y, ox + s.x + s.w, s.y + s.h), line(ox + s.x + s.w, s.y, ox + s.x, s.y + s.h));
          break;
        case 'tlines': {
          if (s.s) { { const ls = wrapText(s.s, s.w), dy = paragraphDy(ls.length, s.h, s.av); ls.forEach((ln, i) => els.push(text(ln, ox + s.x + justifyDx(ln, s.w, s.al), s.y + dy + i * PARA_LINE))); } break; }
          const c = tlineCount(s.h);
          for (let i = 0; i < c; i++) {
            const y = s.y + (s.h * (i + 0.5)) / c;
            els.push(line(ox + s.x, y, ox + s.x + (i === c - 1 && c > 1 ? s.w * 0.6 : s.w), y, false, '#868e96'));
          }
          break;
        }
        case 'line': els.push(line(ox + s.x1, s.y1, ox + s.x2, s.y2, !!s.arrow, '#1e1e1e', s.via, ox, !!s.tail)); break;
        case 'text': for (const l of textLines(s.s, s.wrap, s.al)) els.push(text(l.text, ox + s.x + (l.dx ?? 0), s.y - 18 + l.dy, l.sub ? 16 : 20, l.sub || s.ghost ? { strokeColor: '#868e96' } : {})); break;
        case 'free': {
          const p = s.pts, [x0, y0] = p[0];
          const step = Math.max(1, Math.ceil(p.length / 200));
          const pts = p.filter((_, i) => i % step === 0 || i === p.length - 1).map(([x, y]) => [x - x0, y - y0]);
          const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
          els.push(base(s.arrow ? 'arrow' : 'line', ox + x0, y0, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), {
            points: pts, lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: s.arrow ? 'arrow' : null,
          }));
          break;
        }
      }
    }
    ox += w + 120;
  });
  return JSON.stringify({ type: 'excalidraw', version: 2, source: 'axsquiggle', elements: els, appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {} }, null, 1);
}

export const rawJSON = toRawJSON;
export { bounds };

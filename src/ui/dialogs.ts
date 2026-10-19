import { previewHTML } from '../core/preview';
import { excalidraw, figmaSVG, frameSVG, markdown, prototypeHTML, storyboardHTML } from '../core/exporters';
import { toRawJSON } from '../core/model';
import { frameSize, type Board, type Frame } from '../core/types';
import { drawFrame, LIGHT } from './render';

export function download(name: string, data: Blob | string, type = 'text/plain') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function framePNG(f: Frame, scale = 2): Promise<Blob> {
  const { w, h } = frameSize(f);
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  return new Promise((resolve, reject) => {
    const paint = () => drawFrame(ctx, f, { scale, theme: LIGHT }, paint);
    paint();
    // give a background image a chance to decode before snapshotting
    setTimeout(() => c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG failed'))), 'image/png'), f.bg ? 150 : 0);
  });
}

type Toast = (msg: string) => void;
const TABS = ['PNG', 'SVG', 'Markdown', 'HTML', 'Prototype', 'Preview', 'Excalidraw', 'JSON', 'Figma'] as const;

export function openExport(dlg: HTMLDialogElement, board: Board, toast: Toast) {
  const tabs = dlg.querySelector('.tabs')!, body = dlg.querySelector('.body')!;
  tabs.innerHTML = TABS.map((t, i) => `<button data-t="${t}" class="${i ? '' : 'on'}">${t === 'JSON' ? 'Raw JSON' : t}</button>`).join('');
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); } catch { toast('Clipboard blocked: use Download instead'); }
  };
  const perFrame = (ext: string, make: (f: Frame, i: number) => Promise<void>) => `<div class="btns">${board.frames.map((f, i) => `<button data-i="${i}">Frame ${i + 1}${f.caption ? ': ' + f.caption.slice(0, 24) : ''}</button>`).join('')}<button data-all class="primary">All frames (.${ext})</button></div>`;
  const show = (t: (typeof TABS)[number]) => {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === t));
    let html = '';
    const wire: (() => void)[] = [];
    const frameButtons = (ext: string, make: (f: Frame, i: number) => Promise<void>) => {
      html = `<p>One .${ext} file per frame.</p>` + perFrame(ext, make);
      wire.push(() => {
        body.querySelectorAll<HTMLButtonElement>('button[data-i]').forEach((b) => (b.onclick = () => make(board.frames[+b.dataset.i!], +b.dataset.i!)));
        body.querySelector<HTMLButtonElement>('button[data-all]')!.onclick = async () => { for (let i = 0; i < board.frames.length; i++) await make(board.frames[i], i); };
      });
    };
    const textTab = (desc: string, file: string, mime: string, make: () => string, withCopy: boolean) => {
      html = `<p>${desc}</p><div class="btns"><button data-dl class="primary">Download ${file}</button>${withCopy ? '<button data-cp>Copy to clipboard</button>' : ''}</div>`;
      wire.push(() => {
        body.querySelector<HTMLButtonElement>('[data-dl]')!.onclick = () => download(file, make(), mime);
        const cp = body.querySelector<HTMLButtonElement>('[data-cp]');
        if (cp) cp.onclick = () => copy(make());
      });
    };
    switch (t) {
      case 'PNG': frameButtons('png', async (f, i) => download(`frame-${i + 1}.png`, await framePNG(f))); break;
      case 'SVG': frameButtons('svg', async (f, i) => download(`frame-${i + 1}.svg`, frameSVG(f), 'image/svg+xml')); break;
      case 'Markdown': textTab('Captions, image references (frame-N.png: export the PNGs next to it) and review notes.', 'storyboard.md', 'text/markdown', () => markdown(board), false); break;
      case 'Prototype': textTab('A clickable prototype in ONE offline HTML file: your linked buttons and elements become hotspots, the browser Back button works, arrows step frames. Email it, drop it on a shared drive, open it anywhere.', 'prototype.html', 'text/html', () => prototypeHTML(board, 'Prototype'), false); break;
      case 'Preview': textTab('The realistic preview as ONE offline HTML file: real buttons and inputs, a phone or browser around each screen, working links. Change the look with the style menu (or S) inside it.', 'preview.html', 'text/html', () => previewHTML(board, 'Preview'), false); break;
      case 'HTML': textTab('One self-contained HTML file with every frame inline. Works offline.', 'storyboard.html', 'text/html', () => storyboardHTML(board), false); break;
      case 'Excalidraw': textTab('Frames laid left to right. Open the file on excalidraw.com, or copy and paste it onto the canvas.', 'storyboard.excalidraw', 'application/json', () => excalidraw(board), true); break;
      case 'JSON': textTab('The raw board. Paste it back onto the canvas (Ctrl/Cmd+V) to import it.', 'storyboard.axsq.json', 'application/json', () => toRawJSON(board), true); break;
      case 'Figma': textTab('One SVG with every screen as a group, left to right. Layers are named “Role / label”, text is Inter. Copy it, then paste into a Figma canvas.', 'storyboard-figma.svg', 'image/svg+xml', () => figmaSVG(board), true); break;
    }
    body.innerHTML = html;
    wire.forEach((w) => w());
  };
  tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => show(b.dataset.t as (typeof TABS)[number])));
  show('PNG');
  dlg.showModal();
}

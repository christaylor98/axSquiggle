import type { Gesture } from '../core/recognize';

const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const G = 'fill="none" stroke="#e8590c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 3" opacity=".9"';
const svg = (inner: string) => `<svg viewBox="0 0 64 36" width="64" height="36" aria-hidden="true">${inner}</svg>`;

export const GESTURES: { id: Gesture; title: string; text: string; icon: string }[] = [
  { id: 'box', title: 'Box', text: 'Draw a closed rectangle', icon: svg(`<path d="M10 8H54V28H10Z" ${G}/><rect x="12" y="9" width="40" height="18" rx="2" ${S}/>`) },
  { id: 'corner', title: 'Box from two sides', text: 'Go down and across, even in a curve or a rough L: that is a box. Esc right after turns it back into your sketch; Esc is undo (with a shape selected, the first Esc deselects), Shift+Esc redoes (Alt+drag keeps a stroke as a sketch from the start)', icon: svg(`<path d="M12 7V29H52" ${G}/><rect x="12" y="8" width="40" height="20" rx="2" ${S} opacity=".45"/>`) },
  { id: 'ellipse', title: 'Ellipse', text: 'Draw a closed round loop', icon: svg(`<ellipse cx="32" cy="18" rx="22" ry="12" ${G}/><ellipse cx="32" cy="18" rx="21" ry="11" ${S}/>`) },
  { id: 'circle', title: 'Circle', text: 'Go up and around, even just a quarter arc: that is a circle (down and across is a box)', icon: svg(`<path d="M20 28A14 14 0 0 1 20 8" ${G}/><circle cx="32" cy="18" r="12" ${S} opacity=".5"/>`) },
  { id: 'line', title: 'Line', text: 'Draw a straight stroke (snaps level or plumb within 10°)', icon: svg(`<path d="M8 22C24 18 40 14 56 14" ${G}/><path d="M8 18H56" ${S}/>`) },
  { id: 'arrow', title: 'Arrow', text: 'Draw any line, however wonky, and finish with a short hook back. It becomes a straight arrow that connects to whatever it starts or ends near or in, and routes around the rest', icon: svg(`<path d="M8 18H52L44 26" ${G}/><path d="M8 18H52M44 10L52 18" ${S}/>`) },
  { id: 'paragraph', title: 'Text lines', text: 'Scribble back and forth (4+ turns) over empty space, then type its text in the Outline', icon: svg(`<path d="M10 8H54L10 16H54L10 24H54" ${G}/><path d="M10 10H54M10 18H54M10 26H34" stroke="#9aa0a6" stroke-width="2" stroke-linecap="round"/>`) },
  { id: 'erase', title: 'Scribble out', text: 'Scribble over a shape to delete it', icon: svg(`<rect x="10" y="6" width="44" height="24" rx="2" ${S} opacity=".4"/><path d="M12 8H52L12 14H52L12 20H52L12 26H52" ${G}/>`) },
  { id: 'image', title: 'Image', text: 'Draw a diagonal corner to corner across a box. Enter describes it; P puts a real picture in it (or drop / paste one onto it)', icon: svg(`<rect x="10" y="6" width="44" height="24" rx="2" ${S}/><path d="M10 6L54 30" ${G}/>`) },
  { id: 'free', title: 'Sketch', text: 'Strokes are cleaned up into shapes, lines and arrows by default. For a real sketch use Sketch mode (S) or hold Alt while you draw', icon: svg(`<path d="M8 22C16 6 22 6 28 18S42 30 56 12" ${S}/>`) },
];

export function buildLegend(root: HTMLElement) {
  root.innerHTML =
    '<p class="hint">Draw with the Draw tool (D). Each gesture is cleaned into a shape when you let go (Esc right after gives you the sketch back; Esc is undo, Shift+Esc redo). Select a box or circle and just type to write inside it (Esc to deselect, then letters are shortcuts again; Space lists them all). In the Text tool (T), tap a box or circle, then ↑ ↓ step its label up or down (above, inside at the top, middle, bottom, underneath), ← → step it left, centre or right (a selected paragraph takes ← → ↑ ↓ the same way: left, centre, right and top, middle, bottom of its box), and D detaches the text from the shape (Shift+D types a capital D). On a selected arrow, ← → ↑ ↓ put an arrowhead on or take it off at that end (the Outline row has a box for each end too), so a double-headed arrow is two presses; with both heads off it is a connector (still attached and routed, not a divider). Shift+arrow nudges it. An arrow end dropped on or in a shape sticks to it. To turn a shape or text: select it, then hold Shift: the corners turn into little turn arrows, and dragging one turns it (without Shift the corners resize). It clicks to every 45° (hold Alt for a free angle); > and < turn it 45° at a time.</p>' +
    GESTURES.map((g) => `<div class="grow" id="g-${g.id}">${g.icon}<div><b>${g.title}</b><span>${g.text}</span></div></div>`).join('') +
    '<p class="hint">Press Space for every shortcut, / stamp and part; ? opens the animated guide.</p>';
}

export function flashGesture(g: Gesture) {
  const el = document.getElementById(`g-${g}`);
  if (!el) return;
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  el.scrollIntoView({ block: 'nearest' });
}

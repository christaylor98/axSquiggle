import { borderFor, buildFromText, convertElement, deleteElement, kindChange, refitBorders, setHint, setLabel } from '../core/layout';
import { classify, LABEL_ROLES, smartSize, type El } from '../core/semantics';
import { resolveLinks } from '../core/links';
import { selectedOf, type Store } from './store';
import { doesHop } from '../core/exporters';
import { headEnds, setHead } from '../core/heads';
import { isConnector } from '../core/types';
import { chooseFile, picName, shrinkPicture } from './picture';

export class Outline {
  anchor: number | null = null;
  /** The radio/checkbox row the last Enter created; Enter on it while still empty ends the list. */
  private chainIdx: number | null = null;
  private anchorFrame = -1;
  private list: HTMLElement;
  private add: HTMLTextAreaElement;
  private anchorLbl: HTMLElement;

  constructor(private store: Store, root: HTMLElement, private redraw: () => void) {
    root.innerHTML = `<div class="rows" role="list"></div>
      <div class="addbox"><div class="anchor"></div>
      <textarea rows="2" spellcheck="false" aria-label="Add elements" placeholder="Add: one line = one element&#10;button Save | button Cancel&#10;(paste an indented list to build a screen)"></textarea>
      <div class="hint">Kinds: button, input (<code>input Email &quot;you@example.com&quot;</code> adds ghost hint text), text, h1, card/section, image/img (<code>image Cockpit {h=320}</code> sets its height), paragraph/p, divider/hr, avatar, radio, checkbox, header/nav, list/item. Enter adds; Shift+Enter is a new line.</div></div>`;
    this.list = root.querySelector('.rows')!;
    this.add = root.querySelector('textarea')!;
    this.anchorLbl = root.querySelector('.anchor')!;
    this.add.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.submit(this.add.value); this.add.value = ''; }
    });
    this.add.addEventListener('paste', (e) => {
      const t = e.clipboardData?.getData('text/plain') ?? '';
      if (t.includes('\n')) { e.preventDefault(); e.stopPropagation(); this.submit(t); }
    });
  }

  private submit(text: string) {
    if (!text.trim()) return;
    this.store.mutate((f, b) => {
      const r = buildFromText(f, text, this.anchor);
      this.anchor = r.anchor;
      const bad = resolveLinks(r.frame, b.frames);
      if (bad.length) this.store.onWarn(`No frame matches: ${bad.join(', ')}`);
      return smartSize(r.frame);
    });
  }

  focusAddAfter(anchor: number | null) {
    this.anchor = anchor;
    this.updateAnchorLabel();
    this.add.focus();
  }

  private updateAnchorLabel() {
    const f = this.store.frame;
    const e = this.anchor !== null ? classify(f).byIndex.get(this.anchor) : undefined;
    this.anchorLbl.textContent = e ? `↳ adds after ${e.role}${e.label ? ` “${e.label}”` : ''}` : '↳ adds below the lowest element';
  }

  /** Rows (primary shapes) standing for the current selection; a selected label counts as its owner. */
  private selRows(): Set<number> {
    const owner = classify(this.store.frame).owner;
    return new Set(selectedOf(this.store.state).map((i) => owner.get(i) ?? i));
  }

  /** Highlight the selected elements' rows and bring the primary one into view (no rebuild, so typing is not disturbed). */
  markSel() {
    const target = this.selRows();
    const primary = selectedOf(this.store.state)[0];
    let hit: HTMLElement | null = null;
    for (const r of this.list.querySelectorAll<HTMLElement>('.row')) {
      const i = Number(r.dataset.i), on = target.has(i);
      r.classList.toggle('sel', on);
      if (on && (hit === null || i === primary)) hit = r;
    }
    hit?.scrollIntoView({ block: 'nearest' });
  }

  /** Select an element from the outline (Shift/Ctrl/Cmd adds or removes it); the canvas shows it too. */
  private pick(i: number, additive = false) {
    const cur = selectedOf(this.store.state);
    if (additive) this.store.select(cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]);
    else if (cur.length === 1 && cur[0] === i) return;
    else this.store.select([i]);
    this.markSel();
    this.redraw();
  }

  render() {
    const st = this.store.state;
    if (this.anchorFrame !== st.cur) { this.anchorFrame = st.cur; this.anchor = null; }
    const f = this.store.frame;
    if (this.anchor !== null && this.anchor >= f.shapes.length) this.anchor = null;
    const c = classify(f);
    this.list.textContent = '';
    if (!c.els.length) this.list.innerHTML = '<p class="hint">Nothing here yet. Sketch on the canvas or type below.</p>';
    for (const el of c.els) this.list.appendChild(this.row(el));
    this.updateAnchorLabel();
    this.markSel();
  }

  private row(el: El): HTMLElement {
    const st = this.store.state;
    const row = document.createElement('div');
    row.className = 'row' + (el.i === this.anchor ? ' anchor-row' : '');
    row.dataset.i = String(el.i);
    // Containment shows as a small indent per level, with a thin guide line for each level it sits inside.
    const IND = 10;
    row.style.paddingLeft = `${4 + el.depth * IND}px`;
    if (el.depth > 0) {
      const lv = Array.from({ length: el.depth }, (_, d) => d);
      row.style.backgroundImage = lv.map(() => 'linear-gradient(var(--line), var(--line))').join(',');
      row.style.backgroundSize = lv.map(() => '1px 100%').join(',');
      row.style.backgroundPosition = lv.map((d) => `${4 + d * IND + 3}px 0`).join(',');
      row.style.backgroundRepeat = 'no-repeat';
    }
    row.setAttribute('role', 'listitem');
    const chip = document.createElement('span');
    chip.className = 'chip'; chip.textContent = el.role;
    // A paragraph is body copy, not a label: it gets its own multi-line box under the heading chip.
    const para = el.role === 'Paragraph';
    // Labels that can run to several lines (a radio with a sub-label, a list item) get a box that grows; Shift+Enter adds a line.
    const multi = ['Radio', 'Checkbox', 'List item', 'Text'].includes(el.role);
    const inp = document.createElement(para || multi ? 'textarea' : 'input') as HTMLInputElement; // textarea behaves the same for what we use
    if (para || multi) {
      const ta = inp as unknown as HTMLTextAreaElement, min = para ? 66 : 26;
      ta.rows = para ? 3 : 1;
      if (para) { ta.placeholder = 'Paragraph text'; row.classList.add('para'); }
      else { ta.classList.add('multi'); ta.title = 'Shift+Enter adds a line. Indent a later line (spaces) to make it a smaller sub-label.'; }
      const fit = () => { ta.style.height = 'auto'; ta.style.height = `${Math.max(min, ta.scrollHeight + 2)}px`; };
      ta.addEventListener('input', fit);
      requestAnimationFrame(fit);
    } else (inp as HTMLInputElement).type = 'text';
    inp.value = el.label; inp.spellcheck = false;
    const editable = LABEL_ROLES.includes(el.role);
    inp.disabled = !editable;
    if (!para) inp.placeholder = editable ? 'label' : '';
    inp.setAttribute('aria-label', para ? 'Paragraph text' : `${el.role} label`);
    const del = document.createElement('button');
    del.className = 'x'; del.textContent = '×'; del.title = 'Delete'; del.setAttribute('aria-label', `Delete ${el.role}`);

    const hi = (on: boolean) => { st.hover = on ? el.i : null; this.redraw(); };
    row.addEventListener('mouseenter', () => hi(true));
    row.addEventListener('mouseleave', () => { if (document.activeElement !== inp) hi(false); });
    inp.addEventListener('focus', () => { hi(true); this.anchor = el.i; this.updateAnchorLabel(); this.pick(el.i); });
    row.addEventListener('click', (ev) => { if (!(ev.target as HTMLElement).closest('button')) this.pick(el.i, ev.shiftKey || ev.ctrlKey || ev.metaKey); });
    inp.addEventListener('blur', () => hi(false));
    inp.addEventListener('input', () => {
      this.store.mutate((fr) => {
        const e = classify(fr).byIndex.get(el.i);
        if (!e) return;
        const nf = setLabel(fr, e, inp.value);
        return smartSize(nf);
      }, { key: `lbl${el.i}`, src: 'panel' });
    });
    inp.addEventListener('keydown', (ev) => {
      if (para || (multi && ev.key === 'Enter' && ev.shiftKey)) return; // newline in paragraph copy, or Shift+Enter in a label
      if (ev.key !== 'Enter' || ev.isComposing) return;
      ev.preventDefault();
      let idx = el.i;
      const grouped = el.role === 'Radio' || el.role === 'Checkbox';
      if (grouped && !kindChange(el, inp.value)) {
        // Radios and checkboxes are typed in a run: Enter on a label makes the next one below and moves to it; Enter on an empty one ends.
        if (!inp.value.trim()) {
          if (this.chainIdx === el.i) this.store.mutate((fr) => { const e = classify(fr).byIndex.get(el.i); if (!e) return; const nf = deleteElement(fr, e); refitBorders(nf); return nf; });
          this.chainIdx = null; inp.blur();
          return;
        }
        let made: number | null = null;
        this.store.mutate((fr) => {
          const c = classify(fr), e = c.byIndex.get(el.i);
          if (!e) return;
          const r = buildFromText(fr, el.role.toLowerCase(), el.i);
          made = r.anchor;
          // The first pair needs a border; once it exists the builder grows it for each new row.
          const sibs = e.parent === null ? [] : c.els.filter((x) => x.parent === e.parent);
          const boxed = e.parent !== null && sibs.every((x) => x.role === 'Radio' || x.role === 'Checkbox');
          if (!boxed) r.frame.shapes.push(borderFor([r.frame.shapes[e.i], ...(e.labelIdx !== null ? [r.frame.shapes[e.labelIdx]] : []), ...r.added.map((i) => r.frame.shapes[i])]));
          return smartSize(r.frame);
        });
        this.chainIdx = made;
        if (made !== null) this.list.querySelector<HTMLElement>(`.row[data-i="${made}"] input, .row[data-i="${made}"] textarea`)?.focus();
        return;
      }
      this.chainIdx = null;
      this.store.mutate((fr) => {
        const e = classify(fr).byIndex.get(el.i);
        const kc = e ? kindChange(e, inp.value) : null;
        if (!e || !kc) return;
        const r = convertElement(fr, e, kc);
        idx = r.index;
        return smartSize(r.frame);
      });
      this.focusAddAfter(idx);
    });
    del.addEventListener('click', () => {
      st.hover = null;
      this.store.mutate((fr) => {
        const e = classify(fr).byIndex.get(el.i);
        return e ? deleteElement(fr, e) : undefined;
      });
    });
    const link = (st.board.frames[st.cur].shapes[el.i] as { link?: string } | undefined)?.link;
    const tags: HTMLElement[] = [];
    if (link) {
      const n = st.board.frames.findIndex((x) => x.id === link);
      const tag = document.createElement('span');
      tag.className = 'linktag'; tag.textContent = `→${n < 0 ? '?' : n + 1}`; tag.title = n < 0 ? 'Links to a frame that no longer exists' : `Leads to frame ${n + 1}`;
      tags.push(tag);
    }
    // An input also takes ghost text: the greyed placeholder inside the box.
    let ghost: HTMLInputElement | null = null;
    if (el.role === 'Input') {
      ghost = document.createElement('input');
      ghost.type = 'text'; ghost.className = 'ghostin'; ghost.value = el.hint; ghost.spellcheck = false;
      ghost.placeholder = 'ghost hint inside the box'; ghost.title = 'Greyed placeholder text shown inside the input'; ghost.setAttribute('aria-label', 'Input ghost hint');
      ghost.addEventListener('input', () => this.store.mutate((fr) => { const e = classify(fr).byIndex.get(el.i); return e ? setHint(fr, e, ghost!.value) : undefined; }, { key: `ghost${el.i}`, src: 'panel' }));
      ghost.addEventListener('focus', () => this.pick(el.i));
      row.classList.add('hasghost');
    }
    // An image shows the picture it holds (file name, a small preview) with buttons to change or remove it.
    let pic: HTMLElement | null = null;
    const is = st.board.frames[st.cur].shapes[el.i];
    if (is && is.k === 'img') {
      pic = document.createElement('div'); pic.className = 'picrow';
      if (is.src) { const th = document.createElement('img'); th.src = is.src; th.alt = ''; th.className = 'picth'; pic.append(th); }
      const nm = document.createElement('span'); nm.className = 'picname'; nm.textContent = is.src ? (is.fn ?? 'picture') : 'no picture yet'; nm.title = is.fn ?? '';
      const ch = document.createElement('button'); ch.type = 'button'; ch.textContent = is.src ? 'Change…' : 'Add picture…'; ch.title = 'Choose an image file to show in this element (P)';
      ch.addEventListener('click', () => chooseFile((f) => void shrinkPicture(f).then((src) => this.store.mutate((fr) => { const s = fr.shapes[el.i]; if (s?.k === 'img') { s.src = src; s.fn = picName(f); } return smartSize(fr); })).catch(() => {})));
      pic.append(nm, ch);
      if (is.src) {
        const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = 'Remove'; rm.title = 'Take the picture out (Shift+P)';
        rm.addEventListener('click', () => this.store.mutate((fr) => { const s = fr.shapes[el.i]; if (s?.k === 'img') { delete s.src; delete s.fn; } return fr; }));
        pic.append(rm);
      }
    }
    // A line or arrow can arc over the lines it crosses: on for arrows, off for dividers, and this box overrides either.
    const ls = st.board.frames[st.cur].shapes[el.i];
    if (ls && ls.k === 'line') {
      const hop = document.createElement('input');
      hop.type = 'checkbox'; hop.className = 'hopbox'; hop.checked = doesHop(ls);
      hop.title = 'Hop: arc over lines this one crosses'; hop.setAttribute('aria-label', `${el.role} hops over crossing lines`);
      hop.addEventListener('change', () => this.store.mutate((fr) => { const sh = fr.shapes[el.i]; if (sh && sh.k === 'line') sh.hop = hop.checked; return fr; }));
      const lab = document.createElement('label'); lab.className = 'hoplbl'; lab.append(hop, ' hop');
      tags.push(lab);
      if (isConnector(ls)) {   // arrowheads: one box for each end, named by where it lies (left / right, or top / bottom)
        const heads: HTMLElement[] = [];
        for (const h of headEnds(ls)) {
          const cb = document.createElement('input');
          cb.type = 'checkbox'; cb.className = 'hopbox'; cb.checked = h.on;
          cb.title = `Arrowhead at the ${h.word} end`; cb.setAttribute('aria-label', `Arrowhead at the ${h.word} end`);
          cb.addEventListener('change', () => this.store.mutate((fr) => { const sh = fr.shapes[el.i]; if (sh && sh.k === 'line') setHead(sh, h.prop, cb.checked); return fr; }));
          const hl = document.createElement('label'); hl.className = 'hoplbl headlbl'; hl.append(cb, h.glyph);
          heads.push(hl);
        }
        tags.unshift(...heads);   // heads first, then hop
      }
    }
    if (para) { const head = document.createElement('div'); head.className = 'phead'; head.append(chip, ...tags, del); row.append(head, inp); }
    else if (pic) { const col = document.createElement('div'); col.className = 'inputcol'; col.append(inp, pic); row.append(chip, ...tags, col, del); }
    else if (ghost) { const col = document.createElement('div'); col.className = 'inputcol'; col.append(inp, ghost); row.append(chip, ...tags, col, del); }
    else row.append(chip, ...tags, inp, del);
    return row;
  }
}

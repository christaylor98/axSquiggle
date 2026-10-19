import { exampleParts } from '../core/model';
import type { Store } from './store';

/** The "Parts" tab: reusable groups saved from a selection. Stamp one anywhere with /name. */
export class PartsPanel {
  constructor(private store: Store, private root: HTMLElement, private place: (name: string) => void, private openHowTo: () => void = () => {}, private editNote: (name: string) => void = () => {}) {}

  render() {
    const parts = this.store.state.board.parts ?? {};
    const names = Object.keys(parts).sort();
    this.root.textContent = '';
    const intro = document.createElement('div');
    intro.className = 'partsintro';
    intro.innerHTML = `<b>What is a part?</b>
      <p>A part is a group of elements you save once under a name, so you can drop it into any frame in one go: a nav bar, a form row, a set of options.</p>
      <ol><li>Select the elements (drag a box round them).</li><li>Press <kbd>B</kbd> and give it a name, e.g. <i>nav-bar</i>.</li><li>Tap an empty spot on the canvas and type <kbd>/nav-bar</kbd>, or press <b>Place</b> below.</li></ol>`;
    const how = document.createElement('button');
    how.className = 'linkbtn'; how.textContent = 'See it animated →'; how.onclick = () => this.openHowTo();
    intro.append(how);
    if (!names.length) {
      const ex = document.createElement('button');
      ex.className = 'primary'; ex.textContent = 'Add three example parts';
      ex.title = 'nav-bar, form-row and choice-group: try them with Place, or type /nav-bar on the canvas';
      ex.onclick = () => this.store.mutate((_, b) => { b.parts = { ...(b.parts ?? {}), ...exampleParts() }; }, { src: 'panel' });
      intro.append(ex);
    }
    this.root.append(intro);
    for (const name of names) {
      const p = parts[name];
      const row = document.createElement('div');
      row.className = 'partrow';
      const label = document.createElement('div');
      label.innerHTML = `<b></b><span></span>`;
      (label.querySelector('b') as HTMLElement).textContent = `/${name}`;
      const sp = label.querySelector('span') as HTMLElement;
      sp.textContent = p.note ? p.note : `${Math.round(p.w)}×${Math.round(p.h)} · ${p.shapes.length} shapes (click to describe)`;
      sp.className = 'pnote'; sp.title = p.note ? `${Math.round(p.w)}×${Math.round(p.h)}, ${p.shapes.length} shapes. Click to change the description.` : 'Add a one-line description';
      sp.onclick = () => this.editNote(name);
      const put = document.createElement('button');
      put.textContent = 'Place'; put.onclick = () => this.place(name);
      const del = document.createElement('button');
      del.className = 'x'; del.textContent = '×'; del.title = 'Delete part'; del.setAttribute('aria-label', `Delete part ${name}`);
      del.onclick = () => this.store.mutate((_, b) => { if (b.parts) { const { [name]: _gone, ...rest } = b.parts; b.parts = Object.keys(rest).length ? rest : undefined; } }, { src: 'panel' });
      row.append(label, put, del);
      this.root.append(row);
    }
  }
}

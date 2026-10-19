import { fromRawJSON, toRawJSON } from '../core/model';
import type { Board } from '../core/types';
import { download } from './dialogs';

/** Save and open the board as one small JSON file: the same text an AI gets from get_board (json) and can hand back through load_board. */
const TYPES = [{ description: 'axSquiggle board', accept: { 'application/json': ['.json', '.axsq'] } }];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handle = any;
let handle: Handle = null; // the file we last opened or saved, so Ctrl+S writes straight back to it where the browser allows
let fileName = 'storyboard.axsq.json';
let named = false; // plain downloads cannot ask where to put the file, so at least ask what to call it, once

export const currentFile = () => fileName;

/** A new drawing is not the file we had open: the next save asks where to put it. */
export function forgetFile() { handle = null; named = false; fileName = 'storyboard.axsq.json'; }

/** Save to the current file (or ask where, the first time / with `as`). Returns the file name, or null if cancelled. */
export async function saveBoard(b: Board, as = false, askName?: (def: string) => Promise<string | null>): Promise<string | null> {
  const text = toRawJSON(b);
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<Handle> };
  if (w.showSaveFilePicker) {
    try {
      if (!handle || as) handle = await w.showSaveFilePicker({ suggestedName: fileName, types: TYPES });
      const ws = await handle.createWritable(); await ws.write(text); await ws.close();
      fileName = handle.name; return fileName;
    } catch (e) { if ((e as Error).name === 'AbortError') return null; handle = null; /* fall through to a plain download */ }
  }
  if (askName && (as || !named)) {
    const n = await askName(fileName);
    if (n === null) return null;
    fileName = /\.[A-Za-z0-9]+$/.test(n) ? n : `${n}.axsq.json`;
  }
  named = true;
  download(fileName, text, 'application/json');
  return fileName;
}

/** Pick a file and read it as a board. null if cancelled; throws a readable message if it is not a board. */
export async function openBoard(): Promise<Board | null> {
  const w = window as unknown as { showOpenFilePicker?: (o: unknown) => Promise<Handle[]> };
  let file: File | null = null;
  if (w.showOpenFilePicker) {
    try { const [h] = await w.showOpenFilePicker({ types: TYPES }); handle = h; file = await h.getFile(); }
    catch (e) { if ((e as Error).name === 'AbortError') return null; }
  }
  if (!file) {
    file = await new Promise<File | null>((res) => {
      // Attached to the page while the chooser is up: some browsers drop the change event of a loose input.
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json,.axsq,application/json'; inp.hidden = true;
      document.body.appendChild(inp);
      const end = (f: File | null) => { inp.remove(); res(f); };
      inp.onchange = () => end(inp.files?.[0] ?? null);
      inp.oncancel = () => end(null);
      inp.click();
    });
    handle = null;
  }
  return file ? readBoard(file) : null;
}

export async function readBoard(file: File): Promise<Board> {
  const b = fromRawJSON(await file.text());
  if (!b) throw new Error(`${file.name} is not an axSquiggle board`);
  fileName = file.name; named = true;
  return b;
}

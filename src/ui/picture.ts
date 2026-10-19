/** Read a picture file, scaled down to at most 800px (so the board file stays small) as a JPEG data URL. */
export async function shrinkPicture(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('bad image')); i.src = url; });
    const k = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  } finally { URL.revokeObjectURL(url); }
}

/** Ask for a picture file. Calls `done` with it (never if the chooser is cancelled). */
export function chooseFile(done: (f: File) => void) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.hidden = true;
  document.body.appendChild(inp);
  const end = () => inp.remove();
  inp.onchange = () => { const f = inp.files?.[0]; end(); if (f) done(f); };
  inp.oncancel = end;
  inp.click();
}

/** Put a picture file into an Image element of the current frame (an AI-free, offline step). */
export const picName = (f: Blob): string => (f as File).name || 'pasted image';

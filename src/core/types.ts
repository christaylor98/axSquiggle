export interface Pt { x: number; y: number }

/** `link`: id of the frame this element leads to (a click-through in play mode). */
/** Where a box or circle puts its label: above it (outside), at the top, middle or bottom inside it, or underneath it (outside); justified left, centre or right. */
export type LabelV = 'top' | 'inTop' | 'middle' | 'inBottom' | 'bottom';
export type LabelJ = 'left' | 'center' | 'right';
export const LABEL_V: readonly LabelV[] = ['top', 'inTop', 'middle', 'inBottom', 'bottom'];
export const LABEL_J: readonly LabelJ[] = ['left', 'center', 'right'];

export type Shape =
  | { k: 'rect'; x: number; y: number; w: number; h: number; link?: string; grp?: boolean; role?: Role; sm?: boolean; rot?: number; lbl?: LabelV; lj?: LabelJ; id?: string } // grp: an auto-fitted border around a group; sm: a compact (toolbar) button
  | { k: 'ell'; x: number; y: number; w: number; h: number; link?: string; role?: Role; rot?: number; lbl?: LabelV; lj?: LabelJ; id?: string }
  | { k: 'img'; x: number; y: number; w: number; h: number; link?: string; rot?: number; src?: string; fn?: string; id?: string } // src: data URL of a picture to show in it (otherwise the crossed placeholder); its description is the text underneath
  | { k: 'tlines'; x: number; y: number; w: number; h: number; s?: string; link?: string; rot?: number; al?: 'center' | 'right'; av?: 'middle' | 'bottom' } // s: paragraph copy; absent = grey placeholder lines
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; arrow?: boolean; tail?: boolean; conn?: boolean; via?: number[][]; hop?: boolean; id?: string } // id: given once the line has a label, which names it in `of`
  | { k: 'text'; x: number; y: number; s: string; link?: string; ghost?: boolean; rot?: number; free?: boolean; of?: string; wrap?: number; al?: 'center' | 'right' } // al: how the lines of a several-line label line up with each other (default left). wrap: the width the words are wrapped to (set by the label placement of a box or circle). free: detached, never a shape's label. of: the id of the shape or arrow this is the label of (kept however far either moves; D cuts it). rot: degrees clockwise about the centre (boxes and text only; lines and sketches just move their points). ghost: placeholder text inside an input, shown greyed
  | { k: 'free'; pts: number[][]; arrow?: boolean };

export const newId = (prefix = '') => prefix + Math.random().toString(36).slice(2, 8);

export type BoxShape = Extract<Shape, { w: number }>;

export type Device = 'desktop' | 'phone';

export const DEVICES: Record<Device, { w: number; h: number }> = {
  desktop: { w: 960, h: 600 },
  phone: { w: 390, h: 780 },
};

/** A review comment. `done` marks it as actioned (by a person or by an AI working through the review). */
export interface Note { id: string; text: string; box: [number, number, number, number]; about: string[]; done?: boolean; reply?: string }
export const newNote = (text: string, box: Note['box'], about: string[]): Note => ({ id: newId('n'), text, box, about });

export interface Frame {
  id: string;
  /** Taller than the device's standard height when the content needs it (a long page); set by auto-fit, never by hand. */
  h?: number;
  device: Device;
  caption: string;
  shapes: Shape[];
  bg?: string; // data URL of a downscaled JPEG
  notes: Note[];
}

/** A reusable group of shapes, stored relative to its own top-left corner. */
export interface Part { w: number; h: number; shapes: Shape[]; /** one line saying what it is for */ note?: string }

export interface Board { frames: Frame[]; example?: boolean; parts?: Record<string, Part> }

export type Role =
  | 'Checkbox' | 'Header' | 'List item' | 'Sidebar' | 'Button' | 'Input' | 'Card'
  | 'Image' | 'Paragraph' | 'Divider' | 'Arrow' | 'Connector' | 'Sketch' | 'Avatar' | 'Radio'
  | 'Circle' | 'Text';

export const GRID = 20;

export const frameSize = (f: Frame) => ({ w: DEVICES[f.device].w, h: Math.max(DEVICES[f.device].h, f.h ?? 0) });
export const newFrame = (device: Device = 'desktop', caption = ''): Frame => ({ id: newId('f'), device, caption, shapes: [], notes: [] });

/** Does this line carry an arrowhead at either end? (`arrow` = at the end, `tail` = at the start.) */
export const hasHead = (s: Shape): boolean => s.k === 'line' && !!(s.arrow || s.tail);
/** An arrow, or a connector (an arrow whose heads were taken off): attaches to shapes, routes around things, hops. A plain line is a divider instead. */
export const isConnector = (s: Shape): boolean => s.k === 'line' && !!(s.arrow || s.tail || s.conn);

export function cloneShape(s: Shape): Shape {
  if (s.k === 'free') return s.arrow ? { k: 'free', pts: s.pts.map((p) => [p[0], p[1]]), arrow: true } : { k: 'free', pts: s.pts.map((p) => [p[0], p[1]]) };
  if (s.k === 'line' && s.via) return { ...s, via: s.via.map((p) => [p[0], p[1]]) };
  return { ...s };
}
export function cloneFrame(f: Frame): Frame {
  return { ...f, shapes: f.shapes.map(cloneShape), notes: f.notes.map((n) => ({ ...n, box: [...n.box] as Note['box'], about: [...n.about] })) };
}
export function cloneBoard(b: Board): Board {
  const out: Board = { ...b, frames: b.frames.map(cloneFrame) };
  if (b.parts) out.parts = Object.fromEntries(Object.entries(b.parts).map(([k, p]) => [k, { w: p.w, h: p.h, shapes: p.shapes.map(cloneShape), ...(p.note ? { note: p.note } : {}) }]));
  return out;
}

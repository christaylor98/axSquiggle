import { z } from 'zod';
import {
  addNote, applyOutline, deleteFrameAt, describeBoard, duplicateFrameAt, moveFrameTo, describeFrame, draftBoard, editElement, findFrame, frameImages, frameSvgText, resolveNotes, reviewPacket,
  type FrameRef, type ImageOut,
} from '../src/core/agent';
import { fromRawJSON, toRawJSON } from '../src/core/model';
import { newId } from '../src/core/types';
import type { BoardServer } from './state';

const frameRef = z.union([z.number(), z.string()]).describe('A frame: its number (1 = first), its id, or words from its caption');
const device = z.enum(['desktop', 'phone']);
const rev = z.number().int().optional().describe('The board revision you last read; the edit is refused if the person changed the board since');

/** What a tool returns: text, and optionally images the AI should look at (sketch photos, screenshots). */
export interface ToolOut { text: string; images: ImageOut[] }

export interface Tool {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  run: (s: BoardServer, args: Record<string, unknown>) => Promise<string | ToolOut>;
}

const tell = (s: BoardServer, msg: string) => `${msg}\n(board "${s.name}" is now rev ${s.rev})`;
const frameNo = (s: BoardServer, ref: FrameRef) => findFrame(s.board, ref);

export const OUTLINE_HELP =
  'Outline syntax, one element per line: "<kind> <label>" with kinds header, button, input, text, card, image, paragraph, divider, avatar, radio, checkbox, list. ' +
  'Separate cells on one line with "|" to lay them side by side (button Save | button Cancel). Indent children under a card/header line to nest them. ' +
  'An input can carry ghost placeholder text: input Email "you@example.com" (or indent a plain line under it). Add "-> N" (frame number) or "-> caption words" to make an element lead to another frame (button Sign in -> 2). ' +
  '"toolbar Find | All keys | Flow F" makes a compact row of small buttons sized to their labels (use it for toolbars; "button A | button B" makes big equal-width buttons). ' +
  '"tabs Day | Week | Month" (also "segmented") is a button group whose buttons touch. "dropdown Country \\"Pick one\\"" is a dropdown list, "search" a search box, "badge New" a small pill. ' +
  '"columns" puts its indented children side by side ("columns 1:3" sets the width ratio), e.g. columns 1:3 / card Menu / (its list items) / card Content / (its text). ' +
  '"image Cockpit view {h=320}" (also on card) sets its height in pixels (default 160, phone 140). ' +
  'Frames grow taller by themselves when the content is long, so do not worry about running past 600px. Indented plain text under a radio, checkbox or list item is its sub-label.';

const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const listing = (s: BoardServer) => s.list().map((b) => `${b.open ? '*' : ' '} ${b.name} - ${b.frames} frame(s), changed ${ago(b.changed)}${b.open ? ' (open in the browser)' : ''}`).join('\n');
const boardName = z.string().min(1).describe('A board name');

const BASE: Tool[] = [
  {
    name: 'list_boards',
    description: 'List the named boards (storyboards). Call this first in a new conversation: each piece of work should have its own board, so do not add to a board that belongs to something else. * marks the board open in the browser, which is the one every other tool uses unless you pass board_name.',
    shape: {},
    run: async (s) => listing(s),
  },
  {
    name: 'new_board',
    description: 'Start a new board for unrelated work (blank, or a copy of another board with from). It opens in the browser straight away unless open=false. Use this instead of draft_board/load_board when the work is not a continuation of the open board; those replace or append to the open board.',
    shape: { name: boardName.describe('Short name, e.g. "fsd-live-run" (letters, digits, spaces, . - _)'), from: z.string().optional().describe('Copy this existing board instead of starting blank'), open: z.boolean().optional().describe('Default true: show it in the browser now. false keeps the browser where it is; then pass board_name to work on it.') },
    run: async (s, a) => {
      const n = s.create(String(a.name), a.from as string | undefined, a.open !== false);
      return `Created board "${n}"${a.from ? ` as a copy of "${a.from}"` : ''}${a.open === false ? '' : ' and opened it'}. Use board_name "${n}" on any tool to act on it${a.open === false ? '' : ' (or just call them: it is the open board)'}.\n\n${listing(s)}`;
    },
  },
  {
    name: 'switch_board',
    description: 'Open a board in the browser. From then on every tool without board_name acts on it.',
    shape: { name: boardName },
    run: async (s, a) => { const n = s.switchTo(String(a.name)); return `Opened "${n}".\n\n${describeBoard(s.view(n).board, s.view(n).rev)}`; },
  },
  {
    name: 'rename_board',
    description: 'Rename a board.',
    shape: { name: boardName, to: boardName.describe('The new name') },
    run: async (s, a) => { const n = s.rename(String(a.name), String(a.to)); return `Renamed to "${n}".\n\n${listing(s)}`; },
  },
  {
    name: 'delete_board',
    description: 'Delete a board. The file is moved to the .trash folder next to the boards, so a person can restore it. If it is the open board another one opens. Only do this when the person asked.',
    shape: { name: boardName },
    run: async (s, a) => { const r = s.remove(String(a.name)); return `Deleted "${r.name}" (kept in .trash). Open board: "${r.opened}".\n\n${listing(s)}`; },
  },
  {
    name: 'get_board',
    description: 'Read the wireframe board: every frame with its numbered elements (role, label, position, links), review notes and saved parts. Element numbers are what edit_element accepts. Call this before editing.',
    shape: { format: z.enum(['outline', 'json']).optional().describe('outline (default, readable) or json (raw board)'), include_images: z.boolean().optional().describe('Also return images people dropped behind frames (sketch photos, screenshots)') },
    run: async (s, a) => ({ text: a.format === 'json' ? toRawJSON(s.board) : `Board "${s.name}" (${s.list().length} board(s) in all; see list_boards)\n` + describeBoard(s.board, s.rev), images: a.include_images ? frameImages(s.board) : [] }),
  },
  {
    name: 'draft_board',
    description: `Write a first draft: build frames from outline text. For unrelated work call new_board first. Replaces the whole open board unless replace=false (then the frames are appended). ${OUTLINE_HELP}`,
    shape: {
      frames: z.array(z.object({ caption: z.string().optional().describe('One line saying what this screen is for'), device: device.optional(), outline: z.string().describe('The outline text for this frame') })).min(1).max(30),
      replace: z.boolean().optional().describe('Default true: replace the existing board'),
    },
    run: async (s, a) => {
      let warnings: string[] = [];
      s.aiWrite((b) => { warnings = draftBoard(b, a.frames as never, a.replace !== false); });
      return tell(s, `Drafted ${(a.frames as unknown[]).length} frame(s).${warnings.length ? '\nWarnings:\n- ' + warnings.join('\n- ') : ''}\n\n${describeBoard(s.board, s.rev)}`);
    },
  },
  {
    name: 'load_board',
    description: 'Put a whole board in as raw JSON: the same text get_board returns with format json, and what the Save button writes to a file. Use it to restore a saved board or hand over one you built. Replaces the board unless replace=false (then its frames are appended).',
    shape: { board: z.string().describe('The board JSON ({"axsquiggle":1,"frames":[...]}) as text'), replace: z.boolean().optional().describe('Default true: replace the existing board') },
    run: async (s, a) => {
      const nb = fromRawJSON(String(a.board));
      if (!nb) throw new Error('That is not a valid board. Expected {"axsquiggle":1,"frames":[...]} as written by get_board (format json).');
      s.aiWrite((b) => {
        if (a.replace === false) { for (const f of nb.frames) b.frames.push({ ...f, id: newId('f') }); }
        else { b.frames = nb.frames; if (nb.parts) b.parts = nb.parts; else delete b.parts; }
      });
      return tell(s, `Loaded ${nb.frames.length} frame(s).\n\n${describeBoard(s.board, s.rev)}`);
    },
  },
  {
    name: 'edit_frame',
    description: `Change one frame: set its caption or device, and/or add outline text below what is there (mode=append, default) or replace its contents (mode=replace). ${OUTLINE_HELP}`,
    shape: {
      frame: frameRef, caption: z.string().optional(), device: device.optional(),
      outline: z.string().optional(), mode: z.enum(['append', 'replace']).optional(), expected_rev: rev,
    },
    run: async (s, a) => {
      let warn: string[] = [];
      s.aiWrite((b) => { warn = applyOutline(b, a.frame as FrameRef, a.outline as string | undefined, (a.mode as 'append' | 'replace') ?? 'append', { caption: a.caption as string | undefined, device: a.device as 'desktop' | 'phone' | undefined }); }, a.expected_rev as number | undefined);
      return tell(s, `Updated.${warn.length ? ' Warnings: ' + warn.join('; ') : ''}\n\n${describeFrame(s.board, frameNo(s, a.frame as FrameRef))}`);
    },
  },
  {
    name: 'edit_element',
    description: 'Change one element on a frame. Pick it by `index` (the number from get_board) or by `label` text and/or `role`. Then set its label, change its kind (button, input, text, card, ...), remove it, move it, set the height of an image or card, or link it to another frame.',
    shape: {
      frame: frameRef,
      index: z.number().int().optional().describe('Element number from get_board'),
      label: z.string().optional().describe('Match elements whose label contains this'),
      role: z.string().optional().describe('Match this role, e.g. Button'),
      set_label: z.string().optional(), set_hint: z.string().optional().describe('Ghost placeholder text inside an input field (empty string clears it)'), set_kind: z.string().optional(), remove: z.boolean().optional(),
      set_height: z.number().int().min(24).max(2000).optional().describe('New height in pixels of an Image or Card; what is below it moves with its edge'),
      move_dx: z.number().optional(), move_dy: z.number().optional(),
      link_to_frame: frameRef.optional(), unlink: z.boolean().optional(), expected_rev: rev,
    },
    run: async (s, a) => {
      let said = '';
      s.aiWrite((b) => {
        said = editElement(b, a.frame as FrameRef, { index: a.index as number | undefined, label: a.label as string | undefined, role: a.role as string | undefined }, {
          label: a.set_label as string | undefined, hint: a.set_hint as string | undefined, kind: a.set_kind as string | undefined, height: a.set_height as number | undefined, remove: a.remove === true,
          link: a.unlink ? null : (a.link_to_frame as FrameRef | undefined),
          move: a.move_dx !== undefined || a.move_dy !== undefined ? { dx: (a.move_dx as number) ?? 0, dy: (a.move_dy as number) ?? 0 } : undefined,
        });
      }, a.expected_rev as number | undefined);
      return tell(s, said);
    },
  },
  {
    name: 'delete_frame',
    description: 'Delete a frame (and links that led to it). A board always keeps at least one frame.',
    shape: { frame: frameRef, expected_rev: rev },
    run: async (s, a) => { let m = ''; s.aiWrite((b) => { m = deleteFrameAt(b, a.frame as FrameRef); }, a.expected_rev as number | undefined); return tell(s, m); },
  },
  {
    name: 'duplicate_frame',
    description: 'Copy a frame and put the copy right after it (handy for a second state of the same screen).',
    shape: { frame: frameRef, expected_rev: rev },
    run: async (s, a) => { let m = ''; s.aiWrite((b) => { m = duplicateFrameAt(b, a.frame as FrameRef); }, a.expected_rev as number | undefined); return tell(s, m); },
  },
  {
    name: 'move_frame',
    description: 'Move a frame to another position (1 = first). Links between frames keep working.',
    shape: { frame: frameRef, to: z.number().int().min(1), expected_rev: rev },
    run: async (s, a) => { let m = ''; s.aiWrite((b) => { m = moveFrameTo(b, a.frame as FrameRef, a.to as number); }, a.expected_rev as number | undefined); return tell(s, m); },
  },
  {
    name: 'add_note',
    description: 'Leave a review note on a frame (a question or suggestion for the person). They see it in the Review panel.',
    shape: { frame: frameRef, text: z.string().max(2000) },
    run: async (s, a) => { let id = ''; s.aiWrite((b) => { id = addNote(b, a.frame as FrameRef, a.text as string); }); return tell(s, `Added note ${id}`); },
  },
  {
    name: 'get_review',
    description: 'Fetch the person\'s review: their open review notes (with the elements each points at), what they changed since your last write, and the current board. They write notes in the app; nothing is pushed to you, so call this when they tell you they have left notes (or whenever you want to check). Images the person dropped behind frames (a photo of a hand sketch, a screenshot) come back as attached images: look at them and build the wireframe with draft_board / edit_frame.',
    shape: {},
    run: async (s) => ({ text: reviewPacket(s.board, s.baseline, s.rev).text, images: frameImages(s.board) }),
  },
  {
    name: 'resolve_notes',
    description: 'Mark review notes as actioned (done), with a short reply saying what you did. The person sees the reply next to the note. Use reopen=true to undo.',
    shape: { ids: z.array(z.string()).min(1), reply: z.string().max(500).optional(), reopen: z.boolean().optional() },
    run: async (s, a) => {
      let n = 0;
      s.aiWrite((b) => { n = resolveNotes(b, a.ids as string[], a.reply as string | undefined, a.reopen !== true); });
      return tell(s, `${a.reopen ? 'Reopened' : 'Resolved'} ${n} note(s).`);
    },
  },
  {
    name: 'get_frame_svg',
    description: 'The frame as an SVG wireframe image (text), for checking how it looks.',
    shape: { frame: frameRef },
    run: async (s, a) => frameSvgText(s.board, a.frame as FrameRef),
  },
];

/** Every board-content tool can act on a named board without opening it; the board-management tools take names themselves. */
const MANAGE = new Set(['list_boards', 'new_board', 'switch_board', 'rename_board', 'delete_board']);
export const TOOLS: Tool[] = BASE.map((t) => MANAGE.has(t.name) ? t : { ...t, shape: { ...t.shape, board_name: boardName.optional().describe('Act on this board instead of the one open in the browser (see list_boards)') } });

export const toolByName = (n: string) => TOOLS.find((t) => t.name === n);

/** Validate raw args with the tool's own schema, then run it. */
export async function callTool(s: BoardServer, name: string, args: unknown): Promise<ToolOut> {
  const t = toolByName(name);
  if (!t) throw new Error(`Unknown tool ${name}`);
  const parsed = z.object(t.shape).safeParse(args ?? {});
  if (!parsed.success) throw new Error(`Bad arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const { board_name, ...rest } = parsed.data as Record<string, unknown>;
  const target = typeof board_name === 'string' ? s.view(board_name) : s;
  const r = await t.run(target, rest);
  return typeof r === 'string' ? { text: r, images: [] } : r;
}

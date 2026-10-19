import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BoardServer } from '../server/state';
import { callTool as callToolFull, TOOLS } from '../server/tools';
import { exampleBoard } from '../src/core/model';

const call = async (s: BoardServer, name: string, args: unknown = {}) => (await callToolFull(s, name, args)).text;
const outline = (caption: string) => ({ frames: [{ caption, outline: 'header Hello\nbutton Go' }] });

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'axsq-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('several boards', () => {
  it('starts with one board called default and brings the old single board.json in as default', () => {
    writeFileSync(join(dir, 'board.json'), JSON.stringify({ rev: 5, board: exampleBoard(), baseline: null }));
    const s = new BoardServer(dir);
    expect(s.list().map((b) => b.name)).toEqual(['default']);
    expect(s.board.frames.length).toBe(exampleBoard().frames.length);
    expect(existsSync(join(dir, 'board.json'))).toBe(true); // left alone
  });

  it('new_board opens a blank board and leaves the old one untouched', async () => {
    const s = new BoardServer(dir);
    await call(s, 'draft_board', outline('old work'));
    const oldRev = s.rev;
    await call(s, 'new_board', { name: 'fsd-live' });
    expect(s.open).toBe('fsd-live');
    expect(s.rev).toBeGreaterThan(oldRev);              // the browser sees it as a change
    expect(s.board.frames[0].shapes.length).toBe(0);
    await call(s, 'draft_board', outline('new work'));
    await call(s, 'switch_board', { name: 'default' });
    expect(s.board.frames[0].caption).toBe('old work');
    expect(await call(s, 'list_boards')).toMatch(/\* default[\s\S]*fsd-live/);
  });

  it('board_name acts on another board without opening it, and appends there', async () => {
    const s = new BoardServer(dir);
    await call(s, 'new_board', { name: 'second', open: false });
    expect(s.open).toBe('default');
    await call(s, 'draft_board', { ...outline('for second'), board_name: 'second' });
    expect(s.board.frames[0].caption).not.toBe('for second');
    expect(s.view('second').board.frames[0].caption).toBe('for second');
    await expect(call(s, 'get_board', { board_name: 'nope' })).rejects.toThrow(/no board called "nope"/);
  });

  it('copies a board, matches names ignoring case, and refuses duplicates and bad names', async () => {
    const s = new BoardServer(dir);
    await call(s, 'draft_board', outline('source'));
    await call(s, 'new_board', { name: 'Copy', from: 'DEFAULT' });
    expect(s.board.frames[0].caption).toBe('source');
    await expect(call(s, 'new_board', { name: 'copy' })).rejects.toThrow(/already a board/);
    await expect(call(s, 'new_board', { name: '../x' })).rejects.toThrow(/board name is/);
    await call(s, 'switch_board', { name: 'COPY' });
    expect(s.open).toBe('Copy');
  });

  it('keeps boards and the open one across a restart', async () => {
    const a = new BoardServer(dir);
    await call(a, 'new_board', { name: 'one' });
    await call(a, 'draft_board', outline('kept'));
    const b = new BoardServer(dir);
    expect(b.open).toBe('one');
    expect(b.board.frames[0].caption).toBe('kept');
    expect(b.list().map((x) => x.name)).toEqual(['default', 'one']);
  });

  it('renames, and deletes into .trash opening another board', async () => {
    const s = new BoardServer(dir);
    await call(s, 'new_board', { name: 'tmp' });
    await call(s, 'rename_board', { name: 'tmp', to: 'final' });
    expect(s.open).toBe('final');
    expect(existsSync(join(dir, 'boards', 'final.json'))).toBe(true);
    expect(existsSync(join(dir, 'boards', 'tmp.json'))).toBe(false);
    await call(s, 'delete_board', { name: 'final' });
    expect(s.open).toBe('default');
    expect(readdirSync(join(dir, '.trash')).length).toBe(1);
    await call(s, 'delete_board', { name: 'default' });   // the last one: an empty default appears
    expect(s.list().map((b) => b.name)).toEqual(['default']);
  });

  it('a browser write based on the board shown before a switch is refused', async () => {
    const s = new BoardServer(dir);
    const before = s.rev;
    await call(s, 'new_board', { name: 'x' });
    expect(s.userWrite(exampleBoard(), before).ok).toBe(false);
    expect(s.userWrite(exampleBoard(), s.rev).ok).toBe(true);
    expect(s.view('default').board.frames.length).toBe(1);   // the default board was not touched
  });

  it('every content tool accepts board_name and the management tools do not need it', () => {
    for (const t of TOOLS) expect('board_name' in t.shape).toBe(!['list_boards', 'new_board', 'switch_board', 'rename_board', 'delete_board'].includes(t.name));
  });

  it('works in memory with no folder', async () => {
    const s = new BoardServer();
    await call(s, 'new_board', { name: 'a' });
    expect(s.list().length).toBe(2);
    mkdirSync(join(dir, 'unused'));
  });
});

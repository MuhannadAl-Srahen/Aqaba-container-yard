/**
 * دفعات كشف الجمارك — bytes to grids, deterministically or not at all.
 *
 * Only formats that can be read LITERALLY are accepted: modern Excel (xlsx),
 * a Word table (docx), or UTF-8 CSV text. Everything else is refused with a
 * code naming the remedy — above all the scanned PDF the directorate loves
 * to send, because reading a picture means guessing, and the owner's charge
 * is that one wrongly-copied character is a catastrophe. The ZIP and sheet
 * XML reading is a typed port of tools/decode-aseza.mjs (the yard drawing's
 * own decoder), extended with the cell types that tool never met
 * (inlineStr/str), attribute order independence, and XML entity unescaping —
 * a bill written «A&B» must come out «A&B», not «A&amp;B».
 */

import { inflateRawSync } from 'node:zlib';
import type { ErrorCode } from '../shared/types';

export type SheetRefusal = Extract<
  ErrorCode,
  'SHEET_SCANNED' | 'SHEET_OLD_EXCEL' | 'SHEET_UNREADABLE'
>;

export type SheetReading =
  | { readonly ok: true; readonly grids: string[][][] }
  | { readonly ok: false; readonly code: SheetRefusal };

const refused = (code: SheetRefusal): SheetReading => ({ ok: false, code });

// ── the smallest possible ZIP reader: central directory → inflate ──────────
function unzip(buffer: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('bad central entry');
    const method = buffer.readUInt16LE(at + 10);
    const compSize = buffer.readUInt32LE(at + 20);
    const nameLen = buffer.readUInt16LE(at + 28);
    const extraLen = buffer.readUInt16LE(at + 30);
    const commentLen = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLen);
    const dataAt = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(dataAt, dataAt + compSize);
    files.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// ── XML morsels: attribute by name (any order), entities undone ────────────
const attrOf = (tag: string, name: string): string | null => {
  const m = new RegExp(`(?:^|[\\s"])${name}="([^"]*)"`).exec(tag);
  return m === null ? null : (m[1] ?? '');
};

const unescapeXml = (text: string): string =>
  text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** All <t>…</t> text inside one fragment (shared strings, inline strings). */
const tRuns = (fragment: string): string =>
  [...fragment.matchAll(/<t(?:[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((m) => unescapeXml(m[1] ?? ''))
    .join('');

const colNum = (letters: string): number => {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};

// ── xlsx: workbook order, shared strings, cells by reference ───────────────
function xlsxGrids(files: Map<string, Buffer>): string[][][] {
  const xml = (name: string): string => files.get(name)?.toString('utf8') ?? '';

  const rels = new Map<string, string>();
  for (const m of xml('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attrOf(m[0], 'Id');
    const target = attrOf(m[0], 'Target');
    if (id !== null && target !== null) rels.set(id, target);
  }
  const sheetFiles: string[] = [];
  for (const m of xml('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const rid = attrOf(m[0], 'r:id');
    const target = rels.get(rid ?? '');
    if (target === undefined) continue;
    sheetFiles.push('xl/' + target.replace(/^\/?(xl\/)?/, ''));
  }

  const shared = [...xml('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    tRuns(m[1] ?? ''),
  );

  const grids: string[][][] = [];
  for (const file of sheetFiles) {
    const body = xml(file);
    if (body === '') continue;
    const cells: Array<{ r: number; c: number; text: string }> = [];
    for (const m of body.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = `<c ${m[1] ?? ''}>`;
      const ref = /r="([A-Z]+)(\d+)"/.exec(m[1] ?? '');
      if (ref === null) continue;
      const type = attrOf(tag, 't') ?? '';
      const inner = m[2] ?? '';
      let text = '';
      if (type === 'inlineStr') {
        text = tRuns(inner);
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (v === null) continue;
        const value = unescapeXml(v[1] ?? '');
        text = type === 's' ? (shared[Number(value)] ?? '') : value;
      }
      cells.push({ r: Number(ref[2]), c: colNum(ref[1] ?? ''), text });
    }
    if (cells.length === 0) {
      grids.push([]);
      continue;
    }
    let height = 0;
    let width = 0;
    for (const cell of cells) {
      if (cell.r > height) height = cell.r;
      if (cell.c > width) width = cell.c;
    }
    const grid: string[][] = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => ''),
    );
    for (const cell of cells) {
      const row = grid[cell.r - 1];
      if (row !== undefined) row[cell.c - 1] = cell.text;
    }
    grids.push(grid);
  }
  return grids;
}

// ── docx: every table a grid; a cell is its paragraphs' text ───────────────
function docxGrids(files: Map<string, Buffer>): string[][][] {
  const body = files.get('word/document.xml')?.toString('utf8') ?? '';
  const grids: string[][][] = [];
  for (const table of body.match(/<w:tbl[ >][\s\S]*?<\/w:tbl>/g) ?? []) {
    const grid: string[][] = [];
    for (const tr of table.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []) {
      const row: string[] = [];
      for (const tc of tr.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) ?? []) {
        // Runs join seamlessly (Word splits mid-word); paragraphs get a space.
        const paragraphs = tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [tc];
        row.push(
          paragraphs
            .map((p) =>
              [...p.matchAll(/<w:t(?:[^>]*)?>([\s\S]*?)<\/w:t>/g)]
                .map((m) => unescapeXml(m[1] ?? ''))
                .join(''),
            )
            .join(' '),
        );
      }
      grid.push(row);
    }
    grids.push(grid);
  }
  return grids;
}

// ── csv: strict UTF-8, sniffed delimiter, minimal RFC 4180 ─────────────────
function csvGrid(bytes: Buffer): string[][] {
  const body = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    ? bytes.subarray(3)
    : bytes;
  // fatal: a Windows-1256 sheet must be refused, never silently mis-decoded.
  const text = new TextDecoder('utf-8', { fatal: true }).decode(body);

  const head = text.split(/\r\n|\r|\n/).filter((line) => line.trim() !== '').slice(0, 20);
  let delimiter = ',';
  let best = -1;
  for (const candidate of [',', ';', '\t']) {
    const count = head.reduce((sum, line) => sum + line.split(candidate).length - 1, 0);
    if (count > best) {
      best = count;
      delimiter = candidate;
    }
  }

  const grid: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      grid.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    grid.push(row);
  }
  return grid;
}

/** The one door: sniff the bytes, read them literally, or refuse by name. */
export function readSheetGrids(bytes: Buffer): SheetReading {
  if (bytes.length < 8) return refused('SHEET_UNREADABLE');

  if (bytes.subarray(0, 4).toString('latin1') === '%PDF') return refused('SHEET_SCANNED');
  if (bytes.readUInt32BE(0) === 0xd0cf11e0) return refused('SHEET_OLD_EXCEL');

  if (bytes.subarray(0, 4).toString('latin1') === 'PK\x03\x04') {
    try {
      const files = unzip(bytes);
      if (files.has('xl/workbook.xml')) return { ok: true, grids: xlsxGrids(files) };
      if (files.has('word/document.xml')) return { ok: true, grids: docxGrids(files) };
      return refused('SHEET_UNREADABLE');
    } catch {
      return refused('SHEET_UNREADABLE');
    }
  }

  // An HTML table saved with an .xls name (a common export trick) is not a
  // literal format either — the re-save remedy covers it.
  const printable = bytes.toString('utf8', 0, 256).replace(/^\uFEFF/, '').trimStart();
  if (printable.startsWith('<')) return refused('SHEET_UNREADABLE');

  try {
    return { ok: true, grids: [csvGrid(bytes)] };
  } catch {
    return refused('SHEET_UNREADABLE');
  }
}

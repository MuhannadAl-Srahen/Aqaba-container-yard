// Decode the official ASEZA yard drawing (Aseza yard.xlsx) into the committed
// layout module src/shared/asezaLayout.ts.
//
//   node tools/decode-aseza.mjs ["C:\path\to\Aseza yard.xlsx"]
//
// The workbook is a DRAWING, not a table: each zone sheet (1A…1E) paints the
// zone as bay bands of 15 Excel rows. The first row of a band carries the
// usable stack numbers as plain numeric cells — one cell = one twenty-foot
// ground slot that exists on the ground. The bay's own number sits in column
// B a few rows below, and the tier letters A–D are drawn down the side (the
// yard uses two tiers only; the letters are ignored here).
//
// The output is refused outright unless the tally matches the totals printed
// on the official sheet: Y1 = TGS 571, Y2 = TGS 110, TOTAL = 681. Never
// hand-edit the generated file — fix this decoder and run it again.

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const XLSX = process.argv[2] ?? 'C:\\Users\\Muhannad\\3D Objects\\Aseza yard.xlsx';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/shared/asezaLayout.ts');

// ── the smallest possible ZIP reader: central directory → inflate ──────────
function unzip(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file: ' + XLSX);
  const count = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);
  const files = new Map();
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

const files = unzip(readFileSync(XLSX));
const xml = (name) => files.get(name).toString('utf8');

// ── workbook wiring: sheet names → sheet XML files ──────────────────────────
const workbook = xml('xl/workbook.xml');
const rels = xml('xl/_rels/workbook.xml.rels');
const relTarget = new Map(
  [...rels.matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]*)"/g)].map((m) => [m[1], m[2]]),
);
const sheetFile = new Map(
  [...workbook.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="(rId\d+)"/g)].map((m) => [
    m[1],
    'xl/' + relTarget.get(m[2]).replace(/^\/?(xl\/)?/, ''),
  ]),
);

const sharedStrings = [...xml('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
  [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''),
);

const colNum = (letters) => {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};

function cellsOf(sheetName) {
  const body = xml(sheetFile.get(sheetName));
  const cells = [];
  for (const m of body.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1];
    const ref = /r="([A-Z]+)(\d+)"/.exec(attrs);
    if (ref === null) continue;
    const type = /t="([^"]*)"/.exec(attrs);
    const value = /<v>([\s\S]*?)<\/v>/.exec(m[2] ?? '');
    if (value === null) continue;
    const text = type !== null && type[1] === 's' ? sharedStrings[Number(value[1])] : value[1];
    cells.push({ c: colNum(ref[1]), r: Number(ref[2]), text });
  }
  return cells;
}

// ── one zone sheet → its bays and their usable stacks ───────────────────────
// Anchored on the bay numbers themselves, NOT on a fixed 15-row pitch: zone A
// switches to a 16-row pitch after bay 47, so counting rows misses its tail.
// Each bay's stack row sits a few rows above its own number in column B.
function decodeZone(sheetName) {
  const cells = cellsOf(sheetName);
  const bayLabels = cells
    .filter((x) => x.c === 2 && /^\d+$/.test(x.text))
    .map((x) => ({ bay: Number(x.text), r: x.r }))
    .sort((a, b) => a.r - b.r);
  const stackRows = new Map();
  for (const x of cells) {
    if (x.c < 3 || !/^\d+$/.test(x.text)) continue;
    const value = Number(x.text);
    if (value < 1 || value > 10) {
      throw new Error(sheetName + ' r' + String(x.r) + ': stack out of range: ' + x.text);
    }
    if (!stackRows.has(x.r)) stackRows.set(x.r, []);
    stackRows.get(x.r).push(value);
  }
  const rows = [...stackRows.keys()].sort((a, b) => a - b);
  const bays = bayLabels.map((label) => {
    const candidates = rows.filter((r) => r < label.r && r >= label.r - 10);
    if (candidates.length !== 1) {
      throw new Error(sheetName + ' bay ' + String(label.bay) + ': expected exactly one stack row above it, found ' + String(candidates.length));
    }
    return { bay: label.bay, stacks: stackRows.get(candidates[0]).sort((a, b) => a - b) };
  });
  if (rows.length !== bays.length) {
    throw new Error(sheetName + ': ' + String(rows.length) + ' stack rows but ' + String(bays.length) + ' bay numbers — an orphan band');
  }
  bays.sort((a, b) => a.bay - b.bay);
  bays.forEach((b, i) => {
    if (b.bay !== i * 2 + 1) throw new Error(sheetName + ': bay numbering breaks at ' + String(b.bay));
  });
  return bays;
}

// ── decode the five zones, tally, refuse a mismatch ─────────────────────────
const YARD_OF = { A: 1, B: 1, C: 1, D: 1, E: 2 };
const zones = [];
for (const zone of ['A', 'B', 'C', 'D', 'E']) {
  const bays = decodeZone('1' + zone);
  zones.push({ zone, yard: YARD_OF[zone], bays });
}

const slotCount = (z) => z.bays.reduce((sum, b) => sum + b.stacks.length, 0);
const y1 = zones.filter((z) => z.yard === 1).reduce((s, z) => s + slotCount(z), 0);
const y2 = zones.filter((z) => z.yard === 2).reduce((s, z) => s + slotCount(z), 0);

console.log('zone tally:');
for (const z of zones) {
  const clipped = z.bays.filter((b) => b.stacks.length < Math.max(...z.bays.map((x) => x.stacks.length)));
  console.log(
    '  ' + z.zone + ' (yard ' + z.yard + '): bays 01…' + String(z.bays[z.bays.length - 1].bay).padStart(2, '0') +
    ' (' + z.bays.length + ') → ' + slotCount(z) + ' slots' +
    (clipped.length === 0 ? '' : ' | walls at bays ' + clipped.map((b) => b.bay + '(' + b.stacks.length + ')').join(' ')),
  );
}
console.log('Y1 = ' + y1 + ' (official 571) · Y2 = ' + y2 + ' (official 110) · total = ' + (y1 + y2) + ' (official 681)');
if (y1 !== 571 || y2 !== 110) {
  console.error('\nREFUSED: the tally disagrees with the totals printed on the official sheet.');
  console.error('Nothing was written. Show the table above to the owner before touching the decoder.');
  process.exit(1);
}

// ── map geometry: yard units, bay 01 at the drawing start (left) ────────────
// The zones stand as horizontal strips in the official overview order:
// A, B, C, D top to bottom in yard 1; E is yard 2, apart with its hangars.
const BAY = 58;         // yard units per bay along the strip
const PAD = 14;         // panel padding
const ZONE_H = 150;     // title + bay row + free line
const zoneW = (z) => PAD * 2 + z.bays.length * BAY;

const place = { A: { x: 0, y: 0 }, B: { x: 0, y: 170 }, C: { x: 0, y: 340 }, D: { x: 0, y: 510 } };
const E_AT = { x: 1780, y: 170 };
for (const z of zones) {
  const at = z.zone === 'E' ? E_AT : place[z.zone];
  z.x = at.x;
  z.y = at.y;
  z.w = zoneW(z);
  z.h = ZONE_H;
}

// Landmarks: the hangars, buildings, tower and caravan on the printed plan.
// Cosmetic orientation marks only — nothing stands on them.
const landmarks = [
  { kind: 'hangar',   label: 'هنجر H.1',  x: 700,  y: 355, w: 300, h: 120 },
  { kind: 'hangar',   label: 'هنجر H.2',  x: 1090, y: 355, w: 240, h: 120 },
  { kind: 'hangar',   label: 'هنجر',      x: 640,  y: 510, w: 340, h: 130 },
  { kind: 'building', label: 'مبنى',      x: 1660, y: 20,  w: 100, h: 74 },
  { kind: 'building', label: 'مبنى',      x: 1660, y: 470, w: 100, h: 74 },
  { kind: 'tower',    label: 'برج',       x: 1672, y: 360, w: 72,  h: 72 },
  { kind: 'caravan',  label: 'كرفان',     x: 1512, y: 546, w: 96,  h: 56 },
  { kind: 'hangar',   label: 'هنجر',      x: 1780, y: 360, w: 700, h: 150 },
  { kind: 'hangar',   label: 'هنجر',      x: 2660, y: 170, w: 170, h: 140 },
];

// ── emit src/shared/asezaLayout.ts ──────────────────────────────────────────
const stacksLiteral = (bays) =>
  '{ ' + bays.map((b) => `'${String(b.bay)}': [${b.stacks.join(', ')}]`).join(', ') + ' }';

const zoneLiteral = (z) => `  {
    zone: '${z.zone}',
    yard: ${String(z.yard)},
    x: ${String(z.x)}, y: ${String(z.y)}, w: ${String(z.w)}, h: ${String(z.h)},
    bays: [${z.bays.map((b) => b.bay).join(', ')}],
    // ${String(slotCount(z))} ground slots — the walls clip what is missing
    stacks: ${stacksLiteral(z.bays)},
  }`;

const out = `// GENERATED by tools/decode-aseza.mjs from the official ASEZA drawing
// (Aseza yard.xlsx) — DO NOT EDIT BY HAND; fix the decoder and regenerate.
//
// Y1 = ${String(y1)} twenty-foot ground slots, Y2 = ${String(y2)}, total ${String(y1 + y2)} —
// matching the totals printed on the official sheet. Two tiers everywhere
// (طابق A تحت، طابق B فوق); odd bays take a 20, even bays are a 40 lying
// across the two odd bays around them.

import type { YardLayout } from './types';

export const ASEZA: YardLayout = {
  zones: [
${zones.map(zoneLiteral).join(',\n')},
  ],
  landmarks: [
${landmarks.map((l) => `    { kind: '${l.kind}', label: '${l.label}', x: ${String(l.x)}, y: ${String(l.y)}, w: ${String(l.w)}, h: ${String(l.h)} }`).join(',\n')},
  ],
};
`;
writeFileSync(OUT, out);
console.log('\nwrote ' + OUT);

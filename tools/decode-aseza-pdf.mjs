// Decode the official ASEZA yard drawing — the authority's NEWER plan, an
// AutoCAD sheet exported to PDF — into the committed layout module
// src/shared/asezaLayout.ts.
//
//   node tools/decode-aseza-pdf.mjs ["C:\path\to\new aseza  yard_recover (5) 111-Model.pdf"]
//
// The PDF is a DRAWING, not a table. Every twenty-foot ground slot is a
// stroked outline of slot size (long side 110–140 drawing units, short side
// 40–60): YELLOW (1 1 0) for the ground the yard already had, BLUE (0 0 1)
// for the ground the authority added. Each slot is drawn twice, so outlines
// whose centres lie within 3 units are one slot. The sheet is turned: the
// zones lie at about 99° to the page; each block of slots is read in its own
// frame (its own angle, 98–101°), then placed on the map through one common
// straightening. The bay numbers are the black numbers printed beside each
// bay; the stack numbers are not printed, so they are counted from the side
// the FROZEN first plan says stack 1 stands on.
//
// What the drawing holds, counted from the drawing itself (the cyan figures
// «Y1:TGS 550» and «Y2:TGS 112» printed on the sheet are NOT used — the owner
// said to count the drawing): A 305, B 376, C 54, D 50, E 176, F 48, G 24,
// H 14, J 6 — 1053 in all, every one of them SAHA 2. A, B and E continue in
// blue past their old ends; D's bay 19 is drawn yellow but was never in the
// first plan; F, G, H and J are new blocks (the letter I is skipped on
// purpose — it reads like 1). Three blue cells drawn ON existing slots are
// marks, not ground: they are printed and left out.
//
// The output is refused outright (exit 1, the file untouched) unless:
//   (a) every zone's count equals the table above;
//   (b) every one of the 681 slots of the frozen first plan
//       (tests/fixtures/asezaLayout681.ts) is still there — same zone, same
//       bay, the very same stacks: a container standing today keeps its
//       address;
//   (c) no two zone rects overlap, and no landmark overlaps a zone;
//   (d) bays run 01, 03, 05 … without a gap, stacks ascend, every bay has one.
// Never hand-edit the generated file — fix this decoder and run it again.

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PDF = process.argv[2] ?? 'C:\\Users\\Muhannad\\Downloads\\new aseza  yard_recover (5) 111-Model.pdf';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/shared/asezaLayout.ts');
const FROZEN = resolve(ROOT, 'tests/fixtures/asezaLayout681.ts');

const refuse = (lines) => {
  console.error('\nREFUSED: ' + [].concat(lines).join('\n         '));
  console.error('Nothing was written. Show the tables above to the owner before touching the decoder.');
  process.exit(1);
};

// ── the table the owner approved, counted from the drawing ──────────────────
// Everything modelled is SAHA 2. The new blocks are named by their shape on
// the drawing — bays × stacks — which no other block shares.
const YARD = 2;
const OFFICIAL = { A: 305, B: 376, C: 54, D: 50, E: 176, F: 48, G: 24, H: 14, J: 6 };
const NEW_BLOCKS = {
  F: { bays: 8, stacks: 6, note: 'the eight-bay block above the sand square' },
  G: { bays: 3, stacks: 8, note: 'between B and E' },
  H: { bays: 2, stacks: 7, note: 'beside the sand square' },
  J: { bays: 3, stacks: 2, note: 'drawn sideways, on the far side of the sand square' },
};

// ── 1. the PDF's objects, through its cross-reference table ─────────────────
const pdf = readFileSync(PDF);
const raw = pdf.toString('latin1');

function readObjects() {
  const at = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(raw);
  if (at === null) throw new Error('no startxref — not a PDF this decoder knows');
  const xref = Number(at[1]);
  if (!raw.startsWith('xref', xref)) throw new Error('the PDF keeps a cross-reference STREAM; this decoder reads the classic table only');
  const offsets = new Map();
  const table = /xref\s+([\s\S]*?)trailer/.exec(raw.slice(xref));
  const lines = table[1].trim().split(/\r?\n|\r/);
  for (let i = 0; i < lines.length; ) {
    const [first, count] = lines[i].trim().split(/\s+/).map(Number);
    for (let k = 0; k < count; k += 1) {
      const entry = lines[i + 1 + k].trim().split(/\s+/);
      if (entry[2] === 'n') offsets.set(first + k, Number(entry[0]));
    }
    i += 1 + count;
  }
  const objects = new Map();
  for (const [num, offset] of offsets) {
    const head = /^(\d+)\s+(\d+)\s+obj\b/.exec(raw.slice(offset, offset + 40));
    if (head === null || Number(head[1]) !== num) throw new Error('object ' + String(num) + ' is not where the table says');
    const start = offset + head[0].length;
    const streamAt = raw.indexOf('stream', start);
    const endAt = raw.indexOf('endobj', start);
    if (streamAt < 0 || streamAt > endAt) {
      objects.set(num, { dict: raw.slice(start, endAt), data: null });
      continue;
    }
    objects.set(num, { dict: raw.slice(start, streamAt), data: null, streamAt });
  }
  // Stream lengths may point at other objects, so they resolve in a second pass.
  const valueOf = (text) => {
    const ref = /^\s*(\d+)\s+0\s+R/.exec(text);
    return ref === null ? Number(/^\s*(\d+)/.exec(text)[1]) : Number(objects.get(Number(ref[1])).dict.trim());
  };
  for (const object of objects.values()) {
    if (object.streamAt === undefined) continue;
    let from = object.streamAt + 'stream'.length;
    if (raw[from] === '\r') from += 1;
    if (raw[from] === '\n') from += 1;
    const length = valueOf(/\/Length\s+([^/>]*)/.exec(object.dict)[1]);
    const bytes = pdf.subarray(from, from + length);
    object.data = /\/FlateDecode/.test(object.dict) ? inflateSync(bytes) : Buffer.from(bytes);
  }
  return objects;
}

const objects = readObjects();
const deref = (text) => {
  const ref = /^\s*(\d+)\s+0\s+R/.exec(text);
  return ref === null ? text : objects.get(Number(ref[1])).dict;
};

// ── 2. the text font: what each glyph says, and how wide it is ──────────────
// The sheet's one font maps its glyphs to characters through a ToUnicode
// CMap of plain <cid> <unicode> pairs, and lists its glyph widths in /W.
const fonts = [...objects.values()].filter((o) => /\/ToUnicode\s+\d+\s+0\s+R/.test(o.dict));
if (fonts.length !== 1) throw new Error('expected exactly one font with a ToUnicode map, found ' + String(fonts.length));
const font = fonts[0];
const cmapText = objects.get(Number(/\/ToUnicode\s+(\d+)/.exec(font.dict)[1])).data.toString('latin1');
if (/beginbfrange/.test(cmapText)) throw new Error('the ToUnicode map uses bfrange; this decoder reads bfchar pairs only');
const glyphText = new Map();
for (const block of cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
  for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
    glyphText.set(parseInt(pair[1], 16), String.fromCharCode(parseInt(pair[2], 16)));
  }
}
const glyphWidth = new Map();
{
  const wAt = /\/W\s+(\d+\s+0\s+R|\[)/.exec(font.dict);
  const wText = wAt[1] === '[' ? font.dict.slice(wAt.index + wAt[0].length - 1) : objects.get(Number(/\d+/.exec(wAt[1])[0])).dict;
  const tokens = wText.slice(wText.indexOf('[') + 1).match(/\[|\]|\d+(?:\.\d+)?/g);
  for (let i = 0; i < tokens.length && tokens[i] !== ']'; ) {
    const first = Number(tokens[i]);
    if (tokens[i + 1] === '[') {
      let k = i + 2;
      for (let cid = first; tokens[k] !== ']'; cid += 1, k += 1) glyphWidth.set(cid, Number(tokens[k]));
      i = k + 1;
    } else {
      for (let cid = first; cid <= Number(tokens[i + 1]); cid += 1) glyphWidth.set(cid, Number(tokens[i + 2]));
      i += 3;
    }
  }
}
const descriptor = deref(/\/FontDescriptor\s+(\d+\s+0\s+R)/.exec(font.dict)[1]);
const capHeight = Number((/\/CapHeight\s+([\d.]+)/.exec(descriptor) ?? [0, 700])[1]) / 1000;

// ── 3. the page: walk the drawing's content stream ──────────────────────────
// The content is the largest compressed stream that prints text. Everything
// below is in the drawing's own units (the page's 0.06 scale is left out).
let content = null;
for (const object of objects.values()) {
  if (object.data === null || !/\/FlateDecode/.test(object.dict)) continue;
  if (!/\bTj\b/.test(object.data.toString('latin1'))) continue;
  if (content === null || object.data.length > content.data.length) content = object;
}
if (content === null) throw new Error('no content stream with text in it');

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

const strokes = []; // { colour, points: [[x, y]…] } — one per stroked subpath
const texts = [];   // { text, at: [x, y] (the centre of the printed run), fill }
{
  const TOKEN = /<[0-9a-fA-F]*>|\/[^\s/[\]<>()]+|\[|\]|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?|[A-Za-z*'"]+/g;
  let state = { ctm: [1, 0, 0, 1, 0, 0], stroke: '0', fill: '0' };
  const saved = [];
  let subpaths = [];
  let current = null;
  let tm = [1, 0, 0, 1, 0, 0];
  let line = [1, 0, 0, 1, 0, 0];
  let size = 0;
  let operands = [];
  const paint = (stroked) => {
    if (current !== null) subpaths.push(current);
    if (stroked) {
      for (const points of subpaths) {
        if (points.length > 1) strokes.push({ colour: state.stroke, points: points.map(([x, y]) => apply(state.ctm, x, y)) });
      }
    }
    subpaths = [];
    current = null;
  };
  for (const match of content.data.toString('latin1').matchAll(TOKEN)) {
    const token = match[0];
    if (!/^[A-Za-z*'"]+$/.test(token)) {
      operands.push(/^[-+.\d]/.test(token) ? Number(token) : token);
      continue;
    }
    const n = operands;
    const last = (k) => n[n.length - k];
    switch (token) {
      case 'q': saved.push({ ...state }); break;
      case 'Q': state = saved.pop(); break;
      case 'cm': state = { ...state, ctm: mul(n.slice(-6), state.ctm) }; break;
      case 'RG': state = { ...state, stroke: n.slice(-3).join(' ') }; break;
      case 'rg': state = { ...state, fill: n.slice(-3).join(' ') }; break;
      case 'm': if (current !== null) subpaths.push(current); current = [[last(2), last(1)]]; break;
      case 'l': current.push([last(2), last(1)]); break;
      case 'c': current.push([last(2), last(1)]); break; // only straight outlines matter here
      case 'h': if (current !== null) { current.push(current[0]); subpaths.push(current); current = null; } break;
      case 're': {
        const [x, y, w, h] = n.slice(-4);
        if (current !== null) subpaths.push(current);
        subpaths.push([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]);
        current = null;
        break;
      }
      case 'S': paint(true); break;
      case 's': case 'b': case 'b*':
        if (current !== null) current.push(current[0]);
        paint(true);
        break;
      case 'B': case 'B*': paint(true); break;
      case 'f': case 'F': case 'f*': case 'n': paint(false); break;
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; line = [1, 0, 0, 1, 0, 0]; break;
      case 'Tf': size = last(1); break;
      case 'Tm': tm = n.slice(-6); line = [...tm]; break;
      case 'Td': line = mul([1, 0, 0, 1, last(2), last(1)], line); tm = [...line]; break;
      case 'Tj': {
        const hex = String(last(1)).slice(1, -1);
        let text = '';
        let advance = 0;
        for (let i = 0; i < hex.length; i += 4) {
          const cid = parseInt(hex.slice(i, i + 4), 16);
          text += glyphText.get(cid) ?? '?';
          advance += (glyphWidth.get(cid) ?? 1000) / 1000;
        }
        // The run's centre: half its advance along the baseline, half the
        // capital height above it — where the eye reads the number.
        const trm = mul(mul([size, 0, 0, size, 0, 0], tm), state.ctm);
        texts.push({ text, at: apply(trm, advance / 2, capHeight / 2), fill: state.fill });
        break;
      }
      default: break;
    }
    operands = [];
  }
}

// ── 4. slot outlines ────────────────────────────────────────────────────────
const YELLOW = '1 1 0';
const BLUE = '0 0 1';
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const centreOf = (corners) => [
  corners.reduce((s, p) => s + p[0], 0) / corners.length,
  corners.reduce((s, p) => s + p[1], 0) / corners.length,
];
const slotSized = (long, short) => long >= 110 && long <= 140 && short >= 40 && short <= 60;

/** A stroked polyline split into its loops: each closes back on its start. */
function loopsOf(points) {
  const clean = [];
  for (const p of points) if (clean.length === 0 || dist(clean[clean.length - 1], p) > 0.5) clean.push(p);
  const loops = [];
  let start = 0;
  for (let i = 1; i < clean.length; i += 1) {
    if (dist(clean[i], clean[start]) < 1.5) {
      loops.push({ corners: clean.slice(start, i), closed: true });
      start = i;
    }
  }
  if (start < clean.length - 1) loops.push({ corners: clean.slice(start), closed: false });
  return loops;
}

/** The long side's direction, in degrees within [0, 180). */
function axisOf(corners) {
  const a = dist(corners[0], corners[1]);
  const b = dist(corners[1], corners[2]);
  const [p, q] = a >= b ? [corners[0], corners[1]] : [corners[1], corners[2]];
  const deg = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
  return ((deg % 180) + 180) % 180;
}

const outlines = [];  // closed slot outlines
const partials = [];  // open cells: two or three sides of a slot, never ground
for (const stroke of strokes) {
  if (stroke.colour !== YELLOW && stroke.colour !== BLUE) continue;
  for (const loop of loopsOf(stroke.points)) {
    const c = loop.corners;
    if (c.length === 4) {
      const sides = [0, 1, 2, 3].map((i) => dist(c[i], c[(i + 1) % 4]));
      const along = loop.closed ? [(sides[0] + sides[2]) / 2, (sides[1] + sides[3]) / 2] : [sides[0], sides[1]];
      if (!slotSized(Math.max(...along), Math.min(...along))) continue;
      if (loop.closed && (Math.abs(sides[0] - sides[2]) > 6 || Math.abs(sides[1] - sides[3]) > 6)) continue;
      if (loop.closed) outlines.push({ colour: stroke.colour, corners: c, centre: centreOf(c), axis: axisOf(c) });
      else partials.push({ colour: stroke.colour, corners: c, sides: 3 });
    } else if (c.length === 3 && !loop.closed) {
      // Two sides of a cell, an L: completed into its parallelogram.
      const [p, q, r] = c;
      const a = dist(p, q);
      const b = dist(q, r);
      const cos = ((p[0] - q[0]) * (r[0] - q[0]) + (p[1] - q[1]) * (r[1] - q[1])) / (a * b);
      if (Math.abs(cos) > 0.05 || !slotSized(Math.max(a, b), Math.min(a, b))) continue;
      partials.push({ colour: stroke.colour, corners: [p, q, r, [p[0] + r[0] - q[0], p[1] + r[1] - q[1]]], sides: 2 });
    }
  }
}
// Every slot is drawn twice: one slot per colour and place.
const drawn = [];
for (const outline of outlines) {
  const twin = drawn.find((s) => s.colour === outline.colour && dist(s.centre, outline.centre) < 3);
  if (twin === undefined) drawn.push({ ...outline, copies: 1 });
  else twin.copies += 1;
}

// ── 5. marks: blue cells drawn ON existing ground ───────────────────────────
const area = (poly) => {
  let a = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
};
const ccw = (poly) => (area(poly) < 0 ? [...poly].reverse() : poly);
/** The area two convex outlines share (Sutherland–Hodgman). */
function shared(subject, clipper) {
  let out = ccw(subject);
  const edge = ccw(clipper);
  for (let i = 0; i < edge.length && out.length > 0; i += 1) {
    const a = edge[i];
    const b = edge[(i + 1) % edge.length];
    const inside = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    const cut = (p, q) => {
      const t = ((b[0] - a[0]) * (a[1] - p[1]) - (b[1] - a[1]) * (a[0] - p[0])) /
        ((b[0] - a[0]) * (q[1] - p[1]) - (b[1] - a[1]) * (q[0] - p[0]));
      return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
    };
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k += 1) {
      const p = input[k];
      const q = input[(k + 1) % input.length];
      if (inside(q)) {
        if (!inside(p)) out.push(cut(p, q));
        out.push(q);
      } else if (inside(p)) out.push(cut(p, q));
    }
  }
  return out.length < 3 ? 0 : Math.abs(area(out));
}
/** The existing (yellow) slot this cell mostly covers, or null. */
const groundUnder = (corners) => {
  const own = Math.abs(area(corners));
  const centre = centreOf(corners);
  for (const slot of drawn) {
    if (slot.colour !== YELLOW || dist(slot.centre, centre) > 150) continue;
    if (shared(corners, slot.corners) > own / 2) return slot;
  }
  return null;
};
const marks = [];
for (const slot of [...drawn]) {
  if (slot.colour !== BLUE) continue;
  const under = groundUnder(slot.corners);
  if (under !== null) {
    marks.push({ what: 'a closed blue cell', on: under });
    drawn.splice(drawn.indexOf(slot), 1);
  }
}
for (const cell of partials) {
  const own = Math.abs(area(cell.corners));
  const centre = centreOf(cell.corners);
  const twin = drawn.find((s) => s.colour === cell.colour && dist(s.centre, centre) < 150 && shared(cell.corners, s.corners) > own / 2);
  if (twin !== undefined) continue; // an unfinished second drawing of a slot that is there
  const under = cell.colour === BLUE ? groundUnder(cell.corners) : null;
  if (under === null) {
    refuse('an unclosed cell outline at drawing (' + centre.map((v) => v.toFixed(0)).join(', ') +
      ') covers no existing slot — is it ground? Decide before the decoder does.');
  }
  marks.push({ what: cell.sides === 2 ? 'a blue cell drawn with two sides' : 'a blue cell drawn with three sides', on: under });
}

// ── 6. blocks: neighbouring slots of one colour, each read in its own frame ─
const slots = drawn;
const parent = slots.map((_, i) => i);
const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
for (let i = 0; i < slots.length; i += 1) {
  for (let j = i + 1; j < slots.length; j += 1) {
    if (slots[i].colour === slots[j].colour && dist(slots[i].centre, slots[j].centre) < 140) parent[root(i)] = root(j);
  }
}
const groups = new Map();
slots.forEach((slot, i) => {
  const key = root(i);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(slot);
});

/** A frame along one axis: u runs along the slots' long side, v across it. */
const frameOf = (deg) => {
  const t = (deg * Math.PI) / 180;
  const e1 = [Math.cos(t), Math.sin(t)];
  const e2 = [Math.sin(t), -Math.cos(t)];
  return { deg, u: (p) => p[0] * e1[0] + p[1] * e1[1], v: (p) => p[0] * e2[0] + p[1] * e2[1] };
};
/** Mean direction of a set of axes, on the doubled angle (axes have no sign). */
const meanAxis = (axes) => {
  let c = 0;
  let s = 0;
  for (const deg of axes) {
    c += Math.cos((deg * Math.PI) / 90);
    s += Math.sin((deg * Math.PI) / 90);
  }
  const deg = (Math.atan2(s, c) * 90) / Math.PI;
  return deg < 0 ? deg + 180 : deg;
};
/** Positions → clusters wherever the gap between neighbours exceeds `gap`. */
const clusterBy = (items, key, gap) => {
  const sorted = [...items].sort((a, b) => key(a) - key(b));
  const out = [];
  for (const item of sorted) {
    const run = out[out.length - 1];
    if (run !== undefined && key(item) - key(run[run.length - 1]) <= gap) run.push(item);
    else out.push([item]);
  }
  return out.map((run) => ({ at: run.reduce((s, x) => s + key(x), 0) / run.length, items: run }));
};

const labels = texts.filter((t) => /^\d+$/.test(t.text) && t.fill === '0 0 0');
const blocks = [...groups.values()].map((group) => {
  const frame = frameOf(meanAxis(group.map((s) => s.axis)));
  const columns = clusterBy(group, (s) => frame.u(s.centre), 40);
  const rows = clusterBy(group, (s) => frame.v(s.centre), 25);
  const vMin = Math.min(...group.map((s) => frame.v(s.centre)));
  const vMax = Math.max(...group.map((s) => frame.v(s.centre)));
  const pitch = columns.length > 1 ? (columns[columns.length - 1].at - columns[0].at) / (columns.length - 1) : 136;
  // Each column's printed bay number: the black numbers beside the block,
  // in line with the column, just outside its first or last row.
  for (const column of columns) {
    const seen = new Set();
    for (const label of labels) {
      const lu = frame.u(label.at);
      const lv = frame.v(label.at);
      if (Math.abs(lu - column.at) > pitch / 3) continue;
      if ((lv < vMin - 15 && lv > vMin - 130) || (lv > vMax + 15 && lv < vMax + 130)) seen.add(Number(label.text));
    }
    if (seen.size !== 1) {
      refuse('a column of ' + String(column.items.length) + ' slots near drawing (' +
        centreOf(column.items.map((s) => s.centre)).map((v) => v.toFixed(0)).join(', ') +
        ') reads ' + (seen.size === 0 ? 'no bay number' : 'the bay numbers ' + [...seen].join(' and ')));
    }
    column.bay = [...seen][0];
    for (const slot of column.items) slot.bay = column.bay;
  }
  rows.forEach((row, index) => {
    for (const slot of row.items) slot.row = index;
  });
  const cells = new Set(group.map((s) => s.bay + '|' + s.row));
  if (cells.size !== group.length) refuse('two slots share one bay and row in the block near ' + centreOf(group.map((s) => s.centre)).map((v) => v.toFixed(0)).join(', '));
  const bays = columns.map((c) => c.bay);
  const ascending = bays.every((bay, i) => i === 0 || bay === bays[i - 1] + 2);
  const descending = bays.every((bay, i) => i === 0 || bay === bays[i - 1] - 2);
  if (!ascending && !descending) refuse('the bay numbers of one block do not step by two: ' + bays.join(' '));
  return { colour: group[0].colour, slots: group, frame, columns, rows, pitch, first: Math.min(...bays), last: Math.max(...bays) };
});

// ── 7. one straightening for the whole sheet; the map is the plan turned ────
// The common axis is the mean of every slot's long side (a sideways block's
// turned a quarter). In that straightened frame the drawing reads upright —
// B above A, E to the left, C and D at the top, bays rising leftward. The
// map is that picture turned half a turn — mirrored in both axes — so bay 1
// stands on the LEFT of every zone, A above B, E right of B, C and D below.
const largest = blocks.reduce((a, b) => (b.slots.length > a.slots.length ? b : a));
const turned = (deg) => {
  let d = deg;
  while (d - largest.frame.deg > 45) d -= 90;
  while (largest.frame.deg - d > 45) d += 90;
  return d;
};
const allAxes = blocks.flatMap((b) => b.slots.map((s) => turned(s.axis)));
const THETA = allAxes.reduce((s, d) => s + d, 0) / allAxes.length;
const sheet = frameOf(THETA);
const PITCH = blocks.reduce((s, b) => s + b.pitch * (b.columns.length - 1), 0) /
  blocks.reduce((s, b) => s + (b.columns.length - 1), 0);
const BAY = 58;       // map units per bay — the first plan's own pitch
const PAD = 14;       // the zone panel's padding (src/client/mapModel.ts MAP.pad)
const ZONE_H = 150;   // a zone panel's height: title, tiles, padding
const SCALE = BAY / PITCH;
/** Drawing point → map point, before the final shift to the origin. */
const toMap = (p) => [-sheet.u(p) * SCALE, -sheet.v(p) * SCALE];

// ── 8. which block is which zone ────────────────────────────────────────────
// The frozen first plan: read exactly as it is committed (never edited).
const frozenSource = readFileSync(FROZEN, 'utf8')
  .replace(/^import type.*$/m, '')
  .replace('export const ASEZA_681: YardLayout =', 'return');
const FROZEN_PLAN = new Function(frozenSource)();
const frozenTotal = FROZEN_PLAN.zones.reduce((s, z) => s + Object.values(z.stacks).reduce((t, l) => t + l.length, 0), 0);
if (frozenTotal !== 681) refuse('the frozen first plan holds ' + String(frozenTotal) + ' slots, not 681');

/** The direction bays rise in, on the map. */
const bayDirection = (block) => {
  const first = block.columns.find((c) => c.bay === block.first);
  const last = block.columns.find((c) => c.bay === block.last);
  const a = toMap(centreOf(first.items.map((s) => s.centre)));
  const b = toMap(centreOf(last.items.map((s) => s.centre)));
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
};
/**
 * Stack numbers of a block read on its own: stack 1 is the row standing
 * furthest toward the stack-1 side — a quarter turn from the way the bays
 * rise, clockwise (`hand` +1) or counter-clockwise (−1) on the map.
 */
const stacksOwn = (block, hand) => {
  const [bx, by] = bayDirection(block);
  const side = [hand * by, -hand * bx];
  const reach = block.rows.map((row) => {
    const p = toMap(centreOf(row.items.map((s) => s.centre)));
    return p[0] * side[0] + p[1] * side[1];
  });
  const order = reach.map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r);
  const stackOfRow = new Map(order.map((o, rank) => [o.i, rank + 1]));
  return (slot) => stackOfRow.get(slot.row);
};
const bayTable = (block, stackOf) => {
  const table = new Map();
  for (const slot of block.slots) {
    if (!table.has(slot.bay)) table.set(slot.bay, []);
    table.get(slot.bay).push(stackOf(slot));
  }
  for (const list of table.values()) list.sort((a, b) => a - b);
  return table;
};
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
/** Does this block hold the frozen zone's every bay with the very same stacks? */
const holds = (table, frozen) =>
  frozen.bays.every((bay) => sameList(table.get(bay) ?? [], frozen.stacks[String(bay)] ?? []));

// Which side is stack 1? The drawing prints no stack numbers; the frozen
// plan settles it — A's first bays and E's last bay are clipped by walls on
// one side, and only one hand puts those walls where the plan has them.
const yellow = blocks.filter((b) => b.colour === YELLOW);
const blue = blocks.filter((b) => b.colour === BLUE);
const assignments = [1, -1].map((hand) => {
  const found = new Map();
  for (const frozen of FROZEN_PLAN.zones) {
    const matches = yellow.filter((b) => holds(bayTable(b, stacksOwn(b, hand)), frozen));
    if (matches.length === 1) found.set(frozen.zone, matches[0]);
  }
  return { hand, found };
});
const fitting = assignments.filter((a) => a.found.size === FROZEN_PLAN.zones.length &&
  new Set(a.found.values()).size === FROZEN_PLAN.zones.length);
if (fitting.length !== 1) {
  refuse('the yellow blocks do not hold the frozen plan under exactly one stack-1 side (' +
    assignments.map((a) => (a.hand > 0 ? 'clockwise' : 'counter-clockwise') + ': ' + [...a.found.keys()].join('')).join(', ') + ')');
}
const HAND = fitting[0].hand;
const zones = new Map(); // letter → { parts: [{ block, stackOf }] }
for (const [letter, block] of fitting[0].found) zones.set(letter, { parts: [{ block, stackOf: stacksOwn(block, HAND) }] });
const unclaimedYellow = yellow.filter((b) => ![...fitting[0].found.values()].includes(b));
if (unclaimedYellow.length > 0) refuse(String(unclaimedYellow.length) + ' yellow block(s) belong to no zone of the frozen plan');

// A blue block continues a yellow one when it starts within a bay and a half
// of it and every one of its slots lies on one of the parent's stack lines:
// each extension slot takes the stack of the parent's slots on its line.
for (const block of blue) {
  for (const [letter, zone] of zones) {
    const parentPart = zone.parts[0];
    const p = parentPart.block;
    const gap = Math.min(...block.slots.flatMap((s) => p.slots.map((t) => dist(s.centre, t.centre))));
    if (gap > p.pitch * 1.5) continue;
    const lines = p.rows.map((row, index) => ({
      v: row.at,
      stack: parentPart.stackOf({ row: index }),
    }));
    const onLines = block.slots.map((s) => {
      const v = p.frame.v(s.centre);
      const near = lines.reduce((a, b) => (Math.abs(b.v - v) < Math.abs(a.v - v) ? b : a));
      return Math.abs(near.v - v) < 12 ? near.stack : null;
    });
    if (onLines.some((stack) => stack === null)) continue;
    const parentLast = p.last;
    if (block.first !== parentLast + 2) {
      refuse('the blue block beside ' + letter + ' starts at bay ' + String(block.first) +
        ', not at ' + String(parentLast + 2) + ' where ' + letter + ' ends');
    }
    const stackBySlot = new Map(block.slots.map((s, i) => [s, onLines[i]]));
    zone.parts.push({ block, stackOf: (slot) => stackBySlot.get(slot) });
    block.claimed = letter;
    break;
  }
}
for (const [letter, shape] of Object.entries(NEW_BLOCKS)) {
  const matches = blue.filter((b) => b.claimed === undefined &&
    b.columns.length === shape.bays && b.rows.length === shape.stacks && b.slots.length === shape.bays * shape.stacks);
  if (matches.length !== 1) {
    refuse('expected one new block of ' + String(shape.bays) + ' bays × ' + String(shape.stacks) +
      ' stacks for zone ' + letter + ' (' + shape.note + '), found ' + String(matches.length));
  }
  matches[0].claimed = letter;
  if (matches[0].first !== 1) refuse('zone ' + letter + ' does not start at bay 01');
  zones.set(letter, { parts: [{ block: matches[0], stackOf: stacksOwn(matches[0], HAND) }] });
}
const stray = blue.filter((b) => b.claimed === undefined);
if (stray.length > 0) {
  refuse(stray.map((b) => 'a blue block of ' + String(b.slots.length) + ' slots near drawing (' +
    centreOf(b.slots.map((s) => s.centre)).map((v) => v.toFixed(0)).join(', ') + ') belongs to no zone'));
}

// ── 9. tally and print; refuse a mismatch ───────────────────────────────────
const ORDER = Object.keys(OFFICIAL);
const decoded = ORDER.map((letter) => {
  const zone = zones.get(letter);
  if (zone === undefined) refuse('zone ' + letter + ' was not found on the drawing');
  const table = new Map();
  for (const part of zone.parts) {
    for (const [bay, stacks] of bayTable(part.block, part.stackOf)) {
      if (table.has(bay)) refuse('zone ' + letter + ' bay ' + String(bay) + ' is drawn twice');
      table.set(bay, stacks);
    }
  }
  const bays = [...table.keys()].sort((a, b) => a - b).map((bay) => ({ bay, stacks: table.get(bay) }));
  return { zone: letter, yard: YARD, bays, parts: zone.parts };
});
const slotCount = (z) => z.bays.reduce((s, b) => s + b.stacks.length, 0);
const total = decoded.reduce((s, z) => s + slotCount(z), 0);
const pad2 = (n) => String(n).padStart(2, '0');
const runs = (list) => {
  const out = [];
  for (const n of list) {
    const r = out[out.length - 1];
    if (r !== undefined && n === r[1] + 1) r[1] = n;
    else out.push([n, n]);
  }
  return out.map(([a, b]) => (a === b ? String(a) : String(a) + '–' + String(b))).join(',');
};

console.log('read ' + PDF);
console.log('  ' + String(strokes.length) + ' stroked lines, ' + String(texts.length) + ' printed texts, ' +
  String(outlines.length) + ' closed slot outlines → ' + String(slots.length + marks.filter((m) => m.what === 'a closed blue cell').length) + ' slots drawn');
console.log('\nexcluded marks (blue cells drawn on existing ground — not ground):');
const where = (slot) => {
  for (const z of decoded) {
    for (const part of z.parts) {
      if (part.block.slots.includes(slot)) return z.zone + ' bay ' + pad2(slot.bay) + ' stack ' + pad2(part.stackOf(slot));
    }
  }
  return 'drawing (' + slot.centre.map((v) => v.toFixed(0)).join(', ') + ')';
};
for (const mark of marks) console.log('  ' + mark.what + ' on ' + where(mark.on));
if (marks.length === 0) console.log('  none');

console.log('\nzone tally (yard ' + String(YARD) + '):');
let mismatch = false;
for (const z of decoded) {
  const counted = slotCount(z);
  if (counted !== OFFICIAL[z.zone]) mismatch = true;
  console.log('  ' + z.zone + ': bays ' + pad2(z.bays[0].bay) + '…' + pad2(z.bays[z.bays.length - 1].bay) +
    ' (' + String(z.bays.length) + ') → ' + String(counted) + ' slots (table ' + String(OFFICIAL[z.zone]) + ')' +
    (counted === OFFICIAL[z.zone] ? '' : '  ← MISMATCH'));
  const groupsOfStacks = [];
  for (const b of z.bays) {
    const key = runs(b.stacks);
    const g = groupsOfStacks[groupsOfStacks.length - 1];
    if (g !== undefined && g.key === key && b.bay === g.to + 2) g.to = b.bay;
    else groupsOfStacks.push({ key, from: b.bay, to: b.bay });
  }
  for (const g of groupsOfStacks) {
    console.log('      bays ' + pad2(g.from) + (g.to === g.from ? '   ' : '–' + pad2(g.to)) + '  stacks ' + g.key);
  }
}
console.log('  total = ' + String(total) + ' (table 1053)');
if (mismatch || total !== 1053) refuse('the tally disagrees with the owner-approved table.');

// (b) the frozen first plan, slot for slot.
const lost = [];
for (const frozen of FROZEN_PLAN.zones) {
  const now = decoded.find((z) => z.zone === frozen.zone);
  for (const bay of frozen.bays) {
    const before = frozen.stacks[String(bay)] ?? [];
    const after = now?.bays.find((b) => b.bay === bay)?.stacks ?? [];
    if (!sameList(before, after) || frozen.yard !== YARD) {
      lost.push(frozen.zone + ' bay ' + pad2(bay) + ': was [' + before.join(' ') + '], now [' + after.join(' ') + ']');
    }
  }
}
if (lost.length > 0) refuse(['the frozen first plan is not on the drawing unchanged:', ...lost]);
console.log('\nall 681 slots of the frozen first plan are in place, with the very same stacks.');

// (d) bays 01, 03, 05 … without a gap; stacks ascending; never an empty bay.
for (const z of decoded) {
  z.bays.forEach((b, i) => {
    if (b.bay !== i * 2 + 1) refuse('zone ' + z.zone + ': bay numbering breaks at ' + String(b.bay));
    if (b.stacks.length === 0) refuse('zone ' + z.zone + ' bay ' + pad2(b.bay) + ' has no stack');
    if (!b.stacks.every((s, k) => s >= 1 && (k === 0 || s > b.stacks[k - 1]))) {
      refuse('zone ' + z.zone + ' bay ' + pad2(b.bay) + ': stacks do not ascend');
    }
  });
}

// ── 10. the map: every zone where it really stands ──────────────────────────
// A zone is drawn as the map's strip: its bays side by side, BAY units each,
// inside a PAD frame, ZONE_H tall (src/client/YardMap.tsx lays it out so).
// At this scale one bay of the strip is one bay of the ground, so the strip's
// tiles stand on the bays they name; across, the strip is centred on the
// zone's stacks. J is drawn sideways: its strip is turned to the map's
// horizontal and laid over its own ground, starting at the side it shares
// with the sand square and running away from it.
const rects = [];
for (const z of decoded) {
  const all = z.parts.flatMap((part) => part.block.slots);
  const own = z.parts[0].block.frame;
  const bayCentre = (bay) => centreOf(all.filter((s) => s.bay === bay).map((s) => s.centre));
  const first = toMap(bayCentre(1));
  const last = toMap(bayCentre(z.bays[z.bays.length - 1].bay));
  const lateral = all.map((s) => own.v(s.centre));
  const mid = (Math.min(...lateral) + Math.max(...lateral)) / 2;
  const along = all.map((s) => own.u(s.centre));
  const centre = toMap(
    (() => {
      // The point of the zone's own frame halfway along its bays and across its stacks.
      const u = (Math.min(...along) + Math.max(...along)) / 2;
      const t = (own.deg * Math.PI) / 180;
      return [u * Math.cos(t) + mid * Math.sin(t), u * Math.sin(t) - mid * Math.cos(t)];
    })(),
  );
  const w = PAD * 2 + z.bays.length * BAY;
  const dir = [last[0] - first[0], last[1] - first[1]];
  const sideways = Math.abs(dir[1]) > Math.abs(dir[0]);
  if (!sideways && dir[0] <= 0) refuse('zone ' + z.zone + ': bay 01 is not on the left of the map');
  z.sideways = sideways;
  z.centre = centre;
  z.rect = { x: centre[0] - w / 2, y: centre[1] - ZONE_H / 2, w, h: ZONE_H };
  z.ground = (() => {
    const pts = all.flatMap((s) => s.corners.map(toMap));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  })();
  rects.push(z);
}

// ── 11. landmarks: the sheet's own outlines, named by its own words ─────────
const KINDS = [
  { re: /^Hangar$/i, kind: 'hangar', label: 'هنجر', size: [300, 8000] },
  { re: /^Building$/i, kind: 'building', label: 'مبنى', size: [40, 300] },
  { re: /^Tower$/i, kind: 'tower', label: 'برج', size: [40, 300] },
  { re: /^Caravan$/i, kind: 'caravan', label: 'كرفان', size: [40, 300] },
  { re: /^sand square$/i, kind: 'sand', label: 'ساحة الرمل', size: [150, 1500] },
];
const slotCells = slots.map((s) => s.corners);
const coversGround = (poly) => {
  const own = Math.abs(area(poly));
  const c = centreOf(poly);
  const reach = Math.max(...poly.map((p) => dist(p, c))) + 140;
  let covered = 0;
  for (const cell of slotCells) {
    if (dist(centreOf(cell), c) > reach) continue;
    covered += shared(poly, cell);
  }
  return covered > own * 0.05;
};
// Outlines: four corners joined by drawn lines — one closed stroke, or four
// separate strokes meeting end to end — every corner near square (the
// drafter's tower leans a few degrees).
const segments = [];
for (const stroke of strokes) {
  for (const loop of loopsOf(stroke.points)) {
    if ((stroke.colour === YELLOW || stroke.colour === BLUE) && loop.corners.length === 4 && loop.closed) {
      const sides = [0, 1, 2, 3].map((i) => dist(loop.corners[i], loop.corners[(i + 1) % 4]));
      if (slotSized(Math.max(sides[0], sides[1]), Math.min(sides[0], sides[1]))) continue;
    }
    const pts = loop.closed ? [...loop.corners, loop.corners[0]] : loop.corners;
    for (let i = 0; i + 1 < pts.length; i += 1) if (dist(pts[i], pts[i + 1]) >= 20) segments.push([pts[i], pts[i + 1]]);
  }
}
const nodes = [];
{
  // Line ends within 3 units are one corner; a coarse grid keeps it quick.
  const grid = new Map();
  const corner = (p) => {
    const gx = Math.floor(p[0] / 10);
    const gy = Math.floor(p[1] / 10);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const node of grid.get(String(gx + dx) + ',' + String(gy + dy)) ?? []) if (dist(node.p, p) < 3) return node;
      }
    }
    const node = { p, next: new Set(), id: nodes.length };
    nodes.push(node);
    const key = String(gx) + ',' + String(gy);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(node);
    return node;
  };
  for (const [a, b] of segments) {
    const na = corner(a);
    const nb = corner(b);
    if (na !== nb) {
      na.next.add(nb);
      nb.next.add(na);
    }
  }
}
const boxes = [];
{
  const seen = new Set();
  const square = (a, b, c) => {
    const ab = [a[0] - b[0], a[1] - b[1]];
    const cb = [c[0] - b[0], c[1] - b[1]];
    return Math.abs((ab[0] * cb[0] + ab[1] * cb[1]) / (Math.hypot(...ab) * Math.hypot(...cb))) < 0.17;
  };
  for (const a of nodes) {
    const around = [...a.next];
    for (let i = 0; i < around.length; i += 1) {
      for (let j = i + 1; j < around.length; j += 1) {
        const b = around[i];
        const d = around[j];
        for (const c of b.next) {
          if (c === a || !d.next.has(c)) continue;
          const key = [a.id, b.id, c.id, d.id].sort((x, y) => x - y).join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          const poly = [a.p, b.p, c.p, d.p];
          if (!square(d.p, a.p, b.p) || !square(a.p, b.p, c.p) || !square(b.p, c.p, d.p)) continue;
          boxes.push(poly);
        }
      }
    }
  }
}
const insideOrDistance = (poly, p) => {
  // 0 inside a convex outline, else the distance to its nearest side.
  const c = ccw(poly);
  let inside = Math.abs(area(poly)) > 1;
  let best = Infinity;
  for (let i = 0; i < c.length; i += 1) {
    const a = c[i];
    const b = c[(i + 1) % c.length];
    if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) inside = false;
    const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / len2));
    best = Math.min(best, dist(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]));
  }
  return inside ? 0 : best;
};
/** Two walls meeting at a corner span a rectangle, when nothing closes it. */
const cornerBox = (p) => {
  const walls = segments.filter(([a, b]) => dist(a, b) >= 300 && Math.min(dist(a, p), dist(b, p), dist(centreOf([a, b]), p)) < 3000);
  let best = null;
  for (const s1 of walls) {
    for (const s2 of walls) {
      if (s1 === s2) continue;
      const d1 = [s1[1][0] - s1[0][0], s1[1][1] - s1[0][1]];
      const d2 = [s2[1][0] - s2[0][0], s2[1][1] - s2[0][1]];
      const l1 = Math.hypot(...d1);
      const l2 = Math.hypot(...d2);
      if (Math.abs((d1[0] * d2[0] + d1[1] * d2[1]) / (l1 * l2)) > 0.07) continue;
      // Where s1 ends ON s2: the corner of the two walls.
      const end = [s1[0], s1[1]].find((q) => {
        const t = ((q[0] - s2[0][0]) * d2[0] + (q[1] - s2[0][1]) * d2[1]) / (l2 * l2);
        const foot = [s2[0][0] + t * d2[0], s2[0][1] + t * d2[1]];
        return t > -0.01 && t < 1.01 && dist(foot, q) < 3;
      });
      if (end === undefined) continue;
      const far1 = dist(s1[0], end) < 1 ? s1[1] : s1[0];
      const t2 = [s2[0], s2[1]].map((q) => [q, (q[0] - end[0]) * (p[0] - end[0]) + (q[1] - end[1]) * (p[1] - end[1])]);
      const far2 = t2.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
      if (dist(far2, end) < 50) continue; // the second wall must run on past the corner
      const poly = [end, far1, [far1[0] + far2[0] - end[0], far1[1] + far2[1] - end[1]], far2];
      if (insideOrDistance(poly, p) > 0 || coversGround(poly)) continue;
      if (best === null || Math.abs(area(poly)) < Math.abs(area(best))) best = poly;
    }
  }
  return best;
};

const landmarks = [];
for (const t of texts) {
  const kind = KINDS.find((k) => k.re.test(t.text.trim()));
  if (kind === undefined) continue;
  let found = null;
  let foundBy = '';
  for (const box of boxes) {
    const sides = [dist(box[0], box[1]), dist(box[1], box[2])];
    if (Math.max(...sides) < kind.size[0] || Math.max(...sides) > kind.size[1]) continue;
    const gap = insideOrDistance(box, t.at);
    if (gap > 400 || coversGround(box)) continue;
    if (found === null || gap < found.gap || (gap === found.gap && Math.abs(area(box)) < Math.abs(area(found.box)))) {
      found = { box, gap };
      foundBy = 'outline';
    }
  }
  let poly = found?.box ?? null;
  if (poly === null && kind.kind === 'hangar') {
    poly = cornerBox(t.at);
    foundBy = 'two walls';
  }
  if (poly === null) refuse('the ' + t.text.trim() + ' at drawing (' + t.at.map((v) => v.toFixed(0)).join(', ') + ') has no outline');
  // On the map: the outline's own sides set upright (its few degrees of lean
  // dropped), around its own centre.
  const sideA = (dist(poly[0], poly[1]) + dist(poly[2], poly[3])) / 2;
  const sideB = (dist(poly[1], poly[2]) + dist(poly[3], poly[0])) / 2;
  const aLevel = Math.abs(sheet.u(poly[1]) - sheet.u(poly[0])) >= Math.abs(sheet.v(poly[1]) - sheet.v(poly[0]));
  const wide = aLevel ? sideA : sideB;
  const tall = aLevel ? sideB : sideA;
  const c = toMap(centreOf(poly));
  landmarks.push({
    kind: kind.kind,
    label: kind.label,
    by: foundBy,
    text: t.text.trim(),
    rect: { x: c[0] - (wide * SCALE) / 2, y: c[1] - (tall * SCALE) / 2, w: wide * SCALE, h: tall * SCALE },
  });
}

// A strip is wider than its ground by its frame — and J's, turned level, is
// wider than J's ground by far. Where a strip would cover a landmark its own
// ground borders (H and J both touch the sand square), it slides along the
// bay line just clear of it, the shorter way, never leaving its own ground.
const crosses = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
for (const z of rects) {
  const hit = landmarks.filter((l) => crosses(z.rect, l.rect));
  if (hit.length === 0) continue;
  const g = z.ground;
  const shifts = hit.flatMap((l) => [l.rect.x - (z.rect.x + z.rect.w), l.rect.x + l.rect.w - z.rect.x]);
  const fits = shifts
    .map((dx) => ({ dx, rect: { ...z.rect, x: z.rect.x + dx } }))
    .filter(({ rect }) => rect.x <= g.x && rect.x + rect.w >= g.x + g.w && landmarks.every((l) => !crosses(rect, l.rect)))
    .sort((a, b) => Math.abs(a.dx) - Math.abs(b.dx));
  if (fits.length === 0) continue; // gate (c) below names the crossing
  z.slid = fits[0].dx;
  z.rect = fits[0].rect;
}

// Shift everything so the drawing starts at the origin; whole units.
const minX = Math.min(...rects.map((z) => z.rect.x), ...landmarks.map((l) => l.rect.x));
const minY = Math.min(...rects.map((z) => z.rect.y), ...landmarks.map((l) => l.rect.y));
const whole = (r) => {
  const x = Math.round(r.x - minX);
  const y = Math.round(r.y - minY);
  return { x, y, w: Math.round(r.x - minX + r.w) - x, h: Math.round(r.y - minY + r.h) - y };
};
for (const z of rects) {
  const r = whole(z.rect);
  z.x = r.x;
  z.y = r.y;
  z.w = PAD * 2 + z.bays.length * BAY;
  z.h = ZONE_H;
}
for (const l of landmarks) Object.assign(l, whole(l.rect));
landmarks.sort((a, b) => a.y - b.y || a.x - b.x || a.kind.localeCompare(b.kind));

console.log('\nmap transform: turn the sheet by ' + THETA.toFixed(3) + '° (the mean long side of every slot) so the zones lie level,');
console.log('  then half a turn (mirror both axes): X = −' + SCALE.toFixed(5) + '·u, Y = −' + SCALE.toFixed(5) + '·v,');
console.log('  u = x·cos θ + y·sin θ, v = x·sin θ − y·cos θ (drawing units, page scale left out);');
console.log('  one bay pitch of the drawing = ' + PITCH.toFixed(2) + ' units = ' + String(BAY) + ' map units; shifted by (' +
  (-minX).toFixed(1) + ', ' + (-minY).toFixed(1) + ') so the map starts at 0, 0.');
console.log('  stack 1 stands a quarter turn ' + (HAND > 0 ? 'clockwise' : 'counter-clockwise') + ' from the way the bays rise (the frozen plan\'s walls say so).');
console.log('\nzone rects:');
for (const z of rects) {
  console.log('  ' + z.zone + ': x ' + String(z.x) + ', y ' + String(z.y) + ', w ' + String(z.w) + ', h ' + String(z.h) +
    (z.sideways ? '   drawn sideways on the sheet, laid level here;' : '') +
    (z.slid === undefined ? '' : '   slid ' + z.slid.toFixed(1) + ' along its bays, clear of the landmark it borders'));
}
console.log('landmarks:');
for (const l of landmarks) console.log('  ' + l.kind.padEnd(8) + ' «' + l.text + '» by its ' + l.by + ': x ' + String(l.x) + ', y ' + String(l.y) + ', w ' + String(l.w) + ', h ' + String(l.h));

// (c) nothing drawn over anything.
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const crossings = [];
for (let i = 0; i < rects.length; i += 1) {
  for (let j = i + 1; j < rects.length; j += 1) if (overlap(rects[i], rects[j])) crossings.push('zones ' + rects[i].zone + ' and ' + rects[j].zone);
  for (const l of landmarks) if (overlap(rects[i], l)) crossings.push('zone ' + rects[i].zone + ' and the ' + l.kind + ' at ' + String(l.x) + ', ' + String(l.y));
}
if (crossings.length > 0) refuse(['the map draws one thing over another:', ...crossings]);

// ── 12. emit src/shared/asezaLayout.ts ──────────────────────────────────────
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

const out = `// GENERATED by tools/decode-aseza-pdf.mjs from the official ASEZA drawing
// (the authority's newer plan, «new aseza  yard_recover (5) 111-Model.pdf»)
// — DO NOT EDIT BY HAND; fix the decoder and regenerate.
//
// This whole drawing is SAHA 2 — the owner's yards 1 and 3 are separate
// grounds the system does not model yet, so every address here reads 2-….
// ${String(total)} twenty-foot ground slots in all: ${decoded.map((z) => z.zone + ' ' + String(slotCount(z))).join(', ')} —
// counted from the drawing itself. Every slot of the first plan (681, frozen
// in tests/fixtures/asezaLayout681.ts) is here unchanged. Odd bays take a 20,
// even bays are a 40 lying across the two odd bays around them. The zones
// stand where the drawing puts them, turned so bay 01 is on the left.

import type { YardLayout } from './types';

export const ASEZA: YardLayout = {
  zones: [
${rects.map(zoneLiteral).join(',\n')},
  ],
  landmarks: [
${landmarks.map((l) => `    { kind: '${l.kind}', label: '${l.label}', x: ${String(l.x)}, y: ${String(l.y)}, w: ${String(l.w)}, h: ${String(l.h)} }`).join(',\n')},
  ],
};
`;
writeFileSync(OUT, out);
console.log('\nwrote ' + OUT);

import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type { BatchDto, BatchSummaryDto, BatchMatch, Position } from '../src/shared/types';
import type { SheetRow } from '../src/shared/customsSheet';

/**
 * دفعات كشف الجمارك — the upload door, the literal reader, the live registry.
 * The sheet files are BUILT here, byte by byte (a stored-entry zip writer
 * with its own CRC32), so no binary fixture ever sits in git and every test
 * shows exactly what «a real xlsx» means.
 */

// ---- a tiny stored-entry (method 0) zip writer ----

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries: ReadonlyArray<{ name: string; text: string }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.text, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, eocd]);
}

const escapeXml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const colName = (n: number): string => {
  let s = '';
  let x = n;
  while (x > 0) {
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
};

/** A real one-sheet xlsx around the given grid, cells as inline strings. */
function xlsxOf(grid: ReadonlyArray<ReadonlyArray<string>>): Buffer {
  const rows = grid
    .map(
      (row, r) =>
        `<row>${row
          .map((cell, c) =>
            cell === ''
              ? ''
              : `<c r="${colName(c + 1)}${String(r + 1)}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`,
          )
          .join('')}</row>`,
    )
    .join('');
  return storedZip([
    {
      name: 'xl/workbook.xml',
      text: '<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    },
    { name: 'xl/worksheets/sheet1.xml', text: `<worksheet><sheetData>${rows}</sheetData></worksheet>` },
  ]);
}

/** A real docx holding the same table as one w:tbl. */
function docxOf(grid: ReadonlyArray<ReadonlyArray<string>>): Buffer {
  const rows = grid
    .map(
      (row) =>
        `<w:tr>${row
          .map((cell) => `<w:tc><w:p><w:r><w:t>${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`)
          .join('')}</w:tr>`,
    )
    .join('');
  return storedZip([
    { name: 'word/document.xml', text: `<w:document><w:body><w:tbl>${rows}</w:tbl></w:body></w:document>` },
  ]);
}

// Valid numbers from the owner's real sheets.
const SHEET = [
  ['#', 'Unit Nbr', 'Type', 'BL Nbr'],
  ['1', 'TGHU1234565', '20', 'CFA0935597'],
  ['2', 'MSKU7654325', '20', 'CFA0935597'],
  ['3', 'CMAU3320281', '40', '024G570796'],
] as const;
const asGrid = SHEET.map((row) => [...row]);

// ---- the API harness ----

let app: FastifyInstance;
let ownerCookie: string;

const at = (bay: number, stack: number): Position => ({ zone: 'B', bay, stack, tier: 'A' });

const cookieOf = (headers: Record<string, unknown>): string => {
  const raw = headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : (raw as string | undefined);
  if (header === undefined) throw new Error('no session cookie');
  return header.split(';')[0] ?? '';
};

async function call(options: {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  payload?: unknown;
  cookie?: string;
}): Promise<{ status: number; body: unknown }> {
  const response = await app.inject({
    method: options.method,
    url: options.url,
    ...(options.payload === undefined ? {} : { payload: options.payload as object }),
    headers: options.cookie === undefined ? {} : { cookie: options.cookie },
  });
  return {
    status: response.statusCode,
    body: response.body === '' ? null : (JSON.parse(response.body) as unknown),
  };
}

async function upload(
  url: string,
  bytes: Buffer,
  cookie: string,
): Promise<{ status: number; body: unknown }> {
  const response = await app.inject({
    method: 'POST',
    url,
    headers: { cookie, 'content-type': 'application/octet-stream' },
    payload: bytes as unknown as object,
  });
  return {
    status: response.statusCode,
    body: response.body === '' ? null : (JSON.parse(response.body) as unknown),
  };
}

async function receive(number: string, size: 20 | 40, position: Position): Promise<number> {
  const made = await call({
    method: 'POST',
    url: '/api/containers',
    payload: {
      number,
      size,
      bill: '3210',
      billKind: null,
      notes: '',
      position,
      truck: '500',
      seal: 'JO100001',
      driver: '',
      weight: '',
      handling: 'CRANE',
    },
    cookie: ownerCookie,
  });
  if (made.status !== 201) throw new Error(`gate-in failed: ${JSON.stringify(made.body)}`);
  return (made.body as { id: number }).id;
}

async function hire(name: string, permissions: string[]): Promise<string> {
  const made = await call({
    method: 'POST',
    url: '/api/users',
    payload: { name, pin: '1234', permissions },
    cookie: ownerCookie,
  });
  const id = (made.body as { id: number }).id;
  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { userId: id, pin: '1234' },
  });
  return cookieOf(login.headers as Record<string, unknown>);
}

beforeEach(async () => {
  const db = openDatabase(':memory:');
  app = buildApp(db);
  await app.ready();
  const response = await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { password: 'yard-secret' },
  });
  if (response.statusCode !== 200) throw new Error('setup failed');
  ownerCookie = cookieOf(response.headers as Record<string, unknown>);
});

describe('the preview', () => {
  it('reads the sheet and keeps nothing', async () => {
    const previewed = await upload('/api/batches/preview', xlsxOf(asGrid), ownerCookie);
    expect(previewed.status).toBe(200);
    const rows = (previewed.body as { rows: SheetRow[] }).rows;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      seq: 1,
      number: 'TGHU1234565',
      size: 20,
      sizeRaw: '20',
      bill: 'CFA0935597',
      lineOp: '',
    });
    const listed = await call({ method: 'GET', url: '/api/batches', cookie: ownerCookie });
    expect((listed.body as { batches: BatchSummaryDto[] }).batches).toHaveLength(0);
  });
});

describe('the registry', () => {
  it('keeps the sheet and computes arrivals live off the yard book', async () => {
    const made = await upload(
      '/api/batches?name=' + encodeURIComponent('دفعة 11') + '&filename=d11.xlsx',
      xlsxOf(asGrid),
      ownerCookie,
    );
    expect(made.status).toBe(201);
    const batch = made.body as BatchDto;
    expect(batch.name).toBe('دفعة 11');
    expect(batch.rows).toHaveLength(3);
    expect(batch.rows.every((row) => row.status === 'PENDING')).toBe(true);

    // One listed container arrives.
    const id = await receive('TGHU1234565', 20, at(1, 1));
    const detail = async (): Promise<BatchDto> =>
      (await call({ method: 'GET', url: `/api/batches/${String(batch.id)}`, cookie: ownerCookie }))
        .body as BatchDto;
    let rows = (await detail()).rows;
    expect(rows[0]?.status).toBe('STANDING');
    expect(rows[0]?.containerId).toBe(id);
    expect(rows[0]?.enteredAt).not.toBeNull();
    expect(rows[1]?.status).toBe('PENDING');

    const listed = await call({ method: 'GET', url: '/api/batches', cookie: ownerCookie });
    expect((listed.body as { batches: BatchSummaryDto[] }).batches[0]).toMatchObject({
      total: 3,
      arrived: 1,
    });

    // It leaves — the row says so, with the date.
    await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/exit`,
      payload: { truck: '600', driver: '' },
      cookie: ownerCookie,
    });
    rows = (await detail()).rows;
    expect(rows[0]?.status).toBe('EXITED');
    expect(rows[0]?.exitedAt).not.toBeNull();

    // Struck from the book — the sheet waits again; restored — it is back.
    await call({ method: 'DELETE', url: `/api/containers/${String(id)}`, cookie: ownerCookie });
    rows = (await detail()).rows;
    expect(rows[0]?.status).toBe('PENDING');
    await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/restore`,
      payload: {},
      cookie: ownerCookie,
    });
    rows = (await detail()).rows;
    expect(rows[0]?.status).toBe('EXITED');
  });

  it('answers the gate lookup while the box is still expected — newest sheet first', async () => {
    await upload('/api/batches?name=A', xlsxOf(asGrid), ownerCookie);
    const ask = async (number: string): Promise<BatchMatch | null> =>
      (
        (await call({
          method: 'GET',
          url: `/api/batches/lookup?number=${number}`,
          cookie: ownerCookie,
        })) .body as { match: BatchMatch | null }
      ).match;

    expect(await ask('TGHU1234565')).toMatchObject({
      batchName: 'A',
      size: 20,
      bill: 'CFA0935597',
    });
    // The gate types it with spaces and small letters — same answer.
    expect(await ask(encodeURIComponent('tghu 123456-5'))).toMatchObject({ batchName: 'A' });

    // A newer sheet carries the same number under another bill: it answers.
    const second = [
      ['#', 'Unit Nbr', 'Type', 'BL Nbr'],
      ['1', 'TGHU1234565', '20', 'NEWBILL99'],
    ];
    await upload('/api/batches?name=B', xlsxOf(second), ownerCookie);
    expect(await ask('TGHU1234565')).toMatchObject({ batchName: 'B', bill: 'NEWBILL99' });

    // Arrived — no sheet expects it any more.
    await receive('TGHU1234565', 20, at(1, 1));
    expect(await ask('TGHU1234565')).toBeNull();
    expect(await ask('ZZZU0000000')).toBeNull();
  });

  it('reads the same table from docx and from csv, comma or semicolon', async () => {
    const fromXlsx = (await upload('/api/batches/preview', xlsxOf(asGrid), ownerCookie))
      .body as { rows: SheetRow[] };
    const fromDocx = (await upload('/api/batches/preview', docxOf(asGrid), ownerCookie))
      .body as { rows: SheetRow[] };
    expect(fromDocx.rows).toEqual(fromXlsx.rows);

    const commas = Buffer.from(
      '#,Unit Nbr,Type,BL Nbr\n1,TGHU1234565,20,CFA0935597\n2,MSKU7654325,20,CFA0935597\n3,CMAU3320281,40,024G570796\n',
      'utf8',
    );
    const fromCsv = (await upload('/api/batches/preview', commas, ownerCookie))
      .body as { rows: SheetRow[] };
    expect(fromCsv.rows).toEqual(fromXlsx.rows);

    // Semicolons and a quoted cell holding the other delimiter.
    const semis = Buffer.from(
      '#;Unit Nbr;Type;BL Nbr\n1;TGHU1234565;20;"CFA,0935597"\n2;MSKU7654325;20;B2\n',
      'utf8',
    );
    const rows = ((await upload('/api/batches/preview', semis, ownerCookie))
      .body as { rows: SheetRow[] }).rows;
    expect(rows[0]?.bill).toBe('CFA,0935597');
  });

  it('keeps the sheet word for word: entities, a 45, a mistyped number', async () => {
    const tricky = [
      ['#', 'Unit Nbr', 'Type', 'BL Nbr'],
      ['1', 'TGHU1234565', '45', 'A&B'],
      ['2', 'CMAU332028', '20', 'B-2'],
    ];
    const previewed = (await upload('/api/batches/preview', xlsxOf(tricky), ownerCookie))
      .body as { rows: SheetRow[] };
    expect(previewed.rows[0]).toMatchObject({ size: null, sizeRaw: '45', bill: 'A&B' });
    expect(previewed.rows[1]?.number).toBe('CMAU332028');

    const made = await upload('/api/batches?name=T', xlsxOf(tricky), ownerCookie);
    const batch = made.body as BatchDto;
    expect(batch.rows[0]).toMatchObject({ size: null, sizeRaw: '45', bill: 'A&B' });
    expect(batch.rows[1]?.number).toBe('CMAU332028');
  });
});

describe('the refusals, each with its remedy code', () => {
  const codeOf = (body: unknown): string => (body as { code: string }).code;

  it('a scan, an old xls, a web page, garbage, a wordy sheet, a giant', async () => {
    const pdf = await upload('/api/batches/preview', Buffer.from('%PDF-1.4 junk'), ownerCookie);
    expect(pdf.status).toBe(400);
    expect(codeOf(pdf.body)).toBe('SHEET_SCANNED');

    const ole = Buffer.alloc(600);
    ole.writeUInt32BE(0xd0cf11e0, 0);
    const xls = await upload('/api/batches/preview', ole, ownerCookie);
    expect(xls.status).toBe(400);
    expect(codeOf(xls.body)).toBe('SHEET_OLD_EXCEL');

    const html = await upload(
      '/api/batches/preview',
      Buffer.from('<!doctype html><table><tr><td>TGHU1234565</td></tr></table>'),
      ownerCookie,
    );
    expect(html.status).toBe(400);
    expect(codeOf(html.body)).toBe('SHEET_UNREADABLE');

    // Windows-1256 bytes are not UTF-8 — refused, never mis-decoded.
    const cp1256 = Buffer.from([0x31, 0x2c, 0xc7, 0xe1, 0xcd, 0x0a]);
    const bad = await upload('/api/batches/preview', cp1256, ownerCookie);
    expect(bad.status).toBe(400);
    expect(codeOf(bad.body)).toBe('SHEET_UNREADABLE');

    const wordy = await upload(
      '/api/batches/preview',
      xlsxOf([
        ['التاريخ', 'البيان'],
        ['01/09', 'وصول'],
      ]),
      ownerCookie,
    );
    expect(wordy.status).toBe(409);
    expect(codeOf(wordy.body)).toBe('SHEET_EMPTY');

    const giant = ['#,Unit Nbr,Type,BL Nbr'];
    for (let i = 1; i <= 2001; i += 1) giant.push(`${String(i)},TGHU1234565,20,B`);
    const too = await upload('/api/batches/preview', Buffer.from(giant.join('\n')), ownerCookie);
    expect(too.status).toBe(409);
    expect(codeOf(too.body)).toBe('SHEET_TOO_BIG');
  });
});

describe('the doors', () => {
  it('gate hands upload, report readers watch, the owner alone strikes', async () => {
    const accounting = await hire('محاسب', ['ACCOUNTING']);
    const reports = await hire('قارئ', ['REPORTS']);
    const gate = await hire('بواب', ['GATE_IN']);

    // No session at all.
    expect((await upload('/api/batches/preview', xlsxOf(asGrid), '')).status).toBe(401);

    // The unconcerned clerk is refused everywhere.
    expect((await upload('/api/batches/preview', xlsxOf(asGrid), accounting)).status).toBe(403);
    expect((await call({ method: 'GET', url: '/api/batches', cookie: accounting })).status).toBe(403);
    expect(
      (await call({ method: 'GET', url: '/api/batches/lookup?number=TGHU1234565', cookie: accounting }))
        .status,
    ).toBe(403);

    // The gate hand uploads; the report reader watches but may not upload.
    const made = await upload('/api/batches?name=A', xlsxOf(asGrid), gate);
    expect(made.status).toBe(201);
    const batchId = (made.body as BatchDto).id;
    expect((await upload('/api/batches/preview', xlsxOf(asGrid), reports)).status).toBe(403);
    expect((await call({ method: 'GET', url: '/api/batches', cookie: reports })).status).toBe(200);
    expect(
      (await call({ method: 'GET', url: `/api/batches/${String(batchId)}`, cookie: reports })).status,
    ).toBe(200);
    expect(
      (await call({ method: 'GET', url: '/api/batches/lookup?number=TGHU1234565', cookie: gate }))
        .status,
    ).toBe(200);

    // The NAME is the office's own label and the gate may correct it; the
    // reader may not, and the rows of the sheet never move.
    const before = (await call({
      method: 'GET',
      url: `/api/batches/${String(batchId)}`,
      cookie: ownerCookie,
    })).body as BatchDto;
    expect(
      (await call({
        method: 'PATCH',
        url: `/api/batches/${String(batchId)}`,
        payload: { name: 'مسروق' },
        cookie: reports,
      })).status,
    ).toBe(403);
    const renamed = await call({
      method: 'PATCH',
      url: `/api/batches/${String(batchId)}`,
      payload: { name: 'دفعة 14 — المصححة' },
      cookie: gate,
    });
    expect(renamed.status).toBe(200);
    expect((renamed.body as BatchDto).name).toBe('دفعة 14 — المصححة');
    // Only the label moved.
    expect((renamed.body as BatchDto).rows).toEqual(before.rows);
    expect((renamed.body as BatchDto).filename).toBe(before.filename);
    expect((renamed.body as BatchDto).createdAt).toBe(before.createdAt);
    // A blank name is no name: the sheet keeps the one it has.
    expect(
      (await call({
        method: 'PATCH',
        url: `/api/batches/${String(batchId)}`,
        payload: { name: '   ' },
        cookie: gate,
      })).status,
    ).toBe(400);

    // Striking the sheet is the owner's, and it leaves the yard book alone.
    expect(
      (await call({ method: 'DELETE', url: `/api/batches/${String(batchId)}`, cookie: gate })).status,
    ).toBe(403);
    expect(
      (await call({ method: 'DELETE', url: `/api/batches/${String(batchId)}`, cookie: ownerCookie }))
        .status,
    ).toBe(200);
    expect(
      ((await call({ method: 'GET', url: '/api/batches', cookie: ownerCookie })).body as {
        batches: BatchSummaryDto[];
      }).batches,
    ).toHaveLength(0);
    expect(
      (await call({ method: 'GET', url: `/api/batches/${String(batchId)}`, cookie: ownerCookie }))
        .status,
    ).toBe(404);
    expect(
      ((await call({ method: 'GET', url: '/api/batches/lookup?number=TGHU1234565', cookie: ownerCookie }))
        .body as { match: BatchMatch | null }).match,
    ).toBeNull();
  });
});

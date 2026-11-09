import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type {
  PermitDto,
  PermitReportRow,
  Position,
  StorageMark,
  StorageReportRow,
} from '../src/shared/types';

/**
 * تصريح نقل حاويات إلى مديرية التخزين — «اذا قعدت اكثر من تسعين يوم
 * بننقلهم ل مكان داخل الساحة … تصريح نقل حاويات التابعة لمديرية التخزين
 * وهي نقل وليست اخراج».
 *
 * The owner's four decisions, each held here:
 * 1. A paper and a mark — issuing moves nothing on the ground.
 * 2. Issued from كشف الرُّكود, many bills on one paper.
 * 3. Under ninety days is a warning on the screen, never a refusal here.
 * 4. Its own book: serials, void stubs and second-paper warnings never mix
 *    with the exit permit's.
 */

let db: DatabaseSync;
let app: FastifyInstance;
let ownerCookie = '';

interface Reply {
  status: number;
  body: unknown;
}

const call = async (options: InjectOptions, cookie: string = ownerCookie): Promise<Reply> => {
  const response = await app.inject({
    ...options,
    headers: { ...options.headers, ...(cookie === '' ? {} : { cookie }) },
  });
  let body: unknown = null;
  try {
    body = response.json();
  } catch {
    body = response.body;
  }
  return { status: response.statusCode, body };
};

const cookieOf = async (payload: Record<string, unknown>): Promise<string> => {
  const response = await app.inject({ method: 'POST', url: '/api/login', payload });
  const set = response.headers['set-cookie'];
  const raw = Array.isArray(set) ? set[0] : set;
  return (raw ?? '').split(';')[0] ?? '';
};

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  await app.inject({ method: 'POST', url: '/api/setup', payload: { password: 'owner-secret-1' } });
  ownerCookie = await cookieOf({ password: 'owner-secret-1' });
});
afterEach(() => {
  db.close();
});

const DAY = 86_400_000;
const slot = (bay: number, stack: number): Position => ({ zone: 'B', bay, stack, tier: 'A' });

/** Receive a twenty at the gate, then back-date its entry by `daysAgo`. */
async function gateIn(number: string, position: Position, bill: string, daysAgo = 0): Promise<number> {
  const made = await call({
    method: 'POST',
    url: '/api/containers',
    payload: {
      number,
      size: 20,
      bill,
      notes: '',
      position,
      truck: '60-84785',
      seal: 'JO41100',
      driver: 'عطالله علي',
      weight: '24000',
      handling: 'CRANE',
    },
  });
  if (made.status !== 201) throw new Error(`gate-in failed: ${JSON.stringify(made.body)}`);
  const id = (made.body as { id: number }).id;
  if (daysAgo > 0) {
    db.prepare('UPDATE containers SET entered_at = ? WHERE id = ?').run(
      new Date(Date.now() - daysAgo * DAY).toISOString(),
      id,
    );
  }
  return id;
}

const storagePermit = (ids: readonly number[], cookie?: string): Promise<Reply> =>
  call(
    {
      method: 'POST',
      url: '/api/permits',
      payload: { kind: 'STORAGE', items: ids.map((containerId) => ({ containerId, weight: '' })) },
    },
    cookie,
  );

const exitPermit = (bill: string, ids: readonly number[], cookie?: string): Promise<Reply> =>
  call(
    {
      method: 'POST',
      url: '/api/permits',
      payload: { bill, items: ids.map((containerId) => ({ containerId })) },
    },
    cookie,
  );

const window = (): string => {
  const from = new Date(Date.now() - DAY).toISOString();
  const to = new Date(Date.now() + DAY).toISOString();
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
};

const book = async (kind: 'EXIT' | 'STORAGE'): Promise<PermitReportRow[]> =>
  ((await call({ method: 'GET', url: `/api/permits?${window()}&kind=${kind}` })).body as {
    rows: PermitReportRow[];
  }).rows;

const register = async (): Promise<StorageReportRow[]> =>
  ((await call({ method: 'GET', url: `/api/reports/storage?${window()}` })).body as {
    rows: StorageReportRow[];
  }).rows;

const markOf = async (id: number): Promise<StorageMark | null> =>
  ((await call({ method: 'GET', url: `/api/containers/${String(id)}` })).body as {
    storage: StorageMark | null;
  }).storage;

/** Hire a clerk with exactly these permissions and hand back the session. */
async function hire(name: string, pin: string, permissions: readonly string[]): Promise<string> {
  const made = await call({ method: 'POST', url: '/api/users', payload: { name, pin, permissions } });
  if (made.status !== 201 && made.status !== 200) {
    throw new Error(`hire failed: ${JSON.stringify(made.body)}`);
  }
  const staff = (await call({ method: 'GET', url: '/api/users' })).body as {
    users: Array<{ id: number; name: string }>;
  };
  const userId = staff.users.find((user) => user.name === name)?.id;
  return cookieOf({ userId, pin });
}

describe('تصريح نقل إلى مديرية التخزين', () => {
  it('keeps a book of its own: exit and storage each count 1, 2 …', async () => {
    const a = await gateIn('STOR0011', slot(1, 1), '3210', 120);
    const b = await gateIn('STOR0022', slot(1, 2), '7777', 95);

    const exitOne = await exitPermit('3210', [a]);
    expect(exitOne.status).toBe(201);
    expect((exitOne.body as PermitDto).kind).toBe('EXIT');
    expect((exitOne.body as PermitDto).serial).toBe(1);

    const storeOne = await storagePermit([a, b]);
    expect(storeOne.status).toBe(201);
    const paper = storeOne.body as PermitDto;
    expect(paper.kind).toBe('STORAGE');
    expect(paper.serial).toBe(1);
    // Many bills on one paper: none on the permit, each on its own line.
    expect(paper.bill).toBe('');
    expect(paper.items.map((item) => item.bill)).toEqual(['3210', '7777']);

    expect(((await exitPermit('7777', [b])).body as PermitDto).serial).toBe(2);
    expect(((await storagePermit([b])).body as PermitDto).serial).toBe(2);

    expect((await book('EXIT')).map((row) => row.serial)).toEqual([1, 2]);
    expect((await book('STORAGE')).map((row) => [row.serial, row.containers])).toEqual([
      [1, 2],
      [2, 1],
    ]);
    // A book read without naming its kind is the exit book, as it always was.
    const plain = (await call({ method: 'GET', url: `/api/permits?${window()}` })).body as {
      rows: PermitReportRow[];
    };
    expect(plain.rows.map((row) => row.serial)).toEqual([1, 2]);
  });

  it('warns each book about its own papers only', async () => {
    const a = await gateIn('STOR0033', slot(3, 1), '3210', 100);
    await exitPermit('3210', [a]);

    const asStorage = (await call({
      method: 'GET',
      url: `/api/permits/for?ids=${String(a)}&kind=STORAGE`,
    })).body as { rows: unknown[] };
    expect(asStorage.rows).toHaveLength(0);

    await storagePermit([a]);
    const storageAgain = (await call({
      method: 'GET',
      url: `/api/permits/for?ids=${String(a)}&kind=STORAGE`,
    })).body as { rows: Array<{ serial: number }> };
    expect(storageAgain.rows.map((row) => row.serial)).toEqual([1]);
    const asExit = (await call({ method: 'GET', url: `/api/permits/for?ids=${String(a)}` }))
      .body as { rows: Array<{ serial: number }> };
    expect(asExit.rows.map((row) => row.serial)).toEqual([1]);
  });

  it('pins each line: correcting the record later does not change the stamped paper', async () => {
    const a = await gateIn('STOR0044', slot(5, 1), '3210', 100);
    const issued = (await storagePermit([a])).body as PermitDto;
    db.prepare("UPDATE containers SET bill = '9999', number = 'STOR0045' WHERE id = ?").run(a);

    const reprint = (await call({ method: 'GET', url: `/api/permits/${String(issued.id)}` }))
      .body as PermitDto;
    expect(reprint.items[0]?.bill).toBe('3210');
    expect(reprint.items[0]?.number).toBe('STOR0044');
    expect((await register())[0]?.bill).toBe('3210');
  });

  it('moves nothing on the ground', async () => {
    const a = await gateIn('STOR0055', slot(7, 1), '3210', 100);
    const before = db.prepare('SELECT COUNT(*) AS n FROM movements').get() as { n: number };
    await storagePermit([a]);
    const after = db.prepare('SELECT COUNT(*) AS n FROM movements').get() as { n: number };
    expect(after.n).toBe(before.n);
    const row = db.prepare('SELECT zone, bay, stack, tier FROM containers WHERE id = ?').get(a);
    expect(row).toEqual({ zone: 'B', bay: 7, stack: 1, tier: 'A' });
  });

  it('accepts a box under ninety days — the warning is the screen’s, not a refusal', async () => {
    const young = await gateIn('STOR0066', slot(9, 1), '3210', 12);
    const issued = await storagePermit([young]);
    expect(issued.status).toBe(201);
  });

  it('refuses a box that is not standing, naming it, and writes nothing', async () => {
    const standing = await gateIn('STOR0077', slot(11, 1), '3210', 100);
    const leaving = await gateIn('STOR0088', slot(11, 2), '3210', 100);
    const out = await call({
      method: 'POST',
      url: `/api/containers/${String(leaving)}/exit`,
      payload: { truck: '60-71544', driver: 'معاذ' },
    });
    expect(out.status).toBe(200);

    // Awaiting its truck: the exit card is written, so it is leaving.
    const awaiting = await storagePermit([standing, leaving]);
    expect(awaiting.status).toBe(409);
    expect(awaiting.body).toEqual({ code: 'STORAGE_NOT_STANDING', details: { other: 'STOR0088' } });

    // Loaded and gone: nothing left to move.
    const loaded = await call({
      method: 'POST',
      url: `/api/containers/${String(leaving)}/loaded`,
      payload: {},
    });
    expect(loaded.status).toBe(200);
    expect((await storagePermit([leaving])).status).toBe(409);

    // A struck-out record is not there at all.
    const struck = await gateIn('STOR0099', slot(13, 1), '3210', 100);
    expect((await call({ method: 'DELETE', url: `/api/containers/${String(struck)}` })).status).toBe(
      200,
    );
    expect((await storagePermit([struck])).status).toBe(404);

    // No paper was minted by any refusal: the book still starts at 1.
    expect(((await storagePermit([standing])).body as PermitDto).serial).toBe(1);
  });

  it('an exit permit still needs its bill', async () => {
    const a = await gateIn('STOR0100', slot(15, 1), '3210', 100);
    const bare = await call({
      method: 'POST',
      url: '/api/permits',
      payload: { items: [{ containerId: a }] },
    });
    expect(bare.status).toBe(400);
  });
});

describe('who issues, corrects and reads the storage book', () => {
  it('MOVE issues and corrects it; GATE_OUT does not; each keeps to its own paper', async () => {
    const a = await gateIn('STOR0111', slot(17, 1), '3210', 100);
    const b = await gateIn('STOR0122', slot(17, 2), '3210', 100);
    const mover = await hire('ناقل', '1111', ['MOVE']);
    const gate = await hire('بواب', '2222', ['GATE_OUT']);

    expect((await storagePermit([a], gate)).status).toBe(403);
    const issued = await storagePermit([a, b], mover);
    expect(issued.status).toBe(201);
    const storageId = (issued.body as PermitDto).id;

    expect((await exitPermit('3210', [a], mover)).status).toBe(403);
    const exitPaper = await exitPermit('3210', [a], gate);
    expect(exitPaper.status).toBe(201);
    const exitId = (exitPaper.body as PermitDto).id;

    const strike = (id: number, cookie: string): Promise<Reply> =>
      call(
        { method: 'PATCH', url: `/api/permits/${String(id)}`, payload: { remove: [a] } },
        cookie,
      );
    expect((await strike(storageId, gate)).status).toBe(403);
    expect((await strike(exitId, mover)).status).toBe(403);
    expect((await strike(storageId, mover)).status).toBe(200);

    // Reading the register is REPORTS'; voiding a paper is the owner's alone.
    expect((await call({ method: 'GET', url: `/api/reports/storage?${window()}` }, mover)).status).toBe(
      403,
    );
    expect(
      (await call({ method: 'DELETE', url: `/api/permits/${String(storageId)}` }, mover)).status,
    ).toBe(403);
    expect((await call({ method: 'DELETE', url: `/api/permits/${String(storageId)}` })).status).toBe(
      200,
    );
  });
});

describe('كشف المنقولة للتخزين', () => {
  it('lists each container with the two spans, in the book’s order', async () => {
    const old = await gateIn('STOR0133', slot(19, 1), '3210', 120);
    const young = await gateIn('STOR0144', slot(19, 2), '7777', 40);
    await storagePermit([old, young]);

    const rows = await register();
    expect(rows.map((row) => row.number)).toEqual(['STOR0133', 'STOR0144']);
    expect(rows.map((row) => row.dwellAtTransfer)).toEqual([120, 40]);
    expect(rows.map((row) => row.dwellDays)).toEqual([120, 40]);
    expect(rows[0]?.serial).toBe(1);
    expect(rows[0]?.weight).toBe('');
    expect(rows[0]?.position).toEqual(slot(19, 1));
    expect(rows[1]?.bill).toBe('7777');

    // Outside the period it is not listed: the transfer date decides.
    const before = new Date(Date.now() - 10 * DAY).toISOString();
    const earlier = new Date(Date.now() - 5 * DAY).toISOString();
    const past = (await call({
      method: 'GET',
      url: `/api/reports/storage?from=${encodeURIComponent(before)}&to=${encodeURIComponent(earlier)}`,
    })).body as { rows: StorageReportRow[] };
    expect(past.rows).toHaveLength(0);
  });

  it('a box that leaves after its transfer stays listed, its span ending at its exit card', async () => {
    const a = await gateIn('STOR0155', slot(21, 1), '3210', 100);
    await storagePermit([a]);
    const out = await call({
      method: 'POST',
      url: `/api/containers/${String(a)}/exit`,
      payload: { truck: '60-71544', driver: 'معاذ' },
    });
    expect(out.status).toBe(200);
    // Put the exit card sixty days after the entry.
    const entered = (db.prepare('SELECT entered_at FROM containers WHERE id = ?').get(a) as {
      entered_at: string;
    }).entered_at;
    db.prepare('UPDATE containers SET exited_at = ? WHERE id = ?').run(
      new Date(Date.parse(entered) + 60 * DAY).toISOString(),
      a,
    );

    const [row] = await register();
    expect(row?.exitedAt).not.toBeNull();
    expect(row?.dwellAtTransfer).toBe(100);
    expect(row?.dwellDays).toBe(60);
  });

  it('a struck line and a voided paper leave the register, and take the mark away', async () => {
    const a = await gateIn('STOR0166', slot(23, 1), '3210', 100);
    const b = await gateIn('STOR0177', slot(23, 2), '3210', 100);
    const issued = (await storagePermit([a, b])).body as PermitDto;

    expect((await markOf(a))?.serial).toBe(1);
    expect(await markOf(b)).not.toBeNull();

    await call({
      method: 'PATCH',
      url: `/api/permits/${String(issued.id)}`,
      payload: { remove: [a] },
    });
    expect((await register()).map((row) => row.number)).toEqual(['STOR0177']);
    expect(await markOf(a)).toBeNull();

    await call({ method: 'DELETE', url: `/api/permits/${String(issued.id)}` });
    expect(await register()).toHaveLength(0);
    expect(await markOf(b)).toBeNull();
  });

  it('a voided storage paper keeps its seat in its own book, never in the exit book', async () => {
    const a = await gateIn('STOR0188', slot(25, 1), '3210', 100);
    await storagePermit([a]);
    await storagePermit([a]);
    const third = (await storagePermit([a])).body as PermitDto;
    await call({ method: 'DELETE', url: `/api/permits/${String(third.id)}` });

    const rows = await book('STORAGE');
    expect(rows.map((row) => [row.serial, row.voided === true])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
    expect(await book('EXIT')).toHaveLength(0);
    // The voided number is never handed out again.
    expect(((await storagePermit([a])).body as PermitDto).serial).toBe(4);
  });
});

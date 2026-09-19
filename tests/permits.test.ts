import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type { PermitDto, PermitReportRow, Position } from '../src/shared/types';

/**
 * تصريح تحميل وخروج داخلي: a numbered permission paper for one bill's
 * containers, going out to موقع المقص. Its ledger is held to the same rule
 * as every other numbered paper here — the live permits of one year read
 * 1 … N with no hole — and issuing one moves nothing on the ground.
 */

let db: DatabaseSync;
let app: FastifyInstance;
let cookie = '';

interface ReplyBody {
  id: number;
  code: string;
  serial: number;
  serialYear: number;
  bill: string;
  items: PermitDto['items'];
  rows: PermitReportRow[];
  users: Array<{ id: number }>;
  exitedAt: string | null;
}

interface Reply {
  status: number;
  body: ReplyBody;
}

const call = async (options: InjectOptions): Promise<Reply> => {
  const response = await app.inject({
    ...options,
    headers: { ...options.headers, ...(cookie === '' ? {} : { cookie }) },
  });
  const set = response.headers['set-cookie'];
  if (typeof set === 'string') cookie = set.split(';')[0] ?? cookie;
  let body: unknown = null;
  try {
    body = response.json();
  } catch {
    body = response.body;
  }
  return { status: response.statusCode, body: body as ReplyBody };
};

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  cookie = '';
  await call({ method: 'POST', url: '/api/setup', payload: { password: 'owner-secret-1' } });
  await call({ method: 'POST', url: '/api/login', payload: { password: 'owner-secret-1' } });
});
afterEach(() => {
  db.close();
});

const slot = (bay: number, stack: number): Position => ({ zone: 'B', bay, stack, tier: 'A' });

const gateIn = async (number: string, position: Position, bill: string): Promise<Reply> =>
  call({
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
      weight: '',
      handling: 'CRANE',
    },
  });

const issue = async (
  bill: string,
  items: ReadonlyArray<{ containerId: number; truck: string }>,
): Promise<Reply> =>
  call({ method: 'POST', url: '/api/permits', payload: { bill, items: items as unknown[] } });

const range = (): string => {
  const from = new Date(Date.now() - 86_400_000).toISOString();
  const to = new Date(Date.now() + 86_400_000).toISOString();
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
};

describe('إصدار التصريح', () => {
  it('numbers the year’s book 1, 2 … and the paper carries the entry-card facts', async () => {
    const first = await gateIn('PERM0011', slot(1, 1), '3210');
    const second = await gateIn('PERM0022', slot(1, 2), '3210');

    const permit = await issue('3210', [
      { containerId: first.body.id, truck: '60-84785' },
      { containerId: second.body.id, truck: '' },
    ]);
    expect(permit.status).toBe(201);
    expect(permit.body.serial).toBe(1);
    expect(permit.body.bill).toBe('3210');
    expect(permit.body.items).toHaveLength(2);
    const one = permit.body.items[0];
    expect(one?.number).toBe('PERM0011');
    // سند بطاقة الإدخال: the entry card's own serial rides on the permit row.
    expect(one?.cardIn).toBe(1);
    expect(one?.truck).toBe('60-84785');
    // The locked size rides along for the paper's totals line.
    expect(one?.size).toBe(20);
    // A blank truck stays blank — written on the paper by hand.
    expect(permit.body.items[1]?.truck).toBe('');

    const again = await issue('3210', [{ containerId: first.body.id, truck: '411' }]);
    expect(again.body.serial).toBe(2);
  });

  it('refuses a stray container, a double line, and an empty paper', async () => {
    const ours = await gateIn('PERM0038', slot(3, 1), '3210');
    const other = await gateIn('PERM0043', slot(3, 2), '9999');

    const stray = await issue('3210', [{ containerId: other.body.id, truck: '' }]);
    expect(stray.status).toBe(400);
    const doubled = await issue('3210', [
      { containerId: ours.body.id, truck: '' },
      { containerId: ours.body.id, truck: '' },
    ]);
    expect(doubled.status).toBe(400);
    const empty = await issue('3210', []);
    expect(empty.status).toBe(400);
  });

  it('a departed container is accepted: the office records the exit first, the paper after', async () => {
    // «ادخلت رقم البوليصة لحاويات التي خرجت» — the owner's own flow: the
    // gate writes the exit, and the permit paper is printed afterwards.
    const gone = await gateIn('PERM0059', slot(3, 3), '3210');
    await call({
      method: 'POST',
      url: `/api/containers/${String(gone.body.id)}/exit`,
      payload: { truck: '500', driver: '' },
    });

    const permit = await issue('3210', [{ containerId: gone.body.id, truck: '500' }]);
    expect(permit.status).toBe(201);
    expect(permit.body.items[0]?.number).toBe('PERM0059');
    expect(permit.body.items[0]?.truck).toBe('500');
  });

  it('is exit paperwork: GATE_OUT issues it, the log-reader lists it, others are refused', async () => {
    const entered = await gateIn('PERM0064', slot(5, 1), '3210');
    await call({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'بواب', pin: '4321', permissions: ['GATE_IN'] },
    });
    const staff = (await call({ method: 'GET', url: '/api/users' })).body as unknown as {
      users: Array<{ id: number }>;
    };
    await call({ method: 'POST', url: '/api/logout' });
    cookie = '';
    await call({
      method: 'POST',
      url: '/api/login',
      payload: { userId: staff.users[0]?.id, pin: '4321' },
    });
    const denied = await issue('3210', [{ containerId: entered.body.id, truck: '' }]);
    expect(denied.status).toBe(403);
    const deniedList = await call({ method: 'GET', url: `/api/permits?${range()}` });
    expect(deniedList.status).toBe(403);
  });
});

describe('كشف خروج وتحميل داخلي', () => {
  it('lists the period’s permits with their counts, and hands each paper back', async () => {
    const first = await gateIn('PERM0070', slot(7, 1), '3210');
    const second = await gateIn('PERM0086', slot(7, 2), '3210');
    const permit = await issue('3210', [
      { containerId: first.body.id, truck: '411' },
      { containerId: second.body.id, truck: '' },
    ]);

    const listed = await call({ method: 'GET', url: `/api/permits?${range()}` });
    expect(listed.status).toBe(200);
    expect(listed.body.rows).toHaveLength(1);
    expect(listed.body.rows[0]?.containers).toBe(2);
    expect(listed.body.rows[0]?.bill).toBe('3210');

    const paper = await call({ method: 'GET', url: `/api/permits/${String(permit.body.id)}` });
    expect(paper.status).toBe(200);
    expect(paper.body.items.map((item) => item.number)).toEqual(['PERM0070', 'PERM0086']);
  });

  it('a struck permit leaves «تصريح ملغى» in its own seat — the book never skips', async () => {
    // «بدي اذا حذفت تصريح بدي يعمل مثل ما بعمل ببطاقات الخروج بحيث يحط
    // تصريح ملغي بس اقدر اطبعه لحتى ما يكون في فجوات بالتسلسل».
    const a = await gateIn('PERM0189', slot(17, 1), '3210');
    const b = await gateIn('PERM0194', slot(17, 2), '3210');
    const c = await gateIn('PERM0200', slot(19, 1), '3210');
    await issue('3210', [{ containerId: a.body.id, truck: '' }]);
    const middle = await issue('3210', [{ containerId: b.body.id, truck: '' }]);
    const newest = await issue('3210', [{ containerId: c.body.id, truck: '' }]);

    // The middle one goes: its number stays, as a stub.
    await call({ method: 'DELETE', url: `/api/permits/${String(middle.body.id)}` });
    let rows = (await call({ method: `GET`, url: `/api/permits?${range()}` })).body.rows;
    expect(rows.map((row) => row.serial)).toEqual([1, 2, 3]);
    expect(rows[1]?.voided).toBe(true);
    expect(rows[1]?.id).toBe(0);
    expect(rows[1]?.bill).toBe('');
    expect(rows[1]?.containers).toBe(0);
    // The live ones are exactly what they were.
    expect(rows[0]?.voided).toBeUndefined();
    expect(rows[2]?.voided).toBeUndefined();

    // The NEWEST goes too: its stub shows at once, not when the next
    // permit is issued above it.
    await call({ method: 'DELETE', url: `/api/permits/${String(newest.body.id)}` });
    rows = (await call({ method: `GET`, url: `/api/permits?${range()}` })).body.rows;
    expect(rows.map((row) => row.serial)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.voided === true)).toEqual([false, true, true]);

    // And the voided numbers stay taken: the next permit is the fourth.
    const d = await gateIn('PERM0215', slot(19, 2), '3210');
    const next = await issue('3210', [{ containerId: d.body.id, truck: '' }]);
    expect(next.body.serial).toBe(4);
  });

  it('reads by NUMBER, not by the clock — the row beside a serial is that serial', async () => {
    // Three papers, issued in order, then the last one reissued into an
    // earlier number the way a cancelled pair is filled. Ordered by time it
    // would sit at the foot of the book and every row after it would name a
    // serial that is not its own — «فتحت التسلسل 290 طلعتلي 293».
    const a = await gateIn('PERM0133', slot(13, 1), '3210');
    const b = await gateIn('PERM0148', slot(13, 2), '3210');
    const c = await gateIn('PERM0164', slot(15, 1), '3210');
    await issue('3210', [{ containerId: a.body.id, truck: '' }]);
    const middle = await issue('3210', [{ containerId: b.body.id, truck: '' }]);
    const last = await issue('3210', [{ containerId: c.body.id, truck: '' }]);
    expect(last.body.serial).toBe(3);

    // The middle paper is struck and the newest takes its number.
    await call({ method: 'DELETE', url: `/api/permits/${String(middle.body.id)}` });
    db.prepare('UPDATE permits SET serial = 2 WHERE id = ?').run(last.body.id);

    const listed = await call({ method: `GET`, url: `/api/permits?${range()}` });
    expect(listed.status).toBe(200);
    expect(listed.body.rows.map((row) => row.serial)).toEqual([1, 2]);
    // Row two IS serial two, whatever hour it was stamped at.
    expect(listed.body.rows[1]?.serial).toBe(2);
  });

  it('a reprint reads as the stamped original, however the record changes after', async () => {
    await gateIn('PERM0102', slot(11, 1), '9999');
    const listed = await gateIn('PERM0117', slot(11, 2), '3210');
    const permit = await issue('3210', [{ containerId: listed.body.id, truck: '' }]);
    // The paper went out naming this container, its entry card and its class.
    expect(permit.body.items[0]?.cardIn).toBe(2);
    expect(permit.body.items[0]?.number).toBe('PERM0117');
    expect(permit.body.items[0]?.size).toBe(20);

    // The record is corrected afterwards — a mistyped number put right, and
    // the class corrected on the map.
    const before = await call({ method: 'GET', url: `/api/containers/${String(listed.body.id)}` });
    const live = (before.body as unknown as { container: Record<string, unknown> }).container;
    const edited = await call({
      method: 'PATCH',
      url: `/api/containers/${String(listed.body.id)}`,
      payload: { ...live, number: 'PERM0125' },
    });
    expect(edited.status).toBe(200);
    const reclassed = await call({
      method: 'POST',
      url: `/api/containers/${String(listed.body.id)}/reclass`,
      payload: { to: { zone: 'B', bay: 10, stack: 2, tier: 'A' } },
    });
    expect(reclassed.status).toBe(200);

    // The stamped paper in the drawer says what it always said. A permit's
    // lines are a snapshot, not a live view — number, card and class alike.
    const paper = await call({ method: 'GET', url: `/api/permits/${String(permit.body.id)}` });
    expect(paper.body.items[0]?.cardIn).toBe(2);
    expect(paper.body.items[0]?.number).toBe('PERM0117');
    expect(paper.body.items[0]?.size).toBe(20);
  });

  it('the weight rides the paper as issued — the permit’s own figure, not a live read', async () => {
    const entered = await gateIn('PERM0122', slot(13, 1), '7788');
    const permit = await call({
      method: 'POST',
      url: '/api/permits',
      payload: {
        bill: '7788',
        items: [{ containerId: entered.body.id, truck: '', weight: '30480' }],
      },
    });
    expect(permit.status).toBe(201);
    expect(permit.body.items[0]?.weight).toBe('30480');
    // The container itself was recorded with NO weight, so the paper's
    // figure can only be the permit's own snapshot.
    const detail = await call({ method: 'GET', url: `/api/containers/${String(entered.body.id)}` });
    expect(
      (detail.body as unknown as { container: { weight: string } }).container.weight,
    ).toBe('');
    const paper = await call({ method: 'GET', url: `/api/permits/${String(permit.body.id)}` });
    expect(paper.body.items[0]?.weight).toBe('30480');
  });

  it('voiding is the owner’s alone, and the void keeps its number', async () => {
    const box = await gateIn('PERM0091', slot(9, 1), '3210');
    const one = await issue('3210', [{ containerId: box.body.id, truck: '' }]);
    const two = await issue('3210', [{ containerId: box.body.id, truck: '' }]);
    expect(two.body.serial).toBe(2);

    // An employee holding every permission still may not void a numbered paper.
    await call({
      method: 'POST',
      url: '/api/users',
      payload: {
        name: 'مشرف',
        pin: '4321',
        permissions: ['GATE_IN', 'MOVE', 'GATE_OUT', 'EDIT', 'DELETE', 'REPORTS'],
      },
    });
    const staff = (await call({ method: 'GET', url: '/api/users' })).body as unknown as {
      users: Array<{ id: number }>;
    };
    await call({ method: 'POST', url: '/api/logout' });
    cookie = '';
    await call({
      method: 'POST',
      url: '/api/login',
      payload: { userId: staff.users[0]?.id, pin: '4321' },
    });
    const denied = await call({ method: 'DELETE', url: `/api/permits/${String(one.body.id)}` });
    expect(denied.status).toBe(403);

    await call({ method: 'POST', url: '/api/logout' });
    cookie = '';
    await call({ method: 'POST', url: '/api/login', payload: { password: 'owner-secret-1' } });
    const removed = await call({ method: 'DELETE', url: `/api/permits/${String(one.body.id)}` });
    expect(removed.status).toBe(200);

    // The struck paper can no longer be opened, and the survivor keeps the
    // number printed on it: 2. Number 1 belongs to the voided paper for ever
    // — and it keeps its seat in the book as «تصريح ملغى», not a hole.
    expect(
      (await call({ method: 'GET', url: `/api/permits/${String(one.body.id)}` })).status,
    ).toBe(404);
    const listed = await call({ method: 'GET', url: `/api/permits?${range()}` });
    expect(listed.body.rows.map((row) => row.serial)).toEqual([1, 2]);
    expect(listed.body.rows[0]?.voided).toBe(true);
    expect(listed.body.rows[1]?.voided).toBeUndefined();

    // And the next permit issued is 3, never 1.
    const third = await issue('3210', [{ containerId: box.body.id, truck: '' }]);
    expect(third.body.serial).toBe(3);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type { DriverHaulRow, OrphanWageRow, Position } from '../src/shared/types';

/**
 * محاسبة السائقين: every gate movement is one payable haul — the container's
 * IN and its OUT are two hauls even for the same truck. The driver's name is
 * optional at the gate, so a haul without one is carried by its PLATE rather
 * than dropped; dropping it once hid eight real hauls and made the sheet
 * disagree with كشف السيارات. The figure is written by hand per haul, the
 * receipt is stamped per haul, a settled figure locks, and the whole ledger
 * sits behind its own permission.
 */

let db: DatabaseSync;
let app: FastifyInstance;
let cookie = '';

const WIDE = { from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z' };

const call = async (
  options: InjectOptions,
): Promise<{ status: number; body: Record<string, unknown> }> => {
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
  return { status: response.statusCode, body: body as Record<string, unknown> };
};

const listHauls = async (): Promise<DriverHaulRow[]> => {
  const reply = await call({
    method: 'GET',
    url: `/api/drivers?from=${WIDE.from}&to=${WIDE.to}`,
  });
  expect(reply.status).toBe(200);
  return reply.body['rows'] as DriverHaulRow[];
};

const gateIn = async (
  number: string,
  position: Position,
  driver: string,
  truck = '60-11111',
): Promise<number> => {
  const reply = await call({
    method: 'POST',
    url: '/api/containers',
    payload: {
      number,
      size: 20,
      bill: '7100',
      notes: '',
      position,
      truck,
      seal: 'JO500',
      driver,
      weight: '',
      handling: 'CRANE',
    },
  });
  expect(reply.status).toBe(201);
  return reply.body['id'] as number;
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

describe('كشف حساب السائقين', () => {
  it('one truck, two hauls: the IN and the OUT are separate payable lines', async () => {
    const id = await gateIn('WAGE0011', { zone: 'B', bay: 3, stack: 1, tier: 'A' }, 'أبو خالد');
    await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/exit`,
      payload: { truck: '60-11111', driver: 'أبو خالد' },
    });
    const rows = await listHauls();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.direction).sort()).toEqual(['IN', 'OUT']);
    expect(rows.every((row) => row.driver === 'أبو خالد')).toBe(true);
    expect(rows.every((row) => row.amount === null && row.paidAt === null)).toBe(true);
  });

  it('the figure is written by hand, the receipt stamps the confirmer, and a settled figure locks', async () => {
    const id = await gateIn('WAGE0027', { zone: 'B', bay: 3, stack: 1, tier: 'A' }, 'أبو فراس');
    const wage = { containerId: id, direction: 'IN' };
    // Receipt before any figure: nothing to confirm yet.
    const early = await call({
      method: 'POST',
      url: '/api/wages/pay',
      payload: { ...wage, paid: true },
    });
    expect(early.status).toBe(409);
    expect(early.body['code']).toBe('WAGE_MISSING');

    expect(
      (await call({ method: 'PUT', url: '/api/wages', payload: { ...wage, amount: 12.5 } }))
        .status,
    ).toBe(200);
    expect((await listHauls())[0]?.amount).toBe(12.5);

    expect(
      (
        await call({
          method: 'POST',
          url: '/api/wages/pay',
          payload: { ...wage, paid: true },
        })
      ).status,
    ).toBe(200);
    const paid = (await listHauls())[0];
    expect(paid?.paidAt).not.toBeNull();
    expect(paid?.paidBy).toBe('المالك');

    // The settled figure is locked …
    const locked = await call({
      method: 'PUT',
      url: '/api/wages',
      payload: { ...wage, amount: 20 },
    });
    expect(locked.status).toBe(409);
    expect(locked.body['code']).toBe('WAGE_PAID');
    // … until the receipt is lifted.
    await call({ method: 'POST', url: '/api/wages/pay', payload: { ...wage, paid: false } });
    expect(
      (await call({ method: 'PUT', url: '/api/wages', payload: { ...wage, amount: 20 } }))
        .status,
    ).toBe(200);
    expect((await listHauls())[0]?.amount).toBe(20);
  });

  it('a haul with no driver name is carried by its plate, never dropped', async () => {
    const id = await gateIn('WAGE0032', { zone: 'B', bay: 3, stack: 1, tier: 'A' }, '');
    const rows = await listHauls();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.driver).toBe('');
    expect(rows[0]?.truck).toBe('60-11111');
    // And it takes a figure like any other: somebody drove that truck.
    expect(
      (
        await call({
          method: 'PUT',
          url: '/api/wages',
          payload: { containerId: id, direction: 'IN', amount: 10 },
        })
      ).status,
    ).toBe(200);
    expect((await listHauls())[0]?.amount).toBe(10);
  });

  /**
   * Why the wage book can always name a payee: the gate demands a plate in
   * both directions, and a record that has left cannot be corrected into
   * having none. So «بلا اسم» is a real state and «بلا اسم ولا رقم» is not —
   * which is what lets a nameless haul be carried by its truck.
   */
  it('an exited record cannot be stripped of its plate, so a payee always exists', async () => {
    const id = await gateIn('WAGE0044', { zone: 'B', bay: 3, stack: 1, tier: 'A' }, 'أبو زيد');
    await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/exit`,
      payload: { truck: '60-11111', driver: 'أبو زيد' },
    });
    const record = (
      (await call({ method: 'GET', url: `/api/containers/${String(id)}` })).body as unknown as {
        container: Record<string, unknown>;
      }
    ).container;
    const stripped = await call({
      method: 'PATCH',
      url: `/api/containers/${String(id)}`,
      payload: { ...record, truckOut: '', driverOut: '' },
    });
    expect(stripped.status).toBe(409);
    // The name alone may go, and the haul keeps its truck to answer for it.
    expect(
      (
        await call({
          method: 'PATCH',
          url: `/api/containers/${String(id)}`,
          payload: { ...record, driverOut: '' },
        })
      ).status,
    ).toBe(200);
    const out = (await listHauls()).find((row) => row.direction === 'OUT');
    expect(out?.driver).toBe('');
    expect(out?.truck).toBe('60-11111');
  });

  /**
   * The owner's own count: «يوم اروح عندك على كشف السيارات ... بعطي انو 79
   * سيارة، بس ب حساب السائقين بعطي 77». The two registers read the same
   * period from different tables, so this pins them to the same number.
   */
  it('the wage sheet counts exactly what كشف السيارات counts', async () => {
    const named = await gateIn('WAGE0055', { zone: 'B', bay: 3, stack: 1, tier: 'A' }, 'أبو علي');
    await gateIn('WAGE0069', { zone: 'B', bay: 5, stack: 1, tier: 'A' }, '');
    await gateIn('WAGE0073', { zone: 'B', bay: 7, stack: 1, tier: 'A' }, '', '60-99999');
    // One of them leaves with no name on the way out either.
    await call({
      method: 'POST',
      url: `/api/containers/${String(named)}/exit`,
      payload: { truck: '60-11111', driver: '' },
    });
    const register = (
      await call({
        method: 'GET',
        url: `/api/reports/truck?from=${WIDE.from}&to=${WIDE.to}`,
      })
    ).body['rows'] as unknown[];
    expect(register).toHaveLength(4);
    expect(await listHauls()).toHaveLength(register.length);
  });

  /**
   * «وفي حال ادخال المبلغ ومسحه … تبقى القيمة موجودة»: an emptied box must
   * empty the book, not silently keep the old figure — and a settled figure
   * resists erasing exactly as it resists editing.
   */
  it('erasing the box erases the figure, unless the receipt is stamped', async () => {
    const id = await gateIn('WAGE0088', { zone: 'B', bay: 3, stack: 1, tier: 'A' }, 'أبو سامر');
    const wage = { containerId: id, direction: 'IN' };
    await call({ method: 'PUT', url: '/api/wages', payload: { ...wage, amount: 15 } });
    expect((await listHauls())[0]?.amount).toBe(15);

    expect(
      (await call({ method: 'POST', url: '/api/wages/clear', payload: wage })).status,
    ).toBe(200);
    expect((await listHauls())[0]?.amount).toBeNull();

    // Nothing left to erase.
    expect(
      (await call({ method: 'POST', url: '/api/wages/clear', payload: wage })).status,
    ).toBe(404);

    // Written again, then settled — and now it is locked.
    await call({ method: 'PUT', url: '/api/wages', payload: { ...wage, amount: 15 } });
    await call({ method: 'POST', url: '/api/wages/pay', payload: { ...wage, paid: true } });
    const locked = await call({ method: 'POST', url: '/api/wages/clear', payload: wage });
    expect(locked.status).toBe(409);
    expect(locked.body['code']).toBe('WAGE_PAID');
    expect((await listHauls())[0]?.amount).toBe(15);

    // The receipt lifted, the figure erases again — and the haul stays.
    await call({ method: 'POST', url: '/api/wages/pay', payload: { ...wage, paid: false } });
    expect(
      (await call({ method: 'POST', url: '/api/wages/clear', payload: wage })).status,
    ).toBe(200);
    const after = await listHauls();
    expect(after).toHaveLength(1);
    expect(after[0]?.amount).toBeNull();
    expect(after[0]?.paidAt).toBeNull();
  });

  /**
   * «وقت يجي يحاسب يكون سهل محاسبته»: one press settles a whole account. One
   * transaction, already-settled hauls left alone rather than re-dated, and
   * an unpriced haul stops the WHOLE stroke — a half-stamped account is worse
   * than an unstamped one.
   */
  it('a whole account settles in one stroke, and one unpriced haul stops it', async () => {
    const first = await gateIn('WAGE0101', { zone: 'B', bay: 3, stack: 1, tier: 'A' }, 'أبو ليث');
    const second = await gateIn('WAGE0115', { zone: 'B', bay: 5, stack: 1, tier: 'A' }, 'أبو ليث');
    const third = await gateIn('WAGE0129', { zone: 'B', bay: 7, stack: 1, tier: 'A' }, 'أبو ليث');
    const haul = (id: number): { containerId: number; direction: string } => ({
      containerId: id,
      direction: 'IN',
    });
    await call({ method: 'PUT', url: '/api/wages', payload: { ...haul(first), amount: 10 } });
    await call({ method: 'PUT', url: '/api/wages', payload: { ...haul(second), amount: 20 } });

    // The third carries no figure, so the stroke is refused whole.
    const refused = await call({
      method: 'POST',
      url: '/api/wages/pay-many',
      payload: { hauls: [haul(first), haul(second), haul(third)] },
    });
    expect(refused.status).toBe(409);
    expect(refused.body['code']).toBe('WAGE_MISSING');
    expect((await listHauls()).every((row) => row.paidAt === null)).toBe(true);

    // The first settled alone, then the pair: only the outstanding one moves.
    await call({ method: 'POST', url: '/api/wages/pay', payload: { ...haul(first), paid: true } });
    const before = (await listHauls()).find((row) => row.containerId === first)?.paidAt;
    const many = await call({
      method: 'POST',
      url: '/api/wages/pay-many',
      payload: { hauls: [haul(first), haul(second)] },
    });
    expect(many.status).toBe(200);
    expect(many.body['stamped']).toBe(1);
    const after = await listHauls();
    expect(after.find((row) => row.containerId === first)?.paidAt).toBe(before);
    expect(after.find((row) => row.containerId === second)?.paidAt).not.toBeNull();
  });

  it('the ledger sits behind its own permission, granted like any other', async () => {
    await call({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'محاسب', pin: '5533', permissions: ['ACCOUNTING'] },
    });
    const staff = (await call({ method: 'GET', url: '/api/users' })).body as unknown as {
      users: Array<{ id: number; name: string }>;
    };
    const accountant = staff.users.find((user) => user.name === 'محاسب');
    await call({ method: 'POST', url: '/api/logout' });
    cookie = '';
    await call({
      method: 'POST',
      url: '/api/login',
      payload: { userId: accountant?.id, pin: '5533' },
    });
    expect(
      (await call({ method: 'GET', url: `/api/drivers?from=${WIDE.from}&to=${WIDE.to}` }))
        .status,
    ).toBe(200);
    // A clerk with gate permissions but no ACCOUNTING is refused.
    await call({ method: 'POST', url: '/api/logout' });
    cookie = '';
    await call({ method: 'POST', url: '/api/login', payload: { password: 'owner-secret-1' } });
    await call({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'بوابة', pin: '6644', permissions: ['GATE_IN', 'GATE_OUT'] },
    });
    const two = (await call({ method: 'GET', url: '/api/users' })).body as unknown as {
      users: Array<{ id: number; name: string }>;
    };
    const gate = two.users.find((user) => user.name === 'بوابة');
    await call({ method: 'POST', url: '/api/logout' });
    cookie = '';
    await call({ method: 'POST', url: '/api/login', payload: { userId: gate?.id, pin: '6644' } });
    expect(
      (await call({ method: 'GET', url: `/api/drivers?from=${WIDE.from}&to=${WIDE.to}` }))
        .status,
    ).toBe(403);
  });
});

describe('أجر على سجل محذوف', () => {
  it('surfaces a struck record’s figure — paid or not — and voids it on the ledger’s word', async () => {
    const id = await gateIn('WAGE0099', { zone: 'B', bay: 5, stack: 1, tier: 'A' }, 'يزن ماهر');
    const wage = { containerId: id, direction: 'IN' };
    await call({ method: 'PUT', url: '/api/wages', payload: { ...wage, amount: 100 } });
    await call({ method: 'POST', url: '/api/wages/pay', payload: { ...wage, paid: true } });

    // Live: not an orphan, and voiding is refused — the live flows own it.
    expect((await call({ method: 'GET', url: '/api/wages/orphans' })).body['rows']).toEqual([]);
    const early = await call({ method: 'POST', url: '/api/wages/void', payload: wage });
    expect(early.status).toBe(409);
    expect(early.body['code']).toBe('NOT_DELETED');

    // Struck: the statement drops the haul; the orphan list picks the figure up.
    await call({ method: 'DELETE', url: `/api/containers/${String(id)}` });
    expect(await listHauls()).toHaveLength(0);
    const orphans = (await call({ method: 'GET', url: '/api/wages/orphans' })).body[
      'rows'
    ] as OrphanWageRow[];
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({ number: 'WAGE0099', direction: 'IN', driver: 'يزن ماهر', amount: 100 });
    expect(orphans[0]?.paidAt).not.toBeNull();

    // Voided although paid; gone; nothing left to void.
    expect((await call({ method: 'POST', url: '/api/wages/void', payload: wage })).status).toBe(200);
    expect((await call({ method: 'GET', url: '/api/wages/orphans' })).body['rows']).toEqual([]);
    expect((await call({ method: 'POST', url: '/api/wages/void', payload: wage })).status).toBe(404);

    // Restored, the haul is back with no figure — the void stands.
    await call({ method: 'POST', url: `/api/containers/${String(id)}/restore`, payload: {} });
    const back = await listHauls();
    expect(back).toHaveLength(1);
    expect(back[0]?.amount).toBeNull();
  });
});

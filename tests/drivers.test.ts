import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type { DriverHaulRow, Position } from '../src/shared/types';

/**
 * محاسبة السائقين: every gate movement with a named driver is one payable
 * haul — the container's IN and its OUT are two hauls even for the same
 * truck. The figure is written by hand per haul, the receipt is stamped per
 * haul, a settled figure locks, and the whole ledger sits behind its own
 * permission.
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
      truck: '60-11111',
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

  it('a haul with no named driver takes no wage, and the OUT needs its own', async () => {
    const id = await gateIn('WAGE0032', { zone: 'B', bay: 3, stack: 1, tier: 'A' }, '');
    expect(await listHauls()).toHaveLength(0);
    const refused = await call({
      method: 'PUT',
      url: '/api/wages',
      payload: { containerId: id, direction: 'IN', amount: 10 },
    });
    expect(refused.status).toBe(400);
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

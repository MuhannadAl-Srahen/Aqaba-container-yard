import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type { ContainerDto } from '../src/shared/types';

/**
 * تصحيح السجل: كل رفض يسمّي سببه.
 *
 * The owner hit this and could not act on it: «بصير في مشكلة بقول المعلومات
 * غير كاملة او غير صحيحة». Six different rules on the correction route all
 * refused with the single code VALIDATION, so the sentence he read named no
 * cause and no remedy — and the real one, found by probing, was not a field
 * he had typed at all. His card had been open while the container was gated
 * out from the booth, so the form described a container that was standing
 * against a row that had left.
 *
 * These lock both halves: each rule now has its own code, and a payload the
 * schema rejects says WHICH field it tripped on.
 */

let db: DatabaseSync;
let app: FastifyInstance;
let cookie = '';

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

const gateIn = async (number: string): Promise<number> => {
  const reply = await call({
    method: 'POST',
    url: '/api/containers',
    payload: {
      number,
      size: 20,
      bill: '7100',
      notes: '',
      position: { zone: 'B', bay: 3, stack: 1, tier: 'A' },
      truck: '60-11111',
      seal: 'JO500',
      driver: 'أبو خالد',
      weight: '',
      handling: 'CRANE',
    },
  });
  expect(reply.status).toBe(201);
  return reply.body['id'] as number;
};

const detail = async (id: number): Promise<ContainerDto> =>
  (
    (await call({ method: 'GET', url: `/api/containers/${String(id)}` })).body as unknown as {
      container: ContainerDto;
    }
  ).container;

/** Exactly the thirteen fields the correction form sends. */
const form = (c: ContainerDto, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  number: c.number,
  bill: c.bill,
  size: c.size,
  notes: c.notes,
  weight: c.weight,
  handling: c.handling,
  truckIn: c.truckIn,
  driverIn: c.driverIn,
  sealIn: c.sealIn,
  truckOut: c.truckOut,
  driverOut: c.driverOut,
  enteredAt: c.enteredAt,
  exitedAt: c.exitedAt,
  ...over,
});

const patch = async (
  id: number,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> =>
  call({ method: 'PATCH', url: `/api/containers/${String(id)}`, payload });

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

describe('كل رفض على التصحيح يسمّي سببه', () => {
  /**
   * The owner's actual failure, reproduced: the form was built before the
   * container left. Nothing he typed was wrong; the record had moved on.
   */
  it('a form built before the container left names THAT, not the fields', async () => {
    const id = await gateIn('STAL0011');
    const snapshot = await detail(id);
    expect(snapshot.exitedAt).toBeNull();

    await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/exit`,
      payload: { truck: '60-22222', driver: 'أبو علي' },
    });

    // He changes one harmless field and saves the stale form.
    const refused = await patch(id, form(snapshot, { driverIn: 'اسم مصحّح' }));
    expect(refused.status).toBe(409);
    expect(refused.body['code']).toBe('EXIT_PAPERS_MISSING');

    // Re-read the record, and the very same correction goes through.
    const fresh = await detail(id);
    const ok = await patch(id, form(fresh, { driverIn: 'اسم مصحّح' }));
    expect(ok.status).toBe(200);
    expect((await detail(id)).driverIn).toBe('اسم مصحّح');
  });

  it('exit paperwork on a container that never left is refused by its own name', async () => {
    const id = await gateIn('STAL0027');
    const c = await detail(id);
    const refused = await patch(id, form(c, { truckOut: '60-33333' }));
    expect(refused.status).toBe(409);
    expect(refused.body['code']).toBe('EXIT_ON_STANDING');
  });

  it('a gate time that has not happened yet is refused by its own name', async () => {
    const id = await gateIn('STAL0032');
    const c = await detail(id);
    const soon = new Date(Date.now() + 6 * 3_600_000).toISOString();
    const refused = await patch(id, form(c, { enteredAt: soon }));
    expect(refused.status).toBe(409);
    expect(refused.body['code']).toBe('TIME_IN_FUTURE');
  });

  it('an exit earlier than its entry is refused by its own name', async () => {
    const id = await gateIn('STAL0046');
    await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/exit`,
      payload: { truck: '60-22222', driver: 'أبو علي' },
    });
    const c = await detail(id);
    const before = new Date(Date.parse(c.enteredAt) - 3_600_000).toISOString();
    const refused = await patch(id, form(c, { exitedAt: before }));
    expect(refused.status).toBe(409);
    expect(refused.body['code']).toBe('EXIT_BEFORE_ENTRY');
  });

  /**
   * And when it IS a field, the refusal says which one — so the sentence on
   * screen can name the box instead of the whole form.
   */
  it('a rejected field names itself', async () => {
    const id = await gateIn('STAL0059');
    const c = await detail(id);

    const long = await patch(id, form(c, { driverOut: 'ا'.repeat(61) }));
    expect(long.status).toBe(400);
    expect(long.body['code']).toBe('VALIDATION');
    expect((long.body['details'] as Record<string, unknown>)['field']).toBe('driverOut');

    const empty = await patch(id, form(c, { sealIn: '  ' }));
    expect(empty.status).toBe(400);
    expect((empty.body['details'] as Record<string, unknown>)['field']).toBe('sealIn');

    const bad = await patch(id, form(c, { number: 'A'.repeat(21) }));
    expect(bad.status).toBe(400);
    expect((bad.body['details'] as Record<string, unknown>)['field']).toBe('number');
  });

  it('the ordinary correction still passes untouched', async () => {
    const id = await gateIn('STAL0063');
    const c = await detail(id);
    const ok = await patch(id, form(c, { notes: 'ملاحظة', weight: '19500' }));
    expect(ok.status).toBe(200);
    const after = await detail(id);
    expect(after.notes).toBe('ملاحظة');
    expect(after.weight).toBe('19500');
    // And the entry instant did not drift under an edit of something else.
    expect(after.enteredAt).toBe(c.enteredAt);
  });
});

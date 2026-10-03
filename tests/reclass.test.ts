import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type { ContainerDto, MovementDto, Position } from '../src/shared/types';

/**
 * تصحيح فئة الحاوية — «ممكن الشخص خربط ف بطر انو يعدل بدل ما يحذفها من السجل
 * كامللل». The owner's reversal of his own earlier bar, and the geometry
 * decides its shape: the bay's parity IS the class, so a class written wrong
 * is an ADDRESS written wrong. It is corrected by naming the bay the box
 * truly stands on, and the class follows — never typed, exactly as at the
 * gate.
 *
 * Nothing moves. Same zone, same stack, same tier, bay by one. No MOVE, no
 * move card, no serial disturbed. What is standing ON it refuses the whole
 * correction, by the owner's own choice: «يرفض الآن».
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

const at = (bay: number, stack = 1, tier = 'A', zone = 'B'): Position =>
  ({ zone, bay, stack, tier }) as Position;

const gateIn = async (
  number: string,
  position: Position,
  size: 20 | 40 = 20,
): Promise<number> => {
  const reply = await call({
    method: 'POST',
    url: '/api/containers',
    payload: {
      number,
      size,
      bill: '7100',
      notes: '',
      position,
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

const detail = async (
  id: number,
): Promise<{ container: ContainerDto; movements: MovementDto[] }> =>
  (await call({ method: 'GET', url: `/api/containers/${String(id)}` })).body as unknown as {
    container: ContainerDto;
    movements: MovementDto[];
  };

const reclass = async (
  id: number,
  to?: Position,
): Promise<{ status: number; body: Record<string, unknown> }> =>
  call({
    method: 'POST',
    url: `/api/containers/${String(id)}/reclass`,
    payload: to === undefined ? {} : { to },
  });

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

describe('تصحيح فئة الحاوية', () => {
  it('a twenty corrected to a forty takes the bay it truly stands on', async () => {
    const id = await gateIn('RECL0011', at(3));
    const before = await detail(id);
    expect(before.container.size).toBe(20);

    const ok = await reclass(id, at(2));
    expect(ok.status).toBe(200);

    const after = await detail(id);
    expect(after.container.size).toBe(40);
    expect(after.container.position?.bay).toBe(2);
    expect(after.container.position?.zone).toBe('B');
    expect(after.container.position?.stack).toBe(1);
    expect(after.container.position?.tier).toBe('A');

    // The movement that says where it IS became true; no second journey.
    const entry = after.movements.find((m) => m.type === 'IN');
    expect(entry?.to?.bay).toBe(2);
    expect(after.movements.filter((m) => m.type === 'MOVE')).toHaveLength(0);
    expect(after.movements.filter((m) => m.type === 'DROP')).toHaveLength(0);

    // Exactly one EDIT, carrying no position of its own — an EDIT with a
    // `to` would become the container's "latest placement" and break the
    // next «تصحيح النقلة».
    const edits = after.movements.filter((m) => m.type === 'EDIT');
    expect(edits).toHaveLength(1);
    expect(edits[0]?.from).toBeNull();
    expect(edits[0]?.to).toBeNull();
  });

  /**
   * The gap the whole suite had: every fill/free test builds its containers
   * by hand and would stay green over a database where a 40 sits at an odd
   * bay. This asks the SERVER whether the ground moved — the only check that
   * catches a class written without an address.
   */
  it('the corrected forty really covers both odd bays now', async () => {
    const id = await gateIn('RECL0027', at(3));
    expect((await reclass(id, at(2))).status).toBe(200);

    // Bay 01 was free before; the corrected 40 lies across it now.
    const blocked = await call({
      method: 'POST',
      url: '/api/containers',
      payload: {
        number: 'RECL0032',
        size: 20,
        bill: '7100',
        notes: '',
        position: at(1),
        truck: '60-11111',
        seal: 'JO500',
        driver: '',
        weight: '',
        handling: 'CRANE',
      },
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body['code']).toBe('OCCUPIED');
    expect((blocked.body['details'] as Record<string, unknown>)['other']).toBe('RECL0027');

    // And narrowing it back frees bay 01 again.
    expect((await reclass(id, at(3))).status).toBe(200);
    expect((await detail(id)).container.size).toBe(20);
    const freed = await gateIn('RECL0046', at(1));
    expect(freed).toBeGreaterThan(0);
  });

  it('refuses while anything rests on it, and writes nothing at all', async () => {
    const floor = await gateIn('RECL0059', at(3));
    const roof = await gateIn('RECL0063', { ...at(3), tier: 'B' } as Position);

    const refused = await reclass(floor, at(2));
    expect(refused.status).toBe(409);
    expect(refused.body['code']).toBe('RECLASS_BURIED');
    expect((refused.body['details'] as Record<string, unknown>)['other']).toBe('RECL0063');

    const after = await detail(floor);
    expect(after.container.size).toBe(20);
    expect(after.container.position?.bay).toBe(3);
    expect(after.movements.filter((m) => m.type === 'EDIT')).toHaveLength(0);
    expect(after.movements.filter((m) => m.type === 'DROP')).toHaveLength(0);
    expect((await detail(roof)).container.position?.tier).toBe('B');
  });

  it('refuses when the partner bay belongs to somebody else, and names them', async () => {
    const mine = await gateIn('RECL0074', at(3));
    await gateIn('RECL0088', at(1));
    const refused = await reclass(mine, at(2));
    expect(refused.status).toBe(409);
    expect(refused.body['code']).toBe('OCCUPIED');
    expect((refused.body['details'] as Record<string, unknown>)['other']).toBe('RECL0088');
    expect((await detail(mine)).container.size).toBe(20);
  });

  it('refuses a bay that is not the one next door', async () => {
    const id = await gateIn('RECL0091', at(3));
    for (const bad of [at(6), at(3, 2), { ...at(2), tier: 'B' } as Position]) {
      const refused = await reclass(id, bad);
      expect(refused.status).toBe(409);
      expect(refused.body['code']).toBe('NOT_ADJACENT_BAY');
    }
    expect((await detail(id)).container.size).toBe(20);
  });

  it('the correction form still refuses to carry a class, standing or departed', async () => {
    const id = await gateIn('RECL0102', at(3));
    const c = (await detail(id)).container;
    const body = {
      number: c.number,
      bill: c.bill,
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
    };
    const standing = await call({
      method: 'PATCH',
      url: `/api/containers/${String(id)}`,
      payload: { ...body, size: 40 },
    });
    expect(standing.status).toBe(409);
    expect(standing.body['code']).toBe('SIZE_LOCKED');

    await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/exit`,
      payload: { truck: '60-22222', driver: 'أبو علي' },
    });
    const gone = (await detail(id)).container;
    const departed = await call({
      method: 'PATCH',
      url: `/api/containers/${String(id)}`,
      payload: {
        ...body,
        size: 40,
        truckOut: gone.truckOut,
        driverOut: gone.driverOut,
        exitedAt: gone.exitedAt,
      },
    });
    expect(departed.status).toBe(409);
    expect(departed.body['code']).toBe('SIZE_LOCKED');
  });

  /**
   * The regression that makes the departed branch worth writing: without
   * moving the slot the OUT movement remembers, «إلغاء الخروج» reads back an
   * odd bay for a 40 and refuses for ever.
   */
  it('a departed record corrected by class can still have its exit taken back', async () => {
    const id = await gateIn('RECL0115', at(3));
    await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/exit`,
      payload: { truck: '60-22222', driver: 'أبو علي' },
    });
    // The card alone leaves it standing, awaiting its truck — departed means
    // loaded too.
    expect((await detail(id)).container.position).toEqual(at(3));
    await call({ method: 'POST', url: `/api/containers/${String(id)}/loaded`, payload: {} });
    expect((await detail(id)).container.position).toBeNull();

    expect((await reclass(id, at(2))).status).toBe(200);
    expect((await detail(id)).container.size).toBe(40);

    const back = await call({ method: 'POST', url: `/api/containers/${String(id)}/unexit` });
    expect(back.status).toBe(200);
    const after = await detail(id);
    expect(after.container.size).toBe(40);
    expect(after.container.position?.bay).toBe(2);
  });

  it('no card serial and no gate instant moves', async () => {
    const id = await gateIn('RECL0129', at(3));
    const before = (await detail(id)).container;
    const entryBefore = (await detail(id)).movements.find((m) => m.type === 'IN')?.at;

    expect((await reclass(id, at(2))).status).toBe(200);

    const after = await detail(id);
    expect(after.container.cardIn).toBe(before.cardIn);
    expect(after.container.cardInYear).toBe(before.cardInYear);
    expect(after.container.enteredAt).toBe(before.enteredAt);
    expect(after.movements.find((m) => m.type === 'IN')?.at).toBe(entryBefore);
  });

  it('a clerk without both permissions cannot reach it', async () => {
    const id = await gateIn('RECL0132', at(3));
    await call({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'ناقل', pin: '4321', permissions: ['MOVE'] },
    });
    const staff = (await call({ method: 'GET', url: '/api/users' })).body as unknown as {
      users: Array<{ id: number; name: string }>;
    };
    const mover = staff.users.find((user) => user.name === 'ناقل');
    await call({ method: 'POST', url: '/api/logout' });
    cookie = '';
    await call({ method: 'POST', url: '/api/login', payload: { userId: mover?.id, pin: '4321' } });
    const refused = await reclass(id, at(2));
    expect(refused.status).toBe(403);
  });
});

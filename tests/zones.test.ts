import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type { CustomZoneDto, Position } from '../src/shared/types';
import { composeLayout, yardSlice, yardsOf, zoneDefOf } from '../src/shared/layout';
import { positionLabel, yardOf } from '../src/shared/address';
import { slotUsable } from '../src/shared/rules';

/**
 * الزونات التي يعرّفها المالك: his own yards beside the official plan, which
 * stays committed data. A defined zone is ground like any other — addresses
 * read `1-F-07-09-A`, placement refuses a closed slot the way the plan's
 * walls refuse theirs, three tiers always — and no edit may pull the ground
 * out from under a standing container.
 */

let db: DatabaseSync;
let app: FastifyInstance;
let cookie = '';

interface ReplyBody {
  id: number;
  code: string;
  yard: number;
  zones: CustomZoneDto[];
  serial: number;
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

const addZone = async (
  input: { yard: number; name: string; bays: number; stacks: number },
): Promise<Reply> => call({ method: 'POST', url: '/api/zones', payload: input });

const gateIn = async (number: string, position: Position, bill = '3210'): Promise<Reply> =>
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
      driver: '',
      weight: '',
      handling: 'CRANE',
    },
  });

describe('تعريف الزون', () => {
  it('the owner defines a zone; a twin letter anywhere is refused by name', async () => {
    const added = await addZone({ yard: 1, name: 'F', bays: 10, stacks: 6 });
    expect(added.status).toBe(201);
    // The official plan's letters are spoken for …
    const official = await addZone({ yard: 3, name: 'B', bays: 4, stacks: 4 });
    expect(official.status).toBe(409);
    expect(official.body.code).toBe('NAME_TAKEN');
    // … and so is a letter another yard already carries.
    const twin = await addZone({ yard: 3, name: 'F', bays: 4, stacks: 4 });
    expect(twin.status).toBe(409);

    const listed = await call({ method: 'GET', url: '/api/zones' });
    expect(listed.status).toBe(200);
    expect(listed.body.zones).toHaveLength(1);
    expect(listed.body.zones[0]?.zone).toBe('F');
    expect(listed.body.zones[0]?.yard).toBe(1);
  });

  it('shaping the ground is the owner’s alone; reading needs only a session', async () => {
    await call({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'موظف', pin: '4321', permissions: ['GATE_IN', 'REPORTS'] },
    });
    const staff = (await call({ method: 'GET', url: '/api/users' })).body as unknown as {
      users: Array<{ id: number }>;
    };
    await call({ method: 'POST', url: '/api/logout' });
    cookie = '';
    expect((await call({ method: 'GET', url: '/api/zones' })).status).toBe(401);
    await call({
      method: 'POST',
      url: '/api/login',
      payload: { userId: staff.users[0]?.id, pin: '4321' },
    });
    expect((await call({ method: 'GET', url: '/api/zones' })).status).toBe(200);
    const denied = await addZone({ yard: 1, name: 'F', bays: 4, stacks: 4 });
    expect(denied.status).toBe(403);
  });
});

describe('الأرض المعرّفة أرض حقيقية', () => {
  it('takes a container at 1-F-07-09-A, and the address writes yard 1', async () => {
    await addZone({ yard: 1, name: 'F', bays: 10, stacks: 9 });
    const entered = await gateIn('ZONE0017', { zone: 'F', bay: 7, stack: 9, tier: 'A' });
    expect(entered.status).toBe(201);
    expect(positionLabel({ zone: 'F', bay: 7, stack: 9, tier: 'A' })).toBe('1-F-07-09-A');
    // Off the grid is off the grid: bay 21 does not exist on a 10-bay zone.
    const off = await gateIn('ZONE0022', { zone: 'F', bay: 21, stack: 1, tier: 'A' });
    expect(off.status).toBe(409);
    expect(off.body.code).toBe('BAD_SLOT');
  });

  it('a closed slot refuses placement exactly as the plan’s walls do', async () => {
    const zone = await addZone({ yard: 1, name: 'F', bays: 4, stacks: 4 });
    const shaped = await call({
      method: 'PATCH',
      url: `/api/zones/${String(zone.body.id)}`,
      payload: { bays: 4, stacks: 4, closed: [[3, 2]] },
    });
    expect(shaped.status).toBe(200);
    const refused = await gateIn('ZONE0038', { zone: 'F', bay: 3, stack: 2, tier: 'A' });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('BAD_SLOT');
    // The slot beside it is open ground.
    expect((await gateIn('ZONE0043', { zone: 'F', bay: 3, stack: 3, tier: 'A' })).status).toBe(201);
  });

  it('no edit or delete pulls the ground from under a standing container', async () => {
    const zone = await addZone({ yard: 1, name: 'F', bays: 4, stacks: 4 });
    const entered = await gateIn('ZONE0059', { zone: 'F', bay: 3, stack: 2, tier: 'A' });
    expect(entered.status).toBe(201);

    const closing = await call({
      method: 'PATCH',
      url: `/api/zones/${String(zone.body.id)}`,
      payload: { bays: 4, stacks: 4, closed: [[3, 2]] },
    });
    expect(closing.status).toBe(409);
    expect(closing.body.code).toBe('ZONE_HAS_CONTAINERS');
    const shrinking = await call({
      method: 'PATCH',
      url: `/api/zones/${String(zone.body.id)}`,
      payload: { bays: 1, stacks: 1, closed: [] },
    });
    expect(shrinking.status).toBe(409);
    const removing = await call({ method: 'DELETE', url: `/api/zones/${String(zone.body.id)}` });
    expect(removing.status).toBe(409);

    // The container leaves; the zone can be reshaped and struck out.
    await call({
      method: 'POST',
      url: `/api/containers/${String(entered.body.id)}/exit`,
      payload: { truck: '500', driver: '' },
    });
    expect(
      (await call({ method: 'DELETE', url: `/api/zones/${String(zone.body.id)}` })).status,
    ).toBe(200);
    expect((await call({ method: 'GET', url: '/api/zones' })).body.zones).toHaveLength(0);
  });

  it('a permit for boxes standing in an owner yard names that yard on the paper', async () => {
    await addZone({ yard: 3, name: 'G', bays: 4, stacks: 4 });
    const entered = await gateIn('ZONE0064', { zone: 'G', bay: 1, stack: 1, tier: 'A' }, '4411');
    const permit = await call({
      method: 'POST',
      url: '/api/permits',
      payload: { bill: '4411', items: [{ containerId: entered.body.id, truck: '' }] },
    });
    expect(permit.status).toBe(201);
    expect(permit.body.yard).toBe(3);
  });
});

describe('تركيب الشكل الفعّال', () => {
  const custom: CustomZoneDto = {
    id: 1,
    yard: 1,
    zone: 'F',
    bays: 3,
    stacks: 4,
    closed: [[3, 2]],
    x: null,
    y: null,
  };

  it('a defined zone reads like the plan’s own: odd bays, stacks minus the closed', () => {
    const def = zoneDefOf(custom, 0, 0);
    expect(def.bays).toEqual([1, 3, 5]);
    expect(def.stacks['1']).toEqual([1, 2, 3, 4]);
    expect(def.stacks['3']).toEqual([1, 3, 4]);
    const trial = { zones: [def], landmarks: [] };
    expect(slotUsable(trial, 'F', 3, 2)).toBe(false);
    expect(slotUsable(trial, 'F', 3, 3)).toBe(true);
  });

  it('composing teaches every address its yard, and slices one yard’s drawing', () => {
    const layout = composeLayout([custom]);
    expect(yardOf('F')).toBe(1);
    expect(yardOf('A')).toBe(2);
    expect(yardsOf(layout)).toEqual([1, 2]);
    const slice = yardSlice(layout, 1);
    expect(slice.zones.map((zone) => zone.zone)).toEqual(['F']);
    expect(slice.landmarks).toHaveLength(0);
    // The plan's own slice keeps its landmarks and every official zone.
    expect(yardSlice(layout, 2).zones).toHaveLength(5);
    expect(yardSlice(layout, 2).landmarks.length).toBeGreaterThan(0);
  });
});

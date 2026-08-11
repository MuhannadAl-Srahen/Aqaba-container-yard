import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type { Position, Tier, Zone } from '../src/shared/types';

/**
 * The whole API driven through Fastify's own request simulator against an
 * in-memory database — same routing, validation and transaction path as
 * production, no port to bind. The yard is the real ASEZA layout: zone B
 * (bays 01–45, stacks 01–10 everywhere) is the workhorse; zone A's clipped
 * first bays stand in for the walls.
 */

let app: FastifyInstance;
let cookie: string;

async function setup(): Promise<void> {
  const db = openDatabase(':memory:');
  app = buildApp(db);
  await app.ready();

  const response = await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { password: 'yard-secret' },
  });
  if (response.statusCode !== 200) throw new Error(`setup failed: ${response.body}`);
  const setCookie = response.headers['set-cookie'];
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (header === undefined) throw new Error('no session cookie');
  cookie = header.split(';')[0] ?? '';
}

const slot = (zone: Zone, bay: number, stack: number, tier: Tier): Position => ({
  zone,
  bay,
  stack,
  tier,
});

interface InjectOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  url: string;
  payload?: unknown;
  noAuth?: boolean;
}

async function call(options: InjectOptions): Promise<{ status: number; body: unknown }> {
  const response = await app.inject({
    method: options.method,
    url: options.url,
    ...(options.payload === undefined ? {} : { payload: options.payload as object }),
    headers: options.noAuth === true ? {} : { cookie },
  });
  return {
    status: response.statusCode,
    body: response.body === '' ? null : (JSON.parse(response.body) as unknown),
  };
}

async function gateIn(
  number: string,
  size: 20 | 40,
  position: Position,
  customer = 'شركة النقل الأردنية',
): Promise<{
  status: number;
  body: { id?: number; position?: Position; code?: string; cardIn?: number; sealIn?: string };
}> {
  const result = await call({
    method: 'POST',
    url: '/api/containers',
    payload: {
      number,
      size,
      customer,
      notes: '',
      position,
      truck: '500',
      seal: 'JO100001',
      driver: 'أبو أحمد',
      weight: '25',
    },
  });
  return result as {
    status: number;
    body: { id?: number; position?: Position; code?: string; cardIn?: number; sealIn?: string };
  };
}

/**
 * PATCH sends the whole record — every entered value is correctable now — so
 * a test states only what it is changing and the rest rides back unchanged.
 */
async function editWith(
  id: number | undefined,
  overrides: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const card = await call({ method: 'GET', url: `/api/containers/${String(id)}` });
  const now = (card.body as { container: Record<string, unknown> }).container;
  const keep = [
    'number', 'customer', 'bill', 'size', 'notes', 'weight', 'weightNet', 'hazmat',
    'truckIn', 'driverIn', 'sealIn', 'truckOut', 'driverOut', 'sealOut',
    'enteredAt', 'exitedAt',
  ];
  const payload: Record<string, unknown> = {};
  for (const key of keep) payload[key] = now[key];
  return call({
    method: 'PATCH',
    url: `/api/containers/${String(id)}`,
    payload: { ...payload, ...overrides },
  });
}

async function gateOut(id: number | undefined): Promise<{ status: number; body: unknown }> {
  return call({
    method: 'POST',
    url: `/api/containers/${String(id)}/exit`,
    payload: { truck: '522', seal: 'JO100001', driver: '' },
  });
}

/** Yesterday to tomorrow — a range every movement of a test lands inside. */
const wideRange = (): { from: string; to: string } => ({
  from: new Date(Date.now() - 86_400_000).toISOString(),
  to: new Date(Date.now() + 86_400_000).toISOString(),
});

beforeEach(setup);

describe('auth', () => {
  it('refuses every operational route without a session', async () => {
    const routes: Array<[InjectOptions['method'], string]> = [
      ['GET', '/api/state'],
      ['POST', '/api/containers'],
      ['POST', '/api/containers/1/move'],
      ['POST', '/api/containers/1/exit'],
      ['GET', '/api/reports/gate?type=IN'],
      ['GET', '/api/containers?q=x'],
    ];
    for (const [method, url] of routes) {
      const result = await call({ method, url, noAuth: true, payload: {} });
      expect(result.status, url).toBe(401);
    }
  });

  it('setup cannot run twice', async () => {
    const again = await call({
      method: 'POST',
      url: '/api/setup',
      payload: { password: 'another-pass' },
      noAuth: true,
    });
    expect(again.status).toBe(409);
    expect((again.body as { code: string }).code).toBe('ALREADY_SETUP');
  });

  it('login with the right password issues a working session', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { password: 'yard-secret' },
    });
    expect(login.statusCode).toBe(200);
    const header = login.headers['set-cookie'];
    expect(header).toBeDefined();
  });

  it('login with a wrong password is refused', async () => {
    const login = await call({
      method: 'POST',
      url: '/api/login',
      payload: { password: 'nope-nope' },
      noAuth: true,
    });
    expect(login.status).toBe(401);
  });
});

describe('the compiled-in yard', () => {
  it('state carries containers only — the layout ships with the app', async () => {
    const state = await call({ method: 'GET', url: '/api/state' });
    expect(state.status).toBe(200);
    const body = state.body as { containers: unknown[]; customers: unknown[]; yard?: unknown };
    expect(body.containers).toEqual([]);
    expect(body.yard).toBeUndefined();
  });

  it('has no yard editor and no wipe routes at all', async () => {
    for (const [method, url] of [
      ['PUT', '/api/yard'],
      ['POST', '/api/dev/reset'],
      ['POST', '/api/dev/seed'],
    ] as const) {
      const gone = await call({ method, url, payload: {} });
      expect(gone.status, url).toBe(404);
    }
  });
});

describe('gate in — the official grid decides', () => {
  it('receives a 20 on an odd bay and reports the full slot back', async () => {
    const result = await gateIn('MSCU1234566', 20, slot('B', 3, 1, 'A'));
    expect(result.status).toBe(201);
    expect(result.body.position).toEqual({ zone: 'B', bay: 3, stack: 1, tier: 'A' });

    const state = await call({ method: 'GET', url: '/api/state' });
    expect((state.body as { containers: unknown[] }).containers).toHaveLength(1);
  });

  it('an invalid number is received with a warning, never refused', async () => {
    const result = await gateIn('XXXX999', 20, slot('B', 1, 1, 'A'));
    expect(result.status).toBe(201);
    expect((result.body as { numberValid: boolean }).numberValid).toBe(false);
  });

  it('the bay’s parity IS the size: a 20 on even or a 40 on odd is refused', async () => {
    const twenty = await gateIn('TWNT0001', 20, slot('B', 2, 1, 'A'));
    expect(twenty.status).toBe(409);
    expect(twenty.body.code).toBe('BAD_SLOT');
    const forty = await gateIn('FORT0001', 40, slot('B', 3, 1, 'A'));
    expect(forty.status).toBe(409);
    expect(forty.body.code).toBe('BAD_SLOT');
  });

  it('refuses the wall: zone A bay 01 has no stacks 1–2 on the plan', async () => {
    const walled = await gateIn('WALL0001', 20, slot('A', 1, 1, 'A'));
    expect(walled.status).toBe(409);
    expect(walled.body.code).toBe('BAD_SLOT');
    const fine = await gateIn('WALL0002', 20, slot('A', 1, 3, 'A'));
    expect(fine.status).toBe(201);
  });

  it('one cell, one container — and a spanning 40 blocks both bays', async () => {
    await gateIn('BASE0001', 20, slot('B', 1, 1, 'A'));
    const same = await gateIn('BASE0002', 20, slot('B', 1, 1, 'A'));
    expect(same.status).toBe(409);
    expect(same.body.code).toBe('OCCUPIED');

    // A 40 at bay 02 lies across bays 01 and 03 — bay 01 stack 1 is taken.
    const across = await gateIn('FORT0002', 40, slot('B', 2, 1, 'A'));
    expect(across.status).toBe(409);
    expect(across.body.code).toBe('OCCUPIED');

    // On stack 2 the pair is free; then its ground blocks BOTH odd bays.
    const landed = await gateIn('FORT0003', 40, slot('B', 2, 2, 'A'));
    expect(landed.status).toBe(201);
    const left = await gateIn('BASE0003', 20, slot('B', 1, 2, 'A'));
    expect(left.body.code).toBe('OCCUPIED');
    const right = await gateIn('BASE0004', 20, slot('B', 3, 2, 'A'));
    expect(right.body.code).toBe('OCCUPIED');
  });

  it('tier B needs its floor: a 20 on a 20, a 40 on two 20s or a 40', async () => {
    const floating = await gateIn('FLOA0001', 20, slot('B', 5, 1, 'B'));
    expect(floating.status).toBe(409);
    expect(floating.body.code).toBe('NO_SUPPORT');

    await gateIn('BASE0005', 20, slot('B', 5, 1, 'A'));
    const stacked = await gateIn('TOPP0001', 20, slot('B', 5, 1, 'B'));
    expect(stacked.status).toBe(201);

    // A 40's roof takes no 20 — no corner castings in the middle.
    await gateIn('FORT0004', 40, slot('B', 8, 1, 'A'));
    const onForty = await gateIn('TOPP0002', 20, slot('B', 7, 1, 'B'));
    expect(onForty.body.code).toBe('NO_SUPPORT');
    const fortyOnForty = await gateIn('FORT0005', 40, slot('B', 8, 1, 'B'));
    expect(fortyOnForty.status).toBe(201);
  });

  it('the seal is mandatory at the gate, both ways', async () => {
    const noSeal = await call({
      method: 'POST',
      url: '/api/containers',
      payload: {
        number: 'SEAL0001',
        size: 20,
        customer: 'شركة',
        notes: '',
        position: slot('B', 9, 1, 'A'),
        truck: '55',
        seal: '',
        driver: '',
        weight: '',
      },
    });
    expect(noSeal.status).toBe(400);

    const entered = await gateIn('SEAL0002', 20, slot('B', 9, 1, 'A'));
    const exitNoSeal = await call({
      method: 'POST',
      url: `/api/containers/${String(entered.body.id)}/exit`,
      payload: { truck: '66', seal: '', driver: '' },
    });
    expect(exitNoSeal.status).toBe(400);
  });

  it('refuses a number already standing in the yard, allows it after it left', async () => {
    const first = await gateIn('MSCU1234566', 20, slot('B', 11, 1, 'A'));
    const dupe = await gateIn('MSCU1234566', 20, slot('B', 11, 2, 'A'));
    expect(dupe.status).toBe(409);
    expect(dupe.body.code).toBe('NUMBER_IN_YARD');

    await gateOut(first.body.id);
    const back = await gateIn('MSCU1234566', 20, slot('B', 11, 3, 'A'));
    expect(back.status).toBe(201);
  });
});

describe('move', () => {
  it('moves a container and records the movement with both slots', async () => {
    const entered = await gateIn('MOVE0001', 20, slot('B', 1, 1, 'A'));
    const moved = await call({
      method: 'POST',
      url: `/api/containers/${String(entered.body.id)}/move`,
      payload: { to: slot('B', 15, 4, 'A') },
    });
    expect(moved.status).toBe(200);
    expect((moved.body as { position: Position }).position).toEqual(slot('B', 15, 4, 'A'));

    const detail = await call({
      method: 'GET',
      url: `/api/containers/${String(entered.body.id)}`,
    });
    const movements = (detail.body as { movements: Array<{ type: string; from: unknown; to: unknown }> })
      .movements;
    expect(movements.map((m) => m.type)).toEqual(['IN', 'MOVE']);
    expect(movements[1]?.from).toEqual(slot('B', 1, 1, 'A'));
    expect(movements[1]?.to).toEqual(slot('B', 15, 4, 'A'));
  });

  it('the same slot is its own refusal', async () => {
    const entered = await gateIn('MOVE0002', 20, slot('B', 1, 1, 'A'));
    const same = await call({
      method: 'POST',
      url: `/api/containers/${String(entered.body.id)}/move`,
      payload: { to: slot('B', 1, 1, 'A') },
    });
    expect(same.status).toBe(409);
    expect((same.body as { code: string }).code).toBe('SAME_SLOT');
  });

  it('moving out from under a stack brings it down a tier, on the record', async () => {
    const below = await gateIn('BURY0001', 20, slot('B', 1, 1, 'A'));
    const above = await gateIn('BURY0002', 20, slot('B', 1, 1, 'B'));

    const moved = await call({
      method: 'POST',
      url: `/api/containers/${String(below.body.id)}/move`,
      payload: { to: slot('B', 3, 1, 'A') },
    });
    expect(moved.status).toBe(200);

    // The one that was on top is now standing on the ground it vacated.
    const settled = await call({ method: 'GET', url: `/api/containers/${String(above.body.id)}` });
    expect((settled.body as { container: { position: Position } }).container.position).toEqual(
      slot('B', 1, 1, 'A'),
    );

    // And gravity signed its own name in the history, not the employee's.
    const history = (settled.body as { movements: Array<{ type: string; note: string }> }).movements;
    const drop = history.find((movement) => movement.type === 'DROP');
    expect(drop?.note).toBe('BURY0001');
  });

  it('a 40 bridging two 20s must be relocated before either leg moves', async () => {
    const left = await gateIn('LEGS0001', 20, slot('B', 1, 1, 'A'));
    await gateIn('LEGS0002', 20, slot('B', 3, 1, 'A'));
    await gateIn('LEGS0040', 40, slot('B', 2, 1, 'B'));

    const stuck = await call({
      method: 'POST',
      url: `/api/containers/${String(left.body.id)}/move`,
      payload: { to: slot('B', 5, 5, 'A') },
    });
    expect(stuck.status).toBe(409);
    expect((stuck.body as { code: string }).code).toBe('BLOCKED_DESCENT');
    // The refusal names the box to shift, not the one blocking underneath.
    expect((stuck.body as { details?: { other?: string } }).details?.other).toBe('LEGS0040');
  });

  it('a move onto thin air is refused like any landing', async () => {
    const entered = await gateIn('MOVE0003', 20, slot('B', 1, 1, 'A'));
    const floating = await call({
      method: 'POST',
      url: `/api/containers/${String(entered.body.id)}/move`,
      payload: { to: slot('B', 3, 1, 'B') },
    });
    expect(floating.status).toBe(409);
    expect((floating.body as { code: string }).code).toBe('NO_SUPPORT');
  });
});

describe('gate out', () => {
  it('frees its slot and keeps the record findable', async () => {
    const entered = await gateIn('EXIT0001', 20, slot('B', 1, 1, 'A'));
    const exited = await gateOut(entered.body.id);
    expect(exited.status).toBe(200);
    expect((exited.body as { position: Position | null }).position).toBeNull();

    // The slot is free again.
    const replacement = await gateIn('EXIT0002', 20, slot('B', 1, 1, 'A'));
    expect(replacement.status).toBe(201);

    const search = await call({ method: 'GET', url: '/api/containers?q=EXIT0001' });
    expect((search.body as { results: unknown[] }).results).toHaveLength(1);
  });

  it('a whole stack settles when the bottom one leaves', async () => {
    const ground = await gateIn('EXIT0003', 20, slot('B', 1, 1, 'A'));
    const middle = await gateIn('EXIT0004', 20, slot('B', 1, 1, 'B'));
    const top = await gateIn('EXIT0005', 20, slot('B', 1, 1, 'C'));

    expect((await gateOut(ground.body.id)).status).toBe(200);

    const where = async (id: number | undefined): Promise<Position | null> => {
      const card = await call({ method: 'GET', url: `/api/containers/${String(id)}` });
      return (card.body as { container: { position: Position | null } }).container.position;
    };
    expect(await where(middle.body.id)).toEqual(slot('B', 1, 1, 'A'));
    expect(await where(top.body.id)).toEqual(slot('B', 1, 1, 'B'));
  });

  it('deleting a record settles the stack too, instead of stranding it', async () => {
    const ground = await gateIn('EXIT0006', 20, slot('B', 5, 1, 'A'));
    const above = await gateIn('EXIT0007', 20, slot('B', 5, 1, 'B'));

    const struck = await call({
      method: 'DELETE',
      url: `/api/containers/${String(ground.body.id)}`,
    });
    expect(struck.status).toBe(200);

    const card = await call({ method: 'GET', url: `/api/containers/${String(above.body.id)}` });
    expect((card.body as { container: { position: Position } }).container.position).toEqual(
      slot('B', 5, 1, 'A'),
    );
  });

  it('gating out twice is refused', async () => {
    const entered = await gateIn('EXIT0005', 20, slot('B', 1, 1, 'A'));
    await gateOut(entered.body.id);
    const again = await gateOut(entered.body.id);
    expect(again.status).toBe(409);
    expect((again.body as { code: string }).code).toBe('ALREADY_OUT');
  });
});

describe('edit and delete', () => {
  it('edits fields and logs which ones changed', async () => {
    const entered = await gateIn('EDIT0001', 20, slot('B', 1, 1, 'A'));
    const edited = await editWith(entered.body.id, {
      customer: 'شركة الساحل',
      notes: 'باب مبعوج',
    });
    expect(edited.status).toBe(200);
    expect((edited.body as { customer: string }).customer).toBe('شركة الساحل');

    const detail = await call({
      method: 'GET',
      url: `/api/containers/${String(entered.body.id)}`,
    });
    const types = (detail.body as { movements: Array<{ type: string }> }).movements.map(
      (m) => m.type,
    );
    expect(types).toContain('EDIT');
  });

  it('corrects every entered field, not just some of them', async () => {
    const entered = await gateIn('EDIT0010', 20, slot('B', 1, 1, 'A'));
    const fixed = await editWith(entered.body.id, {
      weight: '31000',
      weightNet: '25000',
      hazmat: true,
      truckIn: '777',
      driverIn: 'أبو خالد',
      sealIn: 'JO999',
    });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({
      weight: '31000',
      weightNet: '25000',
      hazmat: true,
      truckIn: '777',
      driverIn: 'أبو خالد',
      sealIn: 'JO999',
    });

    // Every corrected field is named in the log, and its old value kept so
    // the change can be undone.
    const card = await call({ method: 'GET', url: `/api/containers/${String(entered.body.id)}` });
    const edit = (card.body as { movements: Array<{ type: string; note: string }> }).movements.find(
      (movement) => movement.type === 'EDIT',
    );
    const note = JSON.parse(edit?.note ?? '{}') as { k: string[]; b: Record<string, unknown> };
    expect(note.k).toEqual(
      expect.arrayContaining(['weight', 'weightNet', 'hazmat', 'truckIn', 'driverIn', 'sealIn']),
    );
    expect(note.b['sealIn']).toBe('JO100001');
  });

  it('a corrected entry date moves the gate movement with it', async () => {
    const entered = await gateIn('EDIT0011', 20, slot('B', 3, 1, 'A'));
    // Recorded today by mistake; it actually arrived five days ago.
    const real = new Date(Date.now() - 5 * 86_400_000).toISOString();
    expect((await editWith(entered.body.id, { enteredAt: real })).status).toBe(200);

    // The card says five days ago...
    const card = await call({ method: 'GET', url: `/api/containers/${String(entered.body.id)}` });
    expect((card.body as { container: { enteredAt: string } }).container.enteredAt).toBe(real);

    // ...and so does the register, which reads the MOVEMENT's own timestamp.
    // Without re-timing, the two would place the box in different weeks.
    const inMovement = (
      card.body as { movements: Array<{ type: string; at: string }> }
    ).movements.find((movement) => movement.type === 'IN');
    expect(inMovement?.at).toBe(real);

    const window = {
      from: new Date(Date.now() - 6 * 86_400_000).toISOString(),
      to: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    };
    const register = await call({
      method: 'GET',
      url: `/api/reports/gate?type=IN&from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`,
    });
    const numbers = (register.body as { rows: Array<{ number: string }> }).rows.map(
      (row) => row.number,
    );
    expect(numbers).toContain('EDIT0011');
  });

  it('refuses impossible dates and exit paperwork on a standing container', async () => {
    const entered = await gateIn('EDIT0012', 20, slot('B', 5, 1, 'A'));

    const future = await editWith(entered.body.id, {
      enteredAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(future.status).toBe(409);

    // It has not left, so it has no exit paperwork to correct.
    const phantom = await editWith(entered.body.id, { truckOut: '900' });
    expect(phantom.status).toBe(409);

    await gateOut(entered.body.id);
    const backwards = await editWith(entered.body.id, {
      exitedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    });
    expect(backwards.status).toBe(409);
  });

  it('a size flip is refused while standing — the bay’s parity is the size', async () => {
    const entered = await gateIn('EDIT0002', 20, slot('B', 1, 1, 'A'));
    const flipped = await editWith(entered.body.id, { size: 40 });
    expect(flipped.status).toBe(409);
    expect((flipped.body as { code: string }).code).toBe('BAD_SLOT');

    // Once it leaves, the paperwork can be fixed.
    await gateOut(entered.body.id);
    const fixed = await editWith(entered.body.id, { size: 40 });
    expect(fixed.status).toBe(200);
  });

  it('renaming onto a number standing elsewhere is refused', async () => {
    await gateIn('NAME0001', 20, slot('B', 1, 1, 'A'));
    const other = await gateIn('NAME0002', 20, slot('B', 3, 1, 'A'));
    const renamed = await call({
      method: 'PATCH',
      url: `/api/containers/${String(other.body.id)}`,
      payload: {
        number: 'NAME0001',
        customer: 'شركة',
        size: 20,
        notes: '',
        enteredAt: new Date().toISOString(),
      },
    });
    expect(renamed.status).toBe(409);
    expect((renamed.body as { code: string }).code).toBe('NUMBER_IN_YARD');
  });

  it('a deleted record gives its slot back and can be restored to it', async () => {
    const entered = await gateIn('DELE0001', 20, slot('B', 1, 1, 'A'));
    const removed = await call({
      method: 'DELETE',
      url: `/api/containers/${String(entered.body.id)}`,
    });
    expect(removed.status).toBe(200);

    // The ground is free while it is deleted…
    const squatter = await gateIn('DELE0002', 20, slot('B', 1, 1, 'A'));
    expect(squatter.status).toBe(201);

    // …so the restore is refused until the squatter leaves.
    const blocked = await call({
      method: 'POST',
      url: `/api/containers/${String(entered.body.id)}/restore`,
      payload: {},
    });
    expect(blocked.status).toBe(409);
    expect((blocked.body as { code: string }).code).toBe('OCCUPIED');

    await gateOut(squatter.body.id);
    const restored = await call({
      method: 'POST',
      url: `/api/containers/${String(entered.body.id)}/restore`,
      payload: {},
    });
    expect(restored.status).toBe(200);
    expect((restored.body as { position: Position }).position).toEqual(slot('B', 1, 1, 'A'));
  });
});

describe('gate paperwork', () => {
  it('a truckless gate-in is refused — the truck is mandatory', async () => {
    const result = await call({
      method: 'POST',
      url: '/api/containers',
      payload: {
        number: 'PAPR0001',
        size: 20,
        customer: 'شركة',
        notes: '',
        position: slot('B', 1, 1, 'A'),
        truck: '',
        seal: 'JO1',
        driver: '',
        weight: '',
      },
    });
    expect(result.status).toBe(400);
  });

  it('the local 4+4 number form is valid, not a warning', async () => {
    const result = await gateIn('ABCD1234', 20, slot('B', 1, 1, 'A'));
    expect(result.status).toBe(201);
    expect((result.body as { numberValid: boolean }).numberValid).toBe(true);
  });

  it('card serials count up from 1, separately per direction', async () => {
    const first = await gateIn('CARD0001', 20, slot('B', 1, 1, 'A'));
    const second = await gateIn('CARD0002', 20, slot('B', 1, 2, 'A'));
    expect(first.body.cardIn).toBe(1);
    expect(second.body.cardIn).toBe(2);

    const out = await gateOut(first.body.id);
    expect((out.body as { cardOut: number }).cardOut).toBe(1);
  });
});

describe('reports', () => {
  it('the entry register carries the paperwork and the full slot', async () => {
    await gateIn('REPT0001', 20, slot('B', 7, 3, 'A'), 'شركة النورس');
    const range = wideRange();
    const report = await call({
      method: 'GET',
      url: `/api/reports/gate?type=IN&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    expect(report.status).toBe(200);
    const rows = (report.body as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      number: 'REPT0001',
      customer: 'شركة النورس',
      seal: 'JO100001',
      position: { zone: 'B', bay: 7, stack: 3, tier: 'A' },
      card: 1,
      user: 'المالك',
    });
  });

  it('the exit register carries the exit paperwork and the dwell', async () => {
    const entered = await gateIn('REPT0002', 20, slot('B', 1, 1, 'A'));
    await gateOut(entered.body.id);
    const range = wideRange();
    const report = await call({
      method: 'GET',
      url: `/api/reports/gate?type=OUT&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    const rows = (report.body as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ number: 'REPT0002', truck: '522', dwellDays: 0 });
  });

  it('the daily summary counts only days the yard worked', async () => {
    await gateIn('DALY0001', 20, slot('B', 1, 1, 'A'));
    const entered = await gateIn('DALY0002', 20, slot('B', 3, 1, 'A'));
    await gateOut(entered.body.id);

    const range = {
      from: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const report = await call({
      method: 'GET',
      url: `/api/reports/daily?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    const rows = (report.body as { rows: Array<Record<string, unknown>> }).rows;
    // Five days of range, ONE day of work — one row.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inCount: 2, outCount: 1, standing: 1 });
  });

  it('the standing sheet lists the yard oldest first with the slot', async () => {
    await gateIn('STND0001', 20, slot('B', 1, 1, 'A'));
    await gateIn('STND0002', 40, slot('B', 4, 2, 'A'));
    const report = await call({ method: 'GET', url: '/api/reports/standing' });
    const rows = (report.body as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      number: 'STND0001',
      position: { zone: 'B', bay: 1, stack: 1, tier: 'A' },
      dwellDays: 0,
    });
    expect(rows[1]).toMatchObject({ number: 'STND0002', size: 40 });
  });

  it('a soft-deleted record leaves the registers', async () => {
    const entered = await gateIn('GONE0001', 20, slot('B', 1, 1, 'A'));
    await call({ method: 'DELETE', url: `/api/containers/${String(entered.body.id)}` });
    const range = wideRange();
    const report = await call({
      method: 'GET',
      url: `/api/reports/gate?type=IN&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    expect((report.body as { rows: unknown[] }).rows).toHaveLength(0);
  });

  it('the operations log records everything, deletions included', async () => {
    const entered = await gateIn('LOGG0001', 20, slot('B', 1, 1, 'A'));
    await call({
      method: 'POST',
      url: `/api/containers/${String(entered.body.id)}/move`,
      payload: { to: slot('B', 3, 1, 'A') },
    });
    await call({ method: 'DELETE', url: `/api/containers/${String(entered.body.id)}` });

    const range = wideRange();
    const log = await call({
      method: 'GET',
      url: `/api/reports/log?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    const rows = (log.body as { rows: Array<{ type: string; deleted: boolean }> }).rows;
    expect(rows.map((row) => row.type)).toEqual(['IN', 'MOVE', 'DELETE']);
    expect(rows.every((row) => row.deleted)).toBe(true);
  });

  it('the truck register gathers one truck across both directions', async () => {
    const entered = await gateIn('TRCK0001', 20, slot('B', 1, 1, 'A'));
    await gateIn('TRCK0002', 20, slot('B', 3, 1, 'A'));
    await gateOut(entered.body.id);

    const range = wideRange();
    const inbound = await call({
      method: 'GET',
      url: `/api/reports/truck?truck=500&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    const rows = (inbound.body as { rows: Array<{ statement: string; number: string }> }).rows;
    expect(rows.filter((row) => row.statement === 'IN')).toHaveLength(2);

    const outbound = await call({
      method: 'GET',
      url: `/api/reports/truck?truck=522&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    expect((outbound.body as { rows: unknown[] }).rows).toHaveLength(1);
  });
});

describe('مواد خطرة والوزنان', () => {
  it('ride in at the gate and reach the card, the state and the registers', async () => {
    const entered = await call({
      method: 'POST',
      url: '/api/containers',
      payload: {
        number: 'HAZM0001',
        size: 20,
        customer: 'شركة الكيماويات',
        notes: '',
        position: slot('B', 1, 1, 'A'),
        truck: '500',
        seal: 'JO1',
        driver: '',
        weight: '30000',
        weightNet: '24000',
        hazmat: true,
      },
    });
    expect(entered.status).toBe(201);
    expect(entered.body as { hazmat: boolean; weight: string; weightNet: string }).toMatchObject({
      hazmat: true,
      weight: '30000',
      weightNet: '24000',
    });

    // Both weights and the flag survive the round trip to every register.
    const range = wideRange();
    const gate = await call({
      method: 'GET',
      url: `/api/reports/gate?type=IN&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    const row = (gate.body as { rows: Array<{ hazmat: boolean; weightNet: string }> }).rows[0];
    expect(row?.hazmat).toBe(true);
    expect(row?.weightNet).toBe('24000');

    const standing = await call({ method: 'GET', url: '/api/reports/standing' });
    expect((standing.body as { rows: Array<{ hazmat: boolean }> }).rows[0]?.hazmat).toBe(true);
  });

  it('default to safe and blank when the gate does not say', async () => {
    const plain = await gateIn('HAZM0002', 20, slot('B', 3, 1, 'A'));
    expect(plain.status).toBe(201);
    const card = await call({ method: 'GET', url: `/api/containers/${String(plain.body.id)}` });
    expect(
      (card.body as { container: { hazmat: boolean; weightNet: string } }).container,
    ).toMatchObject({ hazmat: false, weightNet: '' });
  });
});

describe('رقم البوليصة', () => {
  const withBill = (number: string, bay: number, stack: number, bill: string) =>
    call({
      method: 'POST',
      url: '/api/containers',
      payload: {
        number,
        size: 20,
        customer: 'شركة النورس',
        bill,
        notes: '',
        position: slot('B', bay, stack, 'A'),
        truck: '500',
        seal: 'JO1',
        driver: '',
        weight: '24000',
      },
    });

  it('rides in at the gate, optionally, and lands on the registers', async () => {
    await withBill('BILL0001', 1, 1, '3210');
    await withBill('BILL0002', 3, 1, '3210');
    // No bill is fine — the owner made it optional.
    const bare = await gateIn('BILL0003', 20, slot('B', 5, 1, 'A'));
    expect(bare.status).toBe(201);

    const range = wideRange();
    const report = await call({
      method: 'GET',
      url: `/api/reports/gate?type=IN&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    const rows = (report.body as { rows: Array<{ number: string; bill: string }> }).rows;
    expect(rows.find((row) => row.number === 'BILL0001')?.bill).toBe('3210');
    expect(rows.find((row) => row.number === 'BILL0003')?.bill).toBe('');
  });

  it('كشف البوليصة gathers the whole group, standing first', async () => {
    const first = await withBill('BILL0004', 1, 1, '4444');
    await withBill('BILL0005', 3, 1, '4444');
    await withBill('BILL0006', 5, 1, '5555');
    await gateOut((first.body as { id: number }).id);

    const sheet = await call({ method: 'GET', url: '/api/reports/bill?number=4444' });
    expect(sheet.status).toBe(200);
    const rows = (sheet.body as { rows: Array<{ number: string; position: unknown }> }).rows;
    expect(rows).toHaveLength(2);
    // The standing one leads; the departed one closes the sheet.
    expect(rows[0]?.number).toBe('BILL0005');
    expect(rows[0]?.position).not.toBeNull();
    expect(rows[1]?.number).toBe('BILL0004');
    expect(rows[1]?.position).toBeNull();
  });

  it('the search box finds a container by its bill', async () => {
    await withBill('BILL0007', 7, 1, '9876');
    const found = await call({ method: 'GET', url: '/api/containers?q=9876' });
    expect((found.body as { results: Array<{ number: string }> }).results[0]?.number).toBe(
      'BILL0007',
    );
  });

  it('the bill can be fixed later from the edit form', async () => {
    const entered = await gateIn('BILL0008', 20, slot('B', 9, 1, 'A'));
    const edited = await call({
      method: 'PATCH',
      url: `/api/containers/${String(entered.body.id)}`,
      payload: {
        number: 'BILL0008',
        customer: 'شركة',
        bill: '7000',
        size: 20,
        notes: '',
        enteredAt: new Date().toISOString(),
      },
    });
    expect(edited.status).toBe(200);
    expect((edited.body as { bill: string }).bill).toBe('7000');
  });
});

describe('النسخة الاحتياطية', () => {
  it('one tap: a dated copy on the server AND the same bytes as a download', async () => {
    // A file-backed yard of its own — the snapshot needs a real file to sit by.
    const dir = mkdtempSync(path.join(tmpdir(), 'yard-backup-'));
    const file = path.join(dir, 'yard.db');
    const own = buildApp(openDatabase(file));
    await own.ready();
    const made = await own.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { password: 'yard-secret' },
    });
    const header = made.headers['set-cookie'];
    const ownCookie = (Array.isArray(header) ? header[0] : header)?.split(';')[0] ?? '';

    const response = await own.inject({
      method: 'POST',
      url: '/api/backup',
      headers: { cookie: ownCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toContain('yard-');
    // The download IS a SQLite file: the magic bytes open every .db ever.
    expect(response.rawPayload.subarray(0, 15).toString('utf8')).toBe('SQLite format 3');
    // And the server kept its own copy, beside the live file.
    const kept = readdirSync(path.join(dir, 'backups'));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatch(/^yard-.*\.db$/);
    await own.close();
  });

  it('is the owner’s alone', async () => {
    const noAuth = await call({ method: 'POST', url: '/api/backup', payload: {}, noAuth: true });
    expect(noAuth.status).toBe(401);
  });
});

describe('search', () => {
  it('finds by number fragment and by customer, in-yard first', async () => {
    const entered = await gateIn('SRCH0001', 20, slot('B', 1, 1, 'A'), 'مؤسسة النخيل');
    await gateOut(entered.body.id);
    await gateIn('SRCH0002', 20, slot('B', 3, 1, 'A'), 'مؤسسة النخيل');

    const byNumber = await call({ method: 'GET', url: '/api/containers?q=SRCH' });
    const results = (byNumber.body as { results: Array<{ number: string; position: unknown }> })
      .results;
    expect(results).toHaveLength(2);
    expect(results[0]?.number).toBe('SRCH0002');

    const byCustomer = await call({
      method: 'GET',
      url: `/api/containers?q=${encodeURIComponent('النخيل')}`,
    });
    expect((byCustomer.body as { results: unknown[] }).results).toHaveLength(2);
  });

  it('a literal % finds nothing rather than everything', async () => {
    await gateIn('PCNT0001', 20, slot('B', 1, 1, 'A'));
    const result = await call({ method: 'GET', url: `/api/containers?q=${encodeURIComponent('%')}` });
    expect((result.body as { results: unknown[] }).results).toHaveLength(0);
  });
});

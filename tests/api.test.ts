import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { ammanYear } from '../src/shared/dates';
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
): Promise<{
  status: number;
  body: {
    id?: number;
    position?: Position;
    code?: string;
    cardIn?: number;
    cardInYear?: number;
    sealIn?: string;
    enteredAt?: string;
  };
}> {
  const result = await call({
    method: 'POST',
    url: '/api/containers',
    payload: {
      number,
      size,
      // Everything but the notes is mandatory now, so the helper fills it.
      bill: '3210',
      notes: '',
      position,
      truck: '500',
      seal: 'JO100001',
      driver: 'أبو أحمد',
      weight: '25000',
      handling: 'CRANE',
    },
  });
  return result as {
    status: number;
    body: {
      id?: number;
      position?: Position;
      code?: string;
      cardIn?: number;
      cardInYear?: number;
      sealIn?: string;
      enteredAt?: string;
    };
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
    'number', 'bill', 'size', 'notes', 'weight', 'handling',
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
    payload: { truck: '522', seal: 'JO100001', driver: 'أبو علي' },
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
    const body = state.body as { containers: unknown[]; customers?: unknown; yard?: unknown };
    expect(body.containers).toEqual([]);
    expect(body.yard).toBeUndefined();
    // The owner's name is gone, and with it the list of names the gate used
    // to suggest — «رح يتم ازالة اسم المالك تماما».
    expect(body.customers).toBeUndefined();
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

  /**
   * One seal per container, recorded at entry and mandatory there. The exit
   * no longer asks for a second — the owner's instruction: «ازل ايضا رصاصة
   * الخروج عند اخراج الحاوية».
   */
  it('demands the seal at entry, and never asks for one at the exit', async () => {
    const noSeal = await call({
      method: 'POST',
      url: '/api/containers',
      payload: {
        number: 'SEAL0001',
        size: 20,
        notes: '',
        bill: '1',
        position: slot('B', 9, 1, 'A'),
        truck: '55',
        seal: '',
        driver: 'سائق',
        weight: '1',
        handling: 'CRANE',
      },
    });
    expect(noSeal.status).toBe(400);

    const entered = await gateIn('SEAL0002', 20, slot('B', 9, 1, 'A'));
    const left = await call({
      method: 'POST',
      url: `/api/containers/${String(entered.body.id)}/exit`,
      payload: { truck: '66', driver: 'سائق' },
    });
    expect(left.status).toBe(200);
    // The record carries one seal, and it is the one it came in under.
    expect(left.body).toMatchObject({ sealIn: 'JO100001' });
    expect(JSON.stringify(left.body).includes('"sealOut"')).toBe(false);

    // Both registers name that same seal, in either direction.
    const range = wideRange();
    for (const type of ['IN', 'OUT']) {
      const sheet = await call({
        method: 'GET',
        url: `/api/reports/gate?type=${type}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      });
      expect((sheet.body as { rows: Array<{ seal: string }> }).rows[0]?.seal, type).toBe(
        'JO100001',
      );
    }
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
    const result = moved.body as {
      container: { position: Position };
      move: { from: unknown; to: unknown; card: number; cardYear: number };
    };
    expect(result.container.position).toEqual(slot('B', 15, 4, 'A'));
    // The move hands its own card back — the paper the crane is given, with
    // the two slots on it and a serial the screen could not have known.
    expect(result.move.from).toEqual(slot('B', 1, 1, 'A'));
    expect(result.move.to).toEqual(slot('B', 15, 4, 'A'));
    expect(result.move.card).toBe(1);
    expect(result.move.cardYear).toBe(ammanYear(new Date()));

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

  /**
   * The paper the crane is handed. Its whole reason is the two slots, and it
   * carries what the lift brought down with it — a card that named only the
   * container moved would describe a stack the yard no longer has.
   */
  it('writes the descents onto the move itself, and only when there are any', async () => {
    const ground = await gateIn('DROP0001', 20, slot('B', 1, 1, 'A'));
    await gateIn('DROP0002', 20, slot('B', 1, 1, 'B'));
    await gateIn('DROP0003', 20, slot('B', 1, 1, 'C'));

    const lifted = await call({
      method: 'POST',
      url: `/api/containers/${String(ground.body.id)}/move`,
      payload: { to: slot('B', 3, 1, 'A') },
    });
    expect(lifted.status).toBe(200);
    const note = JSON.parse((lifted.body as { move: { note: string } }).move.note) as {
      d: Array<{ n: string; f: string; t: string }>;
    };
    // Both of the containers that stood on it came down one tier, and the
    // card says which and from where to where.
    expect(note.d).toEqual([
      { n: 'DROP0002', f: '2-B-01-01-B', t: '2-B-01-01-A' },
      { n: 'DROP0003', f: '2-B-01-01-C', t: '2-B-01-01-B' },
    ]);

    // A move that lifts nothing off anything writes no note at all.
    const alone = await call({
      method: 'POST',
      url: `/api/containers/${String(ground.body.id)}/move`,
      payload: { to: slot('B', 5, 1, 'A') },
    });
    expect((alone.body as { move: { note: string } }).move.note).toBe('');
  });

  it('counts move cards per year, and never hands a struck-out one’s back', async () => {
    const first = await gateIn('MCRD0001', 20, slot('B', 21, 1, 'A'));
    const second = await gateIn('MCRD0002', 20, slot('B', 23, 1, 'A'));
    const moveTo = async (id: unknown, to: Position): Promise<number> => {
      const moved = await call({
        method: 'POST',
        url: `/api/containers/${String(id)}/move`,
        payload: { to },
      });
      expect(moved.status).toBe(200);
      return (moved.body as { move: { card: number } }).move.card;
    };

    expect(await moveTo(first.body.id, slot('B', 25, 1, 'A'))).toBe(1);
    expect(await moveTo(second.body.id, slot('B', 27, 1, 'A'))).toBe(2);
    expect(await moveTo(first.body.id, slot('B', 29, 1, 'A'))).toBe(3);

    // Striking out a record leaves its move cards where they are — they were
    // printed and handed to a crane driver, and the ledger keeps the holes.
    const struck = await call({
      method: 'DELETE',
      url: `/api/containers/${String(first.body.id)}`,
    });
    expect(struck.status).toBe(200);
    // The second container's move still reads 2, exactly as its card does.
    const detail = await call({
      method: 'GET',
      url: `/api/containers/${String(second.body.id)}`,
    });
    const moves = (detail.body as { movements: Array<{ type: string; card: number | null }> })
      .movements.filter((movement) => movement.type === 'MOVE');
    expect(moves.map((movement) => movement.card)).toEqual([2]);
    // And the next move takes 4 — past 1 and 3, which are gone for good.
    expect(await moveTo(second.body.id, slot('B', 31, 1, 'A'))).toBe(4);
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
      notes: 'باب مبعوج',
    });
    expect(edited.status).toBe(200);
    expect((edited.body as { notes: string }).notes).toBe('باب مبعوج');

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
      truckIn: '777',
      driverIn: 'أبو خالد',
      sealIn: 'JO999',
    });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({
      weight: '31000',
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
      expect.arrayContaining(['weight', 'truckIn', 'driverIn', 'sealIn']),
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

  /**
   * THE CLASS IS FIXED for the life of the record. A 40 occupies two slots
   * and a 20 one, so a class corrected after the fact falsifies the ground
   * and every count taken off it — «لا يوجد تعديل على فئة الحاوية … الا عند
   * حذفها ثم ادخالها مره اخرى». It used to be editable once the container
   * had left, which is exactly when nothing on the map contradicts it.
   */
  it('refuses to change the class, standing or departed', async () => {
    const entered = await gateIn('EDIT0002', 20, slot('B', 1, 1, 'A'));
    const flipped = await editWith(entered.body.id, { size: 40 });
    expect(flipped.status).toBe(409);
    expect((flipped.body as { code: string }).code).toBe('SIZE_LOCKED');

    // And after it leaves, where the old rule let it through.
    await gateOut(entered.body.id);
    const later = await editWith(entered.body.id, { size: 40 });
    expect(later.status).toBe(409);
    expect((later.body as { code: string }).code).toBe('SIZE_LOCKED');

    // The same edit with the class untouched still saves.
    const fine = await editWith(entered.body.id, { notes: 'الباب مبعوج' });
    expect(fine.status).toBe(200);
  });

  it('renaming onto a number standing elsewhere is refused', async () => {
    await gateIn('NAME0001', 20, slot('B', 1, 1, 'A'));
    const other = await gateIn('NAME0002', 20, slot('B', 3, 1, 'A'));
    const renamed = await call({
      method: 'PATCH',
      url: `/api/containers/${String(other.body.id)}`,
      payload: {
        number: 'NAME0001',
        bill: '3210',
        size: 20,
        notes: '',
        weight: '1',
        truckIn: '5',
        driverIn: 'س',
        sealIn: 'J1',
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
        notes: '',
        bill: '1',
        position: slot('B', 1, 1, 'A'),
        truck: '',
        seal: 'JO1',
        driver: 'سائق',
        weight: '1',
        handling: 'CRANE',
      },
    });
    expect(result.status).toBe(400);
  });

  /**
   * The accepted shape is four letters and seven digits. A shorter one is a
   * warning, never a refusal: the box is in the yard whatever its paperwork
   * says, and a gate that cannot record it teaches the clerk to invent a
   * number that passes.
   */
  it('records a number of the wrong shape, flagged rather than refused', async () => {
    const short = await gateIn('ABCD1234', 20, slot('B', 1, 1, 'A'));
    expect(short.status).toBe(201);
    expect((short.body as { numberValid: boolean }).numberValid).toBe(false);

    const proper = await gateIn('MSCU1234566', 20, slot('B', 1, 2, 'A'));
    expect(proper.status).toBe(201);
    expect((proper.body as { numberValid: boolean }).numberValid).toBe(true);
  });

  it('card serials count up from 1, separately per direction', async () => {
    const first = await gateIn('CARD0001', 20, slot('B', 1, 1, 'A'));
    const second = await gateIn('CARD0002', 20, slot('B', 1, 2, 'A'));
    expect(first.body.cardIn).toBe(1);
    expect(second.body.cardIn).toBe(2);

    const out = await gateOut(first.body.id);
    expect((out.body as { cardOut: number }).cardOut).toBe(1);
  });

  /**
   * «في حال نقل الحاوية يجب ان لا يتغير رقم التسلسلي» — carrying a container
   * across the yard is not a gate event, and the card in the driver's hand
   * goes on being the card for that container.
   */
  it('never renumbers a card because the container was moved', async () => {
    const entered = await gateIn('MOVE0100', 20, slot('B', 9, 1, 'A'));
    const serial = entered.body.cardIn;
    expect(serial).toBe(1);

    const moveCards: number[] = [];
    for (const to of [slot('B', 11, 2, 'A'), slot('B', 13, 3, 'A'), slot('B', 9, 1, 'A')]) {
      const moved = await call({
        method: 'POST',
        url: `/api/containers/${String(entered.body.id)}/move`,
        payload: { to },
      });
      expect(moved.status).toBe(200);
      const result = moved.body as { container: { cardIn: number }; move: { card: number } };
      expect(result.container.cardIn).toBe(serial);
      moveCards.push(result.move.card);
    }

    // Nor does it consume an ENTRY serial: the next container is still 2.
    const next = await gateIn('MOVE0101', 20, slot('B', 15, 1, 'A'));
    expect(next.body.cardIn).toBe(2);
    // The move cards are their own ledger, and it counts up on its own.
    expect(moveCards).toEqual([1, 2, 3]);
  });

  /**
   * «هل في حال التعديل على الحاوية بأي شكل من الأشكال يتم تغيير الرقم
   * التسلسلي؟» — no. Correcting what a person typed is not issuing a card, so
   * every editable field is corrected here in turn and the serial is read back
   * after each one, the gate dates included.
   */
  it('never renumbers a card because a field was corrected', async () => {
    const entered = await gateIn('EDIT9000', 20, slot('B', 17, 1, 'A'));
    const id = entered.body.id;
    const serial = entered.body.cardIn;
    const year = entered.body.cardInYear;
    expect(serial).toBe(1);

    const corrections: Array<Record<string, unknown>> = [
      { number: 'MSCU1234566' },
      { bill: '9999' },
      { notes: 'الباب مبعوج' },
      { weight: '31000' },
      { weight: '' },
      { truckIn: '777' },
      { driverIn: 'أبو خالد' },
      { driverIn: '' },
      { sealIn: 'JO555' },
      // The gate instant itself, which re-times the movement under it.
      { enteredAt: new Date(Date.now() - 5 * 86_400_000).toISOString() },
    ];
    for (const patch of corrections) {
      const fixed = await editWith(id, patch);
      expect(fixed.status, JSON.stringify(patch)).toBe(200);
      expect(fixed.body, JSON.stringify(patch)).toMatchObject({
        cardIn: serial,
        cardInYear: year,
      });
    }

    // Nor did all that correcting consume a serial: the next one is still 2.
    const next = await gateIn('EDIT9001', 20, slot('B', 19, 1, 'A'));
    expect(next.body.cardIn).toBe(2);

    // And the exit card is minted once, then survives its own corrections.
    const left = await gateOut(id);
    const exitSerial = (left.body as { cardOut: number }).cardOut;
    expect(exitSerial).toBe(1);
    const afterExit = await editWith(id, { sealOut: 'JO777', driverOut: '' });
    expect(afterExit.body).toMatchObject({ cardIn: serial, cardOut: exitSerial });
  });

  /**
   * The one case worth being explicit about: correcting the gate date into a
   * DIFFERENT YEAR does not re-date the card either. The serial and its year
   * are what was printed and handed over; the paper in somebody's hand cannot
   * be corrected from here, so the record goes on agreeing with it.
   */
  it('keeps the card’s own year when the gate date is corrected into another', async () => {
    const entered = await gateIn('YEAR9000', 20, slot('B', 23, 1, 'A'));
    const year = entered.body.cardInYear;
    const backdated = await editWith(entered.body.id, {
      enteredAt: '2025-11-20T09:00:00.000Z',
    });
    expect(backdated.status).toBe(200);
    expect(backdated.body).toMatchObject({
      enteredAt: '2025-11-20T09:00:00.000Z',
      cardIn: 1,
      cardInYear: year,
    });
  });

  /**
   * «في حال حذف الحاوية او سجل خطأ يجب ان لا يتم القفز عن الرقم التسلسلي» —
   * a record struck out at once hands its number straight back.
   */
  it('never hands a struck-out record’s serial to the next one', async () => {
    await gateIn('SKIP0001', 20, slot('B', 1, 1, 'A'));
    const mistake = await gateIn('SKIP0002', 20, slot('B', 3, 1, 'A'));
    expect(mistake.body.cardIn).toBe(2);

    const struck = await call({
      method: 'DELETE',
      url: `/api/containers/${String(mistake.body.id)}`,
    });
    expect(struck.status).toBe(200);

    // «الي بدي اجي اضيفها خلص لازم تيجي 4، مو توخذ محل ال 3».
    const replacement = await gateIn('SKIP0003', 20, slot('B', 5, 1, 'A'));
    expect(replacement.body.cardIn).toBe(3);
  });

  /**
   * A restored record keeps the serial it always had, and nothing else moves.
   * Nobody could have taken it: the year's count climbs PAST a struck-out
   * record rather than into its seat, so the number was held for it the whole
   * time it was gone.
   */
  it('a restored record keeps its own serial, and moves nobody', async () => {
    await gateIn('BACK0001', 20, slot('B', 1, 1, 'A'));
    const mistake = await gateIn('BACK0002', 20, slot('B', 3, 1, 'A'));
    await call({ method: 'DELETE', url: `/api/containers/${String(mistake.body.id)}` });
    const replacement = await gateIn('BACK0003', 20, slot('B', 5, 1, 'A'));
    expect(replacement.body.cardIn).toBe(3);

    const restored = await call({
      method: 'POST',
      url: `/api/containers/${String(mistake.body.id)}/restore`,
    });
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ cardIn: 2 });
    // And the card printed for the third one still reads 3, as it does on the
    // paper in somebody's hand.
    const other = await call({ method: 'GET', url: `/api/containers/${String(replacement.body.id)}` });
    expect((other.body as { container: { cardIn: number } }).container.cardIn).toBe(3);
  });

  /**
   * Strike one out of the MIDDLE and the register keeps the hole — and, far
   * more importantly, keeps everybody else's number. The old rule closed the
   * hole by moving the cards standing after it, which changed the number on
   * paper already in a driver's hand.
   */
  it('leaves the hole and does not move a single card around it', async () => {
    const first = await gateIn('HOLE0001', 20, slot('B', 1, 1, 'A'));
    const middle = await gateIn('HOLE0002', 20, slot('B', 3, 1, 'A'));
    const last = await gateIn('HOLE0003', 20, slot('B', 5, 1, 'A'));
    expect([first.body.cardIn, middle.body.cardIn, last.body.cardIn]).toEqual([1, 2, 3]);

    const struck = await call({
      method: 'DELETE',
      url: `/api/containers/${String(middle.body.id)}`,
    });
    expect(struck.status).toBe(200);
    expect(struck.body).toMatchObject({ resealed: 0 });

    const serialOf = async (id: unknown): Promise<number | null> => {
      const seen = await call({ method: 'GET', url: `/api/containers/${String(id)}` });
      return (seen.body as { container: { cardIn: number | null } }).container.cardIn;
    };
    expect(await serialOf(first.body.id)).toBe(1);
    expect(await serialOf(last.body.id)).toBe(3);
    // The register reads 1, 3 — and the next one in is 4, never 2.
    const next = await gateIn('HOLE0004', 20, slot('B', 7, 1, 'A'));
    expect(next.body.cardIn).toBe(4);
  });

  /** The count restarts each January, so the year is part of the record. */
  it('stamps each card with the Amman year it was issued in', async () => {
    const thisYear = ammanYear(new Date());
    const entered = await gateIn('CARD0003', 20, slot('B', 1, 3, 'A'));
    expect(entered.body.cardInYear).toBe(thisYear);

    const out = await gateOut(entered.body.id);
    expect(out.body).toMatchObject({ cardOutYear: thisYear });
  });
});

describe('reports', () => {
  it('the entry register carries the paperwork and the full slot', async () => {
    await gateIn('REPT0001', 20, slot('B', 7, 3, 'A'));
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
      seal: 'JO100001',
      position: { zone: 'B', bay: 7, stack: 3, tier: 'A' },
      card: 1,
      user: 'المالك',
    });
  });

  /**
   * «في حال تعديل على مكان الحاوية بطاقة الدخول والخروج لا يتم التعديل عليها
   * وهذه خطا فادح» — a sheet that names a container must send whoever reads it
   * to the stack the container is actually on.
   */
  it('every register follows the container when it is carried elsewhere', async () => {
    const entered = await gateIn('MOVE0200', 20, slot('B', 21, 4, 'A'));
    const moved = await call({
      method: 'POST',
      url: `/api/containers/${String(entered.body.id)}/move`,
      payload: { to: slot('B', 33, 8, 'A') },
    });
    expect(moved.status).toBe(200);

    const range = wideRange();
    const here = { zone: 'B', bay: 33, stack: 8, tier: 'A' };
    const gate = await call({
      method: 'GET',
      url: `/api/reports/gate?type=IN&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    expect((gate.body as { rows: Array<{ position: unknown }> }).rows[0]?.position).toEqual(here);

    const standing = await call({ method: 'GET', url: '/api/reports/standing' });
    expect((standing.body as { rows: Array<{ position: unknown }> }).rows[0]?.position).toEqual(
      here,
    );

    const truck = await call({
      method: 'GET',
      url: `/api/reports/truck?truck=500&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    expect((truck.body as { rows: Array<{ position: unknown }> }).rows[0]?.position).toEqual(here);

    // The move itself is not lost — the log still records where it came from.
    const log = await call({
      method: 'GET',
      url: `/api/reports/log?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    const moveRow = (log.body as { rows: Array<{ type: string; from: unknown; to: unknown }> }).rows.find(
      (row) => row.type === 'MOVE',
    );
    expect(moveRow?.from).toEqual({ zone: 'B', bay: 21, stack: 4, tier: 'A' });
    expect(moveRow?.to).toEqual(here);
  });

  /**
   * «اذا تم ازالة الطابق الأول يتم التعديل ايضا على المواقع في الطوابق الأخرى
   * في بطاقات الدخول» — lifting the bottom box out drops everything above it a
   * tier, and the cards and the registers of those boxes must say so. Nobody
   * moved them by hand and nobody will reprint their cards by hand either.
   */
  it('follows the containers that came down when the bottom one was lifted', async () => {
    const ground = await gateIn('DROP0001', 20, slot('B', 25, 1, 'A'));
    const middle = await gateIn('DROP0002', 20, slot('B', 25, 1, 'B'));
    const top = await gateIn('DROP0003', 20, slot('B', 25, 1, 'C'));

    // The bottom one leaves; gravity does the rest.
    expect((await gateOut(ground.body.id)).status).toBe(200);

    // Each one is now a tier lower — on its own card first of all.
    for (const [container, tier] of [
      [middle, 'A'],
      [top, 'B'],
    ] as const) {
      const card = await call({ method: 'GET', url: `/api/containers/${String(container.body.id)}` });
      expect((card.body as { container: { position: unknown } }).container.position, tier).toEqual({
        zone: 'B',
        bay: 25,
        stack: 1,
        tier,
      });
    }

    // And on the sheets: the entry register names each where it now stands.
    const range = wideRange();
    const gate = await call({
      method: 'GET',
      url: `/api/reports/gate?type=IN&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    const rows = (gate.body as {
      rows: Array<{ number: string; position: { tier: string } | null }>;
    }).rows;
    expect(rows.find((row) => row.number === 'DROP0002')?.position?.tier).toBe('A');
    expect(rows.find((row) => row.number === 'DROP0003')?.position?.tier).toBe('B');

    const standing = await call({ method: 'GET', url: '/api/reports/standing' });
    const stood = (standing.body as {
      rows: Array<{ number: string; position: { tier: string } | null }>;
    }).rows;
    expect(stood.find((row) => row.number === 'DROP0002')?.position?.tier).toBe('A');
    expect(stood.find((row) => row.number === 'DROP0003')?.position?.tier).toBe('B');

    // Their serials did not move with them: gravity is not a gate event.
    const stillOne = await call({ method: 'GET', url: `/api/containers/${String(middle.body.id)}` });
    expect((stillOne.body as { container: { cardIn: number } }).container.cardIn).toBe(2);
  });

  /** Striking the bottom record out drops the stack the same way. */
  it('follows them when the bottom record is struck out rather than gated out', async () => {
    const ground = await gateIn('DROP0010', 20, slot('B', 27, 1, 'A'));
    const above = await gateIn('DROP0011', 20, slot('B', 27, 1, 'B'));
    expect((await call({ method: 'DELETE', url: `/api/containers/${String(ground.body.id)}` })).status).toBe(200);

    const card = await call({ method: 'GET', url: `/api/containers/${String(above.body.id)}` });
    expect((card.body as { container: { position: unknown } }).container.position).toEqual({
      zone: 'B',
      bay: 27,
      stack: 1,
      tier: 'A',
    });
  });

  /** Once it has gone, the sheets name the slot it stood in as it left. */
  it('names the slot a departed container left from', async () => {
    const entered = await gateIn('MOVE0201', 20, slot('B', 21, 4, 'A'));
    await call({
      method: 'POST',
      url: `/api/containers/${String(entered.body.id)}/move`,
      payload: { to: slot('B', 35, 2, 'A') },
    });
    await gateOut(entered.body.id);

    const range = wideRange();
    const out = await call({
      method: 'GET',
      url: `/api/reports/gate?type=OUT&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    expect((out.body as { rows: Array<{ position: unknown }> }).rows[0]?.position).toEqual({
      zone: 'B',
      bay: 35,
      stack: 2,
      tier: 'A',
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

/**
 * آلية المناولة — crane or straddle. Chosen at the gate, correctable
 * afterwards, and carried to ONE place: the entry card. «بدي اياها تبين ب
 * ورقة الدخول فقط».
 */
describe('آلية المناولة', () => {
  it('is required at the gate — a record without it is refused', async () => {
    const payload = {
      number: 'HAND0001',
      size: 20,
      bill: '3210',
      notes: '',
      position: slot('B', 1, 1, 'A'),
      truck: '500',
      seal: 'JO1',
      weight: '25000',
    };
    expect((await call({ method: 'POST', url: '/api/containers', payload })).status).toBe(400);
    // …and a value that is neither of the two is refused as well.
    expect(
      (
        await call({
          method: 'POST',
          url: '/api/containers',
          payload: { ...payload, handling: 'FORKLIFT' },
        })
      ).status,
    ).toBe(400);
    const good = await call({
      method: 'POST',
      url: '/api/containers',
      payload: { ...payload, handling: 'STRADDLE' },
    });
    expect(good.status).toBe(201);
    expect(good.body).toMatchObject({ handling: 'STRADDLE' });
  });

  it('is correctable, and the correction is named in the log', async () => {
    const entered = await gateIn('HAND0002', 20, slot('B', 3, 1, 'A'));
    expect(entered.body).toMatchObject({ handling: 'CRANE' });

    const fixed = await editWith(entered.body.id, { handling: 'STRADDLE' });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({ handling: 'STRADDLE' });

    const card = await call({ method: 'GET', url: `/api/containers/${String(entered.body.id)}` });
    const edit = (card.body as { movements: Array<{ type: string; note: string }> }).movements.find(
      (movement) => movement.type === 'EDIT',
    );
    const note = JSON.parse(edit?.note ?? '{}') as { k: string[]; b: Record<string, unknown> };
    expect(note.k).toContain('handling');
    expect(note.b['handling']).toBe('CRANE');
  });

  /** The whole point of the scope: it belongs on the card and nowhere else. */
  it('reaches the container’s own record and NOT one register', async () => {
    const entered = await gateIn('HAND0003', 20, slot('B', 5, 1, 'A'));
    await gateOut(entered.body.id);
    const range = wideRange();

    // The card reads it off the container itself.
    const detail = await call({ method: 'GET', url: `/api/containers/${String(entered.body.id)}` });
    expect((detail.body as { container: { handling: string } }).container.handling).toBe('CRANE');

    // No register carries it, in either direction.
    for (const url of [
      `/api/reports/gate?type=IN&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      `/api/reports/gate?type=OUT&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      '/api/reports/standing',
      `/api/reports/truck?truck=500&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      `/api/reports/log?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    ]) {
      const sheet = await call({ method: 'GET', url });
      expect(JSON.stringify(sheet.body).includes('"handling"'), url).toBe(false);
    }
  });

  /** Records from before the field simply have no answer, and may be edited. */
  it('reads as nothing on a record from before it existed', async () => {
    const entered = await gateIn('HAND0004', 20, slot('B', 7, 1, 'A'));
    const cleared = await editWith(entered.body.id, { handling: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ handling: null });
  });
});

/**
 * Three fields the owner struck out: the owner's name, the net weight and the
 * dangerous-goods flag — «لان جميع الحاويات عادية». They are gone from the
 * wire, and one weight is left, named simply «الوزن».
 */
describe('الحقول المحذوفة', () => {
  it('the one weight rides in at the gate and reaches every register', async () => {
    const entered = await call({
      method: 'POST',
      url: '/api/containers',
      payload: {
        number: 'WGHT0001',
        size: 20,
        notes: '',
        bill: '3210',
        position: slot('B', 1, 1, 'A'),
        truck: '500',
        seal: 'JO1',
        driver: 'سائق',
        weight: '30000',
        handling: 'CRANE',
      },
    });
    expect(entered.status).toBe(201);
    expect(entered.body).toMatchObject({ weight: '30000' });

    const range = wideRange();
    const gate = await call({
      method: 'GET',
      url: `/api/reports/gate?type=IN&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    expect((gate.body as { rows: Array<{ weight: string }> }).rows[0]?.weight).toBe('30000');
  });

  it('carries none of the three on any surface a sheet is built from', async () => {
    const entered = await gateIn('GONE0001', 20, slot('B', 3, 1, 'A'));
    const range = wideRange();
    const surfaces = [
      `/api/containers/${String(entered.body.id)}`,
      '/api/state',
      '/api/reports/standing',
      `/api/reports/gate?type=IN&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      `/api/reports/log?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      '/api/containers?q=GONE',
    ];
    for (const url of surfaces) {
      const answer = await call({ method: 'GET', url });
      const text = JSON.stringify(answer.body);
      for (const gone of ['customer', 'weightNet', 'hazmat']) {
        expect(text.includes(`"${gone}"`), `${gone} in ${url}`).toBe(false);
      }
    }
  });

  it('ignores them if an old client still sends them', async () => {
    const stale = await call({
      method: 'POST',
      url: '/api/containers',
      payload: {
        number: 'GONE0002',
        size: 20,
        notes: '',
        bill: '3210',
        position: slot('B', 5, 1, 'A'),
        truck: '500',
        seal: 'JO1',
        weight: '30000',
        handling: 'CRANE',
        customer: 'شركة قديمة',
        weightNet: '24000',
        hazmat: true,
      },
    });
    expect(stale.status).toBe(201);
    const text = JSON.stringify(stale.body);
    expect(text.includes('شركة قديمة')).toBe(false);
    expect(text.includes('24000')).toBe(false);
  });
});

describe('ثلاثة طوابق في كل مكان', () => {
  it('takes a third tier on any bay, with no ceremony', async () => {
    await gateIn('TIER0001', 20, slot('B', 1, 1, 'A'));
    await gateIn('TIER0002', 20, slot('B', 1, 1, 'B'));
    expect((await gateIn('TIER0003', 20, slot('B', 1, 1, 'C'))).status).toBe(201);

    // And a fourth is air: three is the height of the yard.
    const tooHigh = await call({
      method: 'POST',
      url: '/api/containers',
      payload: {
        number: 'TIER0004',
        size: 20,
        bill: '1',
        notes: '',
        position: { zone: 'B', bay: 1, stack: 1, tier: 'D' },
        truck: '500',
        seal: 'JO1',
        driver: 'سائق',
        weight: '1',
        handling: 'CRANE',
      },
    });
    expect(tooHigh.status).toBe(400);
  });

  it('stacks forties three high too', async () => {
    await gateIn('TIER0010', 40, slot('B', 2, 1, 'A'));
    await gateIn('TIER0011', 40, slot('B', 2, 1, 'B'));
    expect((await gateIn('TIER0012', 40, slot('B', 2, 1, 'C'))).status).toBe(201);
  });
});

describe('الخانات الإلزامية والاختيارية', () => {
  const withoutField = (field: string): Promise<{ status: number; body: unknown }> => {
    const payload: Record<string, unknown> = {
      number: 'MAND0001',
      size: 20,
      bill: '3210',
      notes: '',
      position: slot('B', 1, 1, 'A'),
      truck: '500',
      seal: 'JO1',
      driver: 'سائق',
      weight: '25000',
    };
    payload[field] = '';
    return call({ method: 'POST', url: '/api/containers', payload });
  };

  it('refuses a gate-in missing any of the mandatory fields', async () => {
    for (const field of ['number', 'bill', 'truck', 'seal']) {
      const refused = await withoutField(field);
      expect(refused.status, field).toBe(400);
    }
  });

  /**
   * The owner's later correction to «كل الخانات اجبارية»: a truck can arrive
   * before its scale ticket, and the man at the wheel is often on no paper at
   * all. Refusing the record over either only teaches the gate to invent one.
   */
  it('accepts a gate-in with no driver name and no weight', async () => {
    const spare = await call({
      method: 'POST',
      url: '/api/containers',
      payload: {
        number: 'MAND0002',
        size: 20,
        bill: '3210',
        notes: '',
        position: slot('B', 1, 1, 'A'),
        truck: '500',
        seal: 'JO1',
        handling: 'STRADDLE',
      },
    });
    expect(spare.status).toBe(201);
    expect(spare.body).toMatchObject({ driverIn: '', weight: '' });
  });

  it('lets a container leave without a driver name', async () => {
    const entered = await gateIn('MAND0003', 20, slot('B', 3, 1, 'A'));
    const noDriver = await call({
      method: 'POST',
      url: `/api/containers/${String(entered.body.id)}/exit`,
      payload: { truck: '522', seal: 'JO2', driver: '' },
    });
    expect(noDriver.status).toBe(200);
  });

  it('still demands the truck at the exit', async () => {
    const entered = await gateIn('MAND0004', 20, slot('B', 5, 1, 'A'));
    const noTruck = await call({
      method: 'POST',
      url: `/api/containers/${String(entered.body.id)}/exit`,
      payload: { truck: '', driver: 'سائق' },
    });
    expect(noTruck.status).toBe(400);
  });

  /** A correction may empty the same optional fields, and no others. */
  it('lets an edit clear the weight and the driver but not the bill', async () => {
    const entered = await gateIn('MAND0005', 20, slot('B', 7, 1, 'A'));
    const id = String(entered.body.id);
    const edit = (patch: Record<string, unknown>): Promise<{ status: number; body: unknown }> =>
      call({
        method: 'PATCH',
        url: `/api/containers/${id}`,
        payload: {
          number: 'MAND0005',
          bill: '3210',
          size: 20,
          notes: '',
          weight: '25000',
          truckIn: '500',
          driverIn: 'سائق',
          sealIn: 'JO1',
          enteredAt: entered.body.enteredAt,
          ...patch,
        },
      });

    const cleared = await edit({ weight: '', driverIn: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ weight: '', driverIn: '' });
    expect((await edit({ bill: '' })).status).toBe(400);
    expect((await edit({ truckIn: '' })).status).toBe(400);
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
        bill,
        notes: '',
        position: slot('B', bay, stack, 'A'),
        truck: '500',
        seal: 'JO1',
        driver: 'سائق',
        weight: '24000',
        handling: 'CRANE',
      },
    });

  it('rides in at the gate and lands on the registers', async () => {
    await withBill('BILL0001', 1, 1, '3210');
    await withBill('BILL0002', 3, 1, '3210');
    await withBill('BILL0003', 5, 1, '4187');
    // It became mandatory with everything else — a blank one is refused.
    const bare = await withBill('BILL0004', 7, 1, '');
    expect(bare.status).toBe(400);

    const range = wideRange();
    const report = await call({
      method: 'GET',
      url: `/api/reports/gate?type=IN&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    const rows = (report.body as { rows: Array<{ number: string; bill: string }> }).rows;
    expect(rows.find((row) => row.number === 'BILL0001')?.bill).toBe('3210');
    expect(rows.find((row) => row.number === 'BILL0003')?.bill).toBe('4187');
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

  it('the search box reads Arabic digits as the Western ones the yard writes', async () => {
    await withBill('BILL0009', 9, 1, '6543');
    const found = await call({
      method: 'GET',
      url: `/api/containers?q=${encodeURIComponent('٦٥٤٣')}`,
    });
    expect((found.body as { results: Array<{ number: string }> }).results[0]?.number).toBe(
      'BILL0009',
    );
  });

  it('opened with no bill, the register reads across all bills at once', async () => {
    // «عند دخول كشف البوليصة يظهر جميع المعلومات»: every container record,
    // the standing ones first, and the reader narrows by typing or searching.
    await withBill('BILL0011', 11, 1, '4444');
    await withBill('BILL0012', 13, 1, '5555');
    const sheet = await call({ method: 'GET', url: '/api/reports/bill' });
    expect(sheet.status).toBe(200);
    const rows = (sheet.body as { rows: Array<{ number: string; bill: string }> }).rows;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.find((row) => row.number === 'BILL0011')?.bill).toBe('4444');
    expect(rows.find((row) => row.number === 'BILL0012')?.bill).toBe('5555');
  });

  it('the bill can be fixed later from the edit form', async () => {
    const entered = await gateIn('BILL0008', 20, slot('B', 9, 1, 'A'));
    const edited = await call({
      method: 'PATCH',
      url: `/api/containers/${String(entered.body.id)}`,
      payload: {
        number: 'BILL0008',
        bill: '7000',
        size: 20,
        notes: '',
        weight: '1',
        truckIn: '5',
        driverIn: 'س',
        sealIn: 'J1',
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
  /** Number or bill — the owner's name is no longer anything to search by. */
  it('finds by number fragment and by bill, in-yard first', async () => {
    const entered = await gateIn('SRCH0001', 20, slot('B', 1, 1, 'A'));
    await gateOut(entered.body.id);
    await gateIn('SRCH0002', 20, slot('B', 3, 1, 'A'));

    const byNumber = await call({ method: 'GET', url: '/api/containers?q=SRCH' });
    const results = (byNumber.body as { results: Array<{ number: string; position: unknown }> })
      .results;
    expect(results).toHaveLength(2);
    expect(results[0]?.number).toBe('SRCH0002');

    // Both were received under bill 3210 by the gate helper.
    const byBill = await call({ method: 'GET', url: '/api/containers?q=3210' });
    expect((byBill.body as { results: unknown[] }).results).toHaveLength(2);
  });

  it('a literal % finds nothing rather than everything', async () => {
    await gateIn('PCNT0001', 20, slot('B', 1, 1, 'A'));
    const result = await call({ method: 'GET', url: `/api/containers?q=${encodeURIComponent('%')}` });
    expect((result.body as { results: unknown[] }).results).toHaveLength(0);
  });
});

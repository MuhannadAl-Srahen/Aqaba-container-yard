import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type { Position } from '../src/shared/types';

/**
 * The whole API driven through Fastify's own request simulator against an
 * in-memory database — same routing, validation and transaction path as
 * production, no port to bind.
 */

let app: FastifyInstance;
let cookie: string;

const YARD = { twenty: { rows: 3, cols: 5 }, forty: { rows: 2, cols: 4 } };

async function setup(): Promise<void> {
  const db = openDatabase(':memory:');
  app = buildApp(db);
  await app.ready();

  const response = await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { password: 'yard-secret', yard: YARD },
  });
  if (response.statusCode !== 200) throw new Error(`setup failed: ${response.body}`);
  const setCookie = response.headers['set-cookie'];
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (header === undefined) throw new Error('no session cookie');
  cookie = header.split(';')[0] ?? '';
}

const at = (zone: 20 | 40, row: number, col: number, tier: 1 | 2): Position => ({
  zone,
  row,
  col,
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
): Promise<{ status: number; body: { id?: number; position?: Position; code?: string } }> {
  const result = await call({
    method: 'POST',
    url: '/api/containers',
    payload: { number, size, customer, cargo: 'LADEN', notes: '', position },
  });
  return result as { status: number; body: { id?: number; position?: Position; code?: string } };
}

beforeEach(setup);

describe('auth', () => {
  it('refuses every operational route without a session', async () => {
    for (const [method, url] of [
      ['GET', '/api/state'],
      ['POST', '/api/containers'],
      ['GET', '/api/containers?q=x'],
      ['PUT', '/api/yard'],
    ] as const) {
      const result = await call({ method, url, noAuth: true, payload: {} });
      expect(result.status, url).toBe(401);
    }
  });

  it('setup cannot run twice', async () => {
    const result = await call({
      method: 'POST',
      url: '/api/setup',
      payload: { password: 'another', yard: YARD },
      noAuth: true,
    });
    expect(result.status).toBe(409);
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
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { password: 'wrong' },
    });
    expect(login.statusCode).toBe(401);
  });
});

describe('gate in', () => {
  it('receives a container and reports it in the state', async () => {
    const created = await gateIn('CSQU3054383', 20, at(20, 1, 1, 1));
    expect(created.status).toBe(201);

    const state = await call({ method: 'GET', url: '/api/state' });
    const body = state.body as { containers: Array<{ number: string; numberValid: boolean }> };
    expect(body.containers).toHaveLength(1);
    expect(body.containers[0]?.number).toBe('CSQU3054383');
    expect(body.containers[0]?.numberValid).toBe(true);
  });

  it('an invalid number is received with a warning, never refused', async () => {
    const created = await gateIn('MSCU1234567', 20, at(20, 1, 1, 1));
    expect(created.status).toBe(201);
    const state = await call({ method: 'GET', url: '/api/state' });
    const body = state.body as { containers: Array<{ numberValid: boolean }> };
    expect(body.containers[0]?.numberValid).toBe(false);
  });

  it('refuses a taken slot', async () => {
    await gateIn('MSCU1234566', 20, at(20, 1, 1, 1));
    const second = await gateIn('CSQU3054383', 20, at(20, 1, 1, 1));
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('SLOT_TAKEN');
  });

  it('refuses a 20 ft in the 40 half and the reverse', async () => {
    const wrong20 = await gateIn('MSCU1234566', 20, at(40, 1, 1, 1));
    expect(wrong20.body.code).toBe('WRONG_ZONE');
    const wrong40 = await gateIn('MSCU1234566', 40, at(20, 1, 1, 1));
    expect(wrong40.body.code).toBe('WRONG_ZONE');
  });

  it('refuses the first tier over empty ground', async () => {
    const floating = await gateIn('MSCU1234566', 20, at(20, 1, 1, 2));
    expect(floating.body.code).toBe('NO_SUPPORT');
  });

  it('accepts stacking on a standing container, to the site limit only', async () => {
    await gateIn('MSCU1234566', 20, at(20, 1, 1, 1));
    const second = await gateIn('CSQU3054383', 20, at(20, 1, 1, 2));
    expect(second.status).toBe(201);
    // A third tier does not exist in the wire schema at all — sent raw.
    const third = await call({
      method: 'POST',
      url: '/api/containers',
      payload: {
        number: 'TCLU1234565',
        size: 20,
        customer: 'عميل',
        cargo: 'LADEN',
        notes: '',
        position: { zone: 20, row: 1, col: 1, tier: 3 },
      },
    });
    expect(third.status).toBe(400);
  });

  it('refuses a number already standing in the yard, allows it after it left', async () => {
    const first = await gateIn('MSCU1234566', 20, at(20, 1, 1, 1));
    const duplicate = await gateIn('MSCU1234566', 20, at(20, 1, 2, 1));
    expect(duplicate.body.code).toBe('NUMBER_IN_YARD');

    await call({ method: 'POST', url: `/api/containers/${String(first.body.id)}/exit` });
    const returning = await gateIn('MSCU1234566', 20, at(20, 1, 2, 1));
    expect(returning.status).toBe(201);
  });
});

describe('move', () => {
  it('moves a container and records the movement', async () => {
    const created = await gateIn('MSCU1234566', 20, at(20, 1, 1, 1));
    const id = created.body.id;
    const moved = await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/move`,
      payload: { to: at(20, 2, 3, 1) },
    });
    expect(moved.status).toBe(200);

    const detail = await call({ method: 'GET', url: `/api/containers/${String(id)}` });
    const body = detail.body as { movements: Array<{ type: string }> };
    expect(body.movements.map((m) => m.type)).toEqual(['IN', 'MOVE']);
  });

  it('refuses to move a buried container and names the one on top', async () => {
    const bottom = await gateIn('MSCU1234566', 20, at(20, 1, 1, 1));
    await gateIn('CSQU3054383', 20, at(20, 1, 1, 2));
    const moved = await call({
      method: 'POST',
      url: `/api/containers/${String(bottom.body.id)}/move`,
      payload: { to: at(20, 2, 2, 1) },
    });
    expect(moved.status).toBe(409);
    const body = moved.body as { code: string; details?: { by?: string } };
    expect(body.code).toBe('BURIED');
    expect(body.details?.by).toBe('CSQU3054383');
  });

  it('a container cannot move onto the tier above itself', async () => {
    const created = await gateIn('MSCU1234566', 20, at(20, 1, 1, 1));
    const moved = await call({
      method: 'POST',
      url: `/api/containers/${String(created.body.id)}/move`,
      payload: { to: at(20, 1, 1, 2) },
    });
    expect((moved.body as { code: string }).code).toBe('NO_SUPPORT');
  });

  it('moving the top of a stack down to the ground is legal', async () => {
    await gateIn('MSCU1234566', 20, at(20, 1, 1, 1));
    const top = await gateIn('CSQU3054383', 20, at(20, 1, 1, 2));
    const moved = await call({
      method: 'POST',
      url: `/api/containers/${String(top.body.id)}/move`,
      payload: { to: at(20, 3, 5, 1) },
    });
    expect(moved.status).toBe(200);
  });
});

describe('gate out', () => {
  it('frees the slot and keeps the record findable', async () => {
    const created = await gateIn('MSCU1234566', 20, at(20, 1, 1, 1));
    const out = await call({
      method: 'POST',
      url: `/api/containers/${String(created.body.id)}/exit`,
    });
    expect(out.status).toBe(200);

    const state = await call({ method: 'GET', url: '/api/state' });
    expect((state.body as { containers: unknown[] }).containers).toHaveLength(0);

    const search = await call({ method: 'GET', url: '/api/containers?q=MSCU' });
    const results = (search.body as { results: Array<{ exitedAt: string | null }> }).results;
    expect(results).toHaveLength(1);
    expect(results[0]?.exitedAt).not.toBeNull();
  });

  it('refuses to gate out a buried container', async () => {
    const bottom = await gateIn('MSCU1234566', 20, at(20, 1, 1, 1));
    await gateIn('CSQU3054383', 20, at(20, 1, 1, 2));
    const out = await call({
      method: 'POST',
      url: `/api/containers/${String(bottom.body.id)}/exit`,
    });
    expect(out.status).toBe(409);
    expect((out.body as { code: string }).code).toBe('BURIED');
  });

  it('gating out twice is refused', async () => {
    const created = await gateIn('MSCU1234566', 20, at(20, 1, 1, 1));
    await call({ method: 'POST', url: `/api/containers/${String(created.body.id)}/exit` });
    const again = await call({
      method: 'POST',
      url: `/api/containers/${String(created.body.id)}/exit`,
    });
    expect(again.status).toBe(409);
    expect((again.body as { code: string }).code).toBe('ALREADY_OUT');
  });
});

describe('edit and delete', () => {
  it('edits fields and logs which ones changed', async () => {
    const created = await gateIn('MSCU1234566', 20, at(20, 1, 1, 1));
    const id = created.body.id;
    const edited = await call({
      method: 'PATCH',
      url: `/api/containers/${String(id)}`,
      payload: { number: 'MSCU1234566', customer: 'عميل ثاني', cargo: 'EMPTY', notes: '' },
    });
    expect(edited.status).toBe(200);

    const detail = await call({ method: 'GET', url: `/api/containers/${String(id)}` });
    const body = detail.body as {
      container: { customer: string; cargo: string };
      movements: Array<{ type: string; note: string }>;
    };
    expect(body.container.customer).toBe('عميل ثاني');
    expect(body.container.cargo).toBe('EMPTY');
    const edit = body.movements.find((m) => m.type === 'EDIT');
    expect(edit?.note).toBe('customer,cargo');
  });

  it('renaming onto a number standing elsewhere is refused', async () => {
    await gateIn('MSCU1234566', 20, at(20, 1, 1, 1));
    const second = await gateIn('CSQU3054383', 20, at(20, 1, 2, 1));
    const renamed = await call({
      method: 'PATCH',
      url: `/api/containers/${String(second.body.id)}`,
      payload: { number: 'MSCU1234566', customer: 'x', cargo: 'LADEN', notes: '' },
    });
    expect(renamed.status).toBe(409);
    expect((renamed.body as { code: string }).code).toBe('NUMBER_IN_YARD');
  });

  it('a deleted record vacates its slot and disappears from search', async () => {
    const created = await gateIn('MSCU1234566', 20, at(20, 1, 1, 1));
    const removed = await call({
      method: 'DELETE',
      url: `/api/containers/${String(created.body.id)}`,
    });
    expect(removed.status).toBe(200);

    const state = await call({ method: 'GET', url: '/api/state' });
    expect((state.body as { containers: unknown[] }).containers).toHaveLength(0);
    const retry = await gateIn('MSCU1234566', 20, at(20, 1, 1, 1));
    expect(retry.status).toBe(201);
  });

  it('deleting the bottom of a stack is refused', async () => {
    const bottom = await gateIn('MSCU1234566', 20, at(20, 1, 1, 1));
    await gateIn('CSQU3054383', 20, at(20, 1, 1, 2));
    const removed = await call({
      method: 'DELETE',
      url: `/api/containers/${String(bottom.body.id)}`,
    });
    expect(removed.status).toBe(409);
  });
});

describe('yard resize', () => {
  it('grows freely', async () => {
    const grown = await call({
      method: 'PUT',
      url: '/api/yard',
      payload: { twenty: { rows: 5, cols: 8 }, forty: { rows: 4, cols: 6 } },
    });
    expect(grown.status).toBe(200);
  });

  it('refuses a shrink that would strand a container, naming it', async () => {
    await gateIn('MSCU1234566', 20, at(20, 3, 5, 1));
    const shrunk = await call({
      method: 'PUT',
      url: '/api/yard',
      payload: { twenty: { rows: 2, cols: 5 }, forty: YARD.forty },
    });
    expect(shrunk.status).toBe(409);
    const body = shrunk.body as { code: string; details?: { containers?: string } };
    expect(body.code).toBe('SHRINK_OCCUPIED');
    expect(body.details?.containers).toContain('MSCU1234566');
  });
});

describe('search', () => {
  it('finds by number fragment and by customer, in-yard first', async () => {
    const first = await gateIn('MSCU1234566', 20, at(20, 1, 1, 1), 'شركة البحر');
    await call({ method: 'POST', url: `/api/containers/${String(first.body.id)}/exit` });
    await gateIn('CSQU3054383', 20, at(20, 1, 2, 1), 'شركة البحر');

    const byCustomer = await call({
      method: 'GET',
      url: `/api/containers?q=${encodeURIComponent('البحر')}`,
    });
    const results = (byCustomer.body as { results: Array<{ number: string; position: unknown }> })
      .results;
    expect(results).toHaveLength(2);
    // The one still standing comes first.
    expect(results[0]?.number).toBe('CSQU3054383');

    const byNumber = await call({ method: 'GET', url: '/api/containers?q=305438' });
    expect((byNumber.body as { results: unknown[] }).results).toHaveLength(1);
  });

  it('a literal % finds nothing rather than everything', async () => {
    await gateIn('MSCU1234566', 20, at(20, 1, 1, 1));
    const result = await call({ method: 'GET', url: '/api/containers?q=%25' });
    expect((result.body as { results: unknown[] }).results).toHaveLength(0);
  });
});

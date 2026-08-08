import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type { Permission, Position } from '../src/shared/types';

/**
 * The yard has staff now. Each of them signs in with a PIN, does only what
 * the owner opened for them, and leaves their name on every movement they
 * make — which is the whole point: a mistake can be traced to a person.
 */

let app: FastifyInstance;
let ownerCookie: string;

const YARD = {
  twenty: { rows: 3, placesPerTier: 4, tiers: 2 },
  forty: { rows: 2, placesPerTier: 4, tiers: 2 },
};
const B20 = 1;
const at = (block: number, row: number): Position => ({ block, row });

const cookieOf = (headers: Record<string, unknown>): string => {
  const raw = headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : (raw as string | undefined);
  if (header === undefined) throw new Error('no session cookie');
  return header.split(';')[0] ?? '';
};

async function call(options: {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  url: string;
  payload?: unknown;
  cookie?: string;
}): Promise<{ status: number; body: unknown }> {
  const response = await app.inject({
    method: options.method,
    url: options.url,
    ...(options.payload === undefined ? {} : { payload: options.payload as object }),
    headers: options.cookie === undefined ? {} : { cookie: options.cookie },
  });
  return {
    status: response.statusCode,
    body: response.body === '' ? null : (JSON.parse(response.body) as unknown),
  };
}

/** Create an employee and sign in as them; returns their cookie and id. */
async function hire(
  name: string,
  pin: string,
  permissions: readonly Permission[],
): Promise<{ id: number; cookie: string }> {
  const made = await call({
    method: 'POST',
    url: '/api/users',
    payload: { name, pin, permissions },
    cookie: ownerCookie,
  });
  if (made.status !== 201) throw new Error(`hire failed: ${JSON.stringify(made.body)}`);
  const id = (made.body as { id: number }).id;
  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { userId: id, pin },
  });
  if (login.statusCode !== 200) throw new Error('sign-in failed');
  return { id, cookie: cookieOf(login.headers as Record<string, unknown>) };
}

const gateInPayload = (number: string, position: Position): Record<string, unknown> => ({
  number,
  size: 20,
  customer: 'شركة النورس',
  notes: '',
  position,
  truck: '500',
  seal: 'JO100001',
  driver: '',
  weight: '',
});

beforeEach(async () => {
  const db = openDatabase(':memory:');
  app = buildApp(db);
  await app.ready();
  const response = await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { password: 'yard-secret', yard: YARD },
  });
  if (response.statusCode !== 200) throw new Error('setup failed');
  ownerCookie = cookieOf(response.headers as Record<string, unknown>);
});

describe('the staff list', () => {
  it('the owner adds employees; the sign-in screen learns their names', async () => {
    await hire('وسام', '1234', ['GATE_IN']);
    await hire('نور', '5678', ['GATE_IN', 'GATE_OUT']);

    const boot = await call({ method: 'GET', url: '/api/boot' });
    const staff = (boot.body as { staff: Array<{ name: string }> }).staff;
    expect(staff.map((s) => s.name)).toEqual(['وسام', 'نور']);
  });

  it('two employees cannot share a name while both work here', async () => {
    await hire('وسام', '1234', []);
    const twin = await call({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'وسام', pin: '9999', permissions: [] },
      cookie: ownerCookie,
    });
    expect(twin.status).toBe(409);
    expect((twin.body as { code: string }).code).toBe('USER_EXISTS');
  });

  it('a removed employee cannot sign in, and their session dies with them', async () => {
    const wesam = await hire('وسام', '1234', ['GATE_IN']);
    expect((await call({ method: 'GET', url: '/api/me', cookie: wesam.cookie })).status).toBe(200);

    await call({
      method: 'DELETE',
      url: `/api/users/${String(wesam.id)}`,
      cookie: ownerCookie,
    });
    expect((await call({ method: 'GET', url: '/api/me', cookie: wesam.cookie })).status).toBe(401);
    const again = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { userId: wesam.id, pin: '1234' },
    });
    expect(again.statusCode).toBe(401);
  });

  it('a wrong PIN is refused, and the owner can replace a forgotten one', async () => {
    const wesam = await hire('وسام', '1234', []);
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { userId: wesam.id, pin: '0000' },
    });
    expect(wrong.statusCode).toBe(401);

    await call({
      method: 'PATCH',
      url: `/api/users/${String(wesam.id)}`,
      payload: { name: 'وسام', permissions: [], pin: '4321' },
      cookie: ownerCookie,
    });
    const fresh = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { userId: wesam.id, pin: '4321' },
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('a PIN edit is optional: leaving it out keeps the old one', async () => {
    const wesam = await hire('وسام', '1234', ['GATE_IN']);
    await call({
      method: 'PATCH',
      url: `/api/users/${String(wesam.id)}`,
      payload: { name: 'وسام العلي', permissions: ['MOVE'] },
      cookie: ownerCookie,
    });
    const still = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { userId: wesam.id, pin: '1234' },
    });
    expect(still.statusCode).toBe(200);
    const me = await call({ method: 'GET', url: '/api/me', cookie: wesam.cookie });
    expect(me.body).toMatchObject({ name: 'وسام العلي', owner: false, permissions: ['MOVE'] });
  });

  it('only a four-to-six digit PIN is accepted', async () => {
    for (const pin of ['12', '1234567', 'abcd', '']) {
      const bad = await call({
        method: 'POST',
        url: '/api/users',
        payload: { name: `عامل${pin}`, pin, permissions: [] },
        cookie: ownerCookie,
      });
      expect(bad.status, pin).toBe(400);
    }
  });
});

describe('permissions', () => {
  it('a permission opens exactly its own operation and nothing else', async () => {
    const nour = await hire('نور', '5678', ['GATE_IN']);

    const received = await call({
      method: 'POST',
      url: '/api/containers',
      payload: gateInPayload('MSCU1234566', at(B20, 1)),
      cookie: nour.cookie,
    });
    expect(received.status).toBe(201);
    const id = (received.body as { id: number }).id;

    // She may receive, and that is all she may do.
    const out = await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/exit`,
      payload: { truck: '522', seal: 'JO100002', driver: '' },
      cookie: nour.cookie,
    });
    expect(out.status).toBe(403);
    expect((out.body as { code: string }).code).toBe('FORBIDDEN');

    for (const [method, url, payload] of [
      ['POST', `/api/containers/${String(id)}/move`, { to: at(B20, 2) }],
      ['PATCH', `/api/containers/${String(id)}`, { number: 'MSCU1234566', customer: 'x', size: 20, notes: '' }],
      ['DELETE', `/api/containers/${String(id)}`, undefined],
      ['GET', '/api/reports/standing', undefined],
    ] as const) {
      const refused = await call({ method, url, payload, cookie: nour.cookie });
      expect(refused.status, url).toBe(403);
    }
  });

  it('the yard editor and the staff list are the owner alone', async () => {
    // Even an employee holding every grantable permission is still not the
    // owner: these are never a checkbox.
    const ayman = await hire('ايمن', '1111', [
      'GATE_IN',
      'MOVE',
      'GATE_OUT',
      'EDIT',
      'DELETE',
      'REPORTS',
    ]);
    for (const [method, url, payload] of [
      ['PUT', '/api/yard', { blocks: [] }],
      ['GET', '/api/users', undefined],
      ['POST', '/api/users', { name: 'x', pin: '1234', permissions: [] }],
    ] as const) {
      const refused = await call({ method, url, payload, cookie: ayman.cookie });
      expect(refused.status, url).toBe(403);
    }
  });

  it('the owner passes everything without a checkbox anywhere', async () => {
    const me = await call({ method: 'GET', url: '/api/me', cookie: ownerCookie });
    expect(me.body).toMatchObject({ owner: true, name: 'المالك' });
    const received = await call({
      method: 'POST',
      url: '/api/containers',
      payload: gateInPayload('MSCU1234566', at(B20, 1)),
      cookie: ownerCookie,
    });
    expect(received.status).toBe(201);
  });
});

describe('the audit trail', () => {
  it('every movement carries the name of whoever made it', async () => {
    const wesam = await hire('وسام', '1234', ['GATE_IN', 'MOVE', 'GATE_OUT', 'REPORTS']);
    const received = await call({
      method: 'POST',
      url: '/api/containers',
      payload: gateInPayload('MSCU1234566', at(B20, 1)),
      cookie: wesam.cookie,
    });
    const id = (received.body as { id: number }).id;
    await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/move`,
      payload: { to: at(B20, 2) },
      cookie: ownerCookie,
    });

    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const log = await call({
      method: 'GET',
      url: `/api/reports/log?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      cookie: wesam.cookie,
    });
    const rows = (log.body as { rows: Array<{ type: string; user: string }> }).rows;
    expect(rows.find((r) => r.type === 'IN')?.user).toBe('وسام');
    expect(rows.find((r) => r.type === 'MOVE')?.user).toBe('المالك');

    // The entry register names him too, and so does the standing sheet.
    const gate = await call({
      method: 'GET',
      url: `/api/reports/gate?type=IN&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      cookie: wesam.cookie,
    });
    expect((gate.body as { rows: Array<{ user: string }> }).rows[0]?.user).toBe('وسام');
    const standing = await call({
      method: 'GET',
      url: '/api/reports/standing',
      cookie: wesam.cookie,
    });
    expect((standing.body as { rows: Array<{ user: string }> }).rows[0]?.user).toBe('وسام');
  });

  it('a departed employee still signs the registers they worked', async () => {
    const nour = await hire('نور', '5678', ['GATE_IN']);
    await call({
      method: 'POST',
      url: '/api/containers',
      payload: gateInPayload('MSCU1234566', at(B20, 1)),
      cookie: nour.cookie,
    });
    await call({ method: 'DELETE', url: `/api/users/${String(nour.id)}`, cookie: ownerCookie });

    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const gate = await call({
      method: 'GET',
      url: `/api/reports/gate?type=IN&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      cookie: ownerCookie,
    });
    expect((gate.body as { rows: Array<{ user: string }> }).rows[0]?.user).toBe('نور');
  });
});

describe('the session', () => {
  it('a cookie cannot be edited into somebody else', async () => {
    const nour = await hire('نور', '5678', ['GATE_IN']);
    // Swap the actor in the signed token and the signature no longer matches.
    const forged = nour.cookie.replace(/=\d+\./, '=0.');
    expect(forged).not.toBe(nour.cookie);
    const probe = await call({ method: 'GET', url: '/api/me', cookie: forged });
    expect(probe.status).toBe(401);
  });
});

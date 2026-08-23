import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type {
  CarrierDto,
  GateReportRow,
  Position,
  TruckDto,
  UnassignedPlateRow,
} from '../src/shared/types';

/**
 * سجل الناقلين: the fleet the owner dictated ships inside the update, the
 * gate recognises a registered plate however it is spelled, and «كشف سيارات
 * بناءً على الناقل» gathers a whole fleet's trips. Everything sits beside
 * the gate records — registering and re-registering trucks rewrites nothing.
 */

let db: DatabaseSync;
let app: FastifyInstance;
let cookie = '';

interface ReplyBody {
  id: number;
  code: string;
  name: string;
  carriers: CarrierDto[];
  trucks: TruckDto[];
  rows: Array<GateReportRow & { statement: 'IN' | 'OUT' }> & UnassignedPlateRow[];
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

const gateIn = async (
  number: string,
  position: Position,
  truck: string,
  driver = '',
): Promise<Reply> =>
  call({
    method: 'POST',
    url: '/api/containers',
    payload: {
      number,
      size: 20,
      bill: '3210',
      notes: '',
      position,
      truck,
      seal: 'JO41100',
      driver,
      weight: '',
      handling: 'CRANE',
    },
  });

const fleet = async (): Promise<Reply> => call({ method: 'GET', url: '/api/fleet' });

describe('the seeded fleet', () => {
  it('ships the two carriers and the 27 trucks the owner dictated, code 60', async () => {
    const { status, body } = await fleet();
    expect(status).toBe(200);
    expect(body.carriers.map((c) => c.name)).toEqual(['بهاء أبو الربع', 'عادل أبو غليون']);
    expect(body.trucks).toHaveLength(27);
    const bahaa = body.carriers[0];
    expect(body.trucks.every((t) => t.code === '60' && t.carrierId === bahaa?.id)).toBe(true);
    expect(
      body.trucks.find((t) => t.number === '84785')?.driver,
    ).toBe('عطالله علي');
  });

  it('seeds once: reopening the same file neither duplicates nor resurrects', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'yard-fleet-')), 'yard.db');
    const first = openDatabase(file);
    const count = (handle: DatabaseSync): number =>
      (
        handle.prepare('SELECT COUNT(*) AS n FROM trucks WHERE deleted_at IS NULL').get() as {
          n: number;
        }
      ).n;
    expect(count(first)).toBe(27);
    // The owner strikes one truck out; an update must not bring it back.
    first.prepare("UPDATE trucks SET deleted_at = '2026-08-23T00:00:00Z' WHERE number = '84785'").run();
    first.close();
    const second = openDatabase(file);
    expect(count(second)).toBe(26);
    expect(
      (second.prepare('SELECT COUNT(*) AS n FROM carriers').get() as { n: number }).n,
    ).toBe(2);
    second.close();
  });
});

describe('carrier and truck management', () => {
  it('is the owner’s alone; reading the fleet needs only a session', async () => {
    await call({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'وسام', pin: '4321', permissions: ['GATE_IN', 'REPORTS'] },
    });
    const staff = (await call({ method: 'GET', url: '/api/users' })).body as unknown as {
      users: Array<{ id: number }>;
    };
    await call({ method: 'POST', url: '/api/logout' });
    cookie = '';
    const shut = await fleet();
    expect(shut.status).toBe(401);
    await call({
      method: 'POST',
      url: '/api/login',
      payload: { userId: staff.users[0]?.id, pin: '4321' },
    });
    expect((await fleet()).status).toBe(200);
    const denied = await call({
      method: 'POST',
      url: '/api/carriers',
      payload: { name: 'ناقل جديد' },
    });
    expect(denied.status).toBe(403);
    const deniedList = await call({ method: 'GET', url: '/api/fleet/unassigned' });
    expect(deniedList.status).toBe(403);
  });

  it('adds, renames, and refuses a duplicate carrier name', async () => {
    const added = await call({
      method: 'POST',
      url: '/api/carriers',
      payload: { name: 'ناقل ثالث' },
    });
    expect(added.status).toBe(201);
    const twin = await call({
      method: 'POST',
      url: '/api/carriers',
      payload: { name: 'بهاء أبو الربع' },
    });
    expect(twin.status).toBe(409);
    expect(twin.body.code).toBe('NAME_TAKEN');
    const renamed = await call({
      method: 'PATCH',
      url: `/api/carriers/${String(added.body.id)}`,
      payload: { name: 'ناقل ثالث معدّل' },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('ناقل ثالث معدّل');
  });

  it('a carrier still holding trucks cannot be struck out; an empty one can', async () => {
    const { body } = await fleet();
    const bahaa = body.carriers[0];
    const adel = body.carriers[1];
    const refusal = await call({ method: 'DELETE', url: `/api/carriers/${String(bahaa?.id)}` });
    expect(refusal.status).toBe(409);
    expect(refusal.body.code).toBe('CARRIER_HAS_TRUCKS');
    const emptied = await call({ method: 'DELETE', url: `/api/carriers/${String(adel?.id)}` });
    expect(emptied.status).toBe(200);
    const after = await fleet();
    expect(after.body.carriers.map((c) => c.name)).toEqual(['بهاء أبو الربع']);
  });

  it('registers a truck, refuses the same plate twice in any spelling, and moves one — «توزيع»', async () => {
    const { body } = await fleet();
    const adel = body.carriers[1];
    const added = await call({
      method: 'POST',
      url: '/api/trucks',
      payload: { carrierId: adel?.id, code: '26', number: '5511', driver: 'سائق عادل' },
    });
    expect(added.status).toBe(201);
    // The same physical plate under the other carrier, spelled without a code.
    const twin = await call({
      method: 'POST',
      url: '/api/trucks',
      payload: { carrierId: body.carriers[0]?.id, code: '', number: '26-5511', driver: '' },
    });
    expect(twin.status).toBe(409);
    expect(twin.body.code).toBe('TRUCK_EXISTS');
    // Distribution: hand a seeded truck to عادل.
    const moved = await call({
      method: 'PATCH',
      url: `/api/trucks/${String(body.trucks[0]?.id)}`,
      payload: {
        carrierId: adel?.id,
        code: body.trucks[0]?.code,
        number: body.trucks[0]?.number,
        driver: body.trucks[0]?.driver,
      },
    });
    expect(moved.status).toBe(200);
    const after = await fleet();
    expect(after.body.trucks.filter((t) => t.carrierId === adel?.id)).toHaveLength(2);
  });
});

describe('توزيع السيارات — the unassigned bench', () => {
  it('lists gate plates no carrier owns, with trips and the latest driver', async () => {
    await gateIn('UNAS0011', slot(1, 1), '11-22334', 'سائق مجهول');
    await gateIn('UNAS0022', slot(1, 2), '11 22334');
    // A registered plate, spelled with its code: already owned, stays off the bench.
    await gateIn('UNAS0033', slot(1, 3), '60-84785');
    const { status, body } = await call({ method: 'GET', url: '/api/fleet/unassigned' });
    expect(status).toBe(200);
    const rows = body.rows as UnassignedPlateRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.trips).toBe(2);
    expect(rows[0]?.driver).toBe('سائق مجهول');
    // Assigning it takes it off the bench.
    const { body: current } = await fleet();
    await call({
      method: 'POST',
      url: '/api/trucks',
      payload: {
        carrierId: current.carriers[1]?.id,
        code: '11',
        number: '22334',
        driver: 'سائق مجهول',
      },
    });
    const after = await call({ method: 'GET', url: '/api/fleet/unassigned' });
    expect((after.body.rows as UnassignedPlateRow[])).toHaveLength(0);
  });
});

describe('كشف سيارات الناقل', () => {
  const range = (): string => {
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  };

  it('gathers every spelling of the fleet’s plates, and nothing else', async () => {
    await gateIn('CARR0017', slot(3, 1), '60-84785', 'عطالله علي');
    await gateIn('CARR0028', slot(3, 2), '84785');
    await gateIn('CARR0039', slot(3, 3), '٦٠٨٤٧٨٥');
    await gateIn('CARR0040', slot(3, 4), '99-11111', 'غريب');
    const { body: current } = await fleet();
    const bahaa = current.carriers[0];
    const { status, body } = await call({
      method: 'GET',
      url: `/api/reports/truck?carrier=${String(bahaa?.id)}&${range()}`,
    });
    expect(status).toBe(200);
    const rows = body.rows as Array<GateReportRow & { statement: 'IN' | 'OUT' }>;
    expect(rows).toHaveLength(3);
    // Each row keeps the plate exactly as the gate wrote it.
    expect(rows.map((row) => row.truck).sort()).toEqual(['60-84785', '84785', '٦٠٨٤٧٨٥']);
    expect(rows.every((row) => row.statement === 'IN')).toBe(true);
  });

  it('follows a moved truck: the register reads by the CURRENT carrier', async () => {
    // «تأكد من موضوع النقل»: a truck handed to another carrier takes its
    // whole gate history with it — the register asks who owns the plate NOW.
    await gateIn('MOVE0026', slot(7, 1), '60-84785', 'عطالله علي');
    const { body: current } = await fleet();
    const bahaa = current.carriers[0];
    const adel = current.carriers[1];
    const truck = current.trucks.find((t) => t.number === '84785');
    if (truck === undefined) throw new Error('84785 missing from the seed');
    await call({
      method: 'PATCH',
      url: `/api/trucks/${String(truck.id)}`,
      payload: { carrierId: adel?.id, code: truck.code, number: truck.number, driver: truck.driver },
    });
    const his = await call({
      method: 'GET',
      url: `/api/reports/truck?carrier=${String(adel?.id)}&${range()}`,
    });
    const hers = await call({
      method: 'GET',
      url: `/api/reports/truck?carrier=${String(bahaa?.id)}&${range()}`,
    });
    expect((his.body.rows as unknown[]).length).toBe(1);
    expect((hers.body.rows as unknown[]).length).toBe(0);
  });

  it('an unknown carrier is refused by name', async () => {
    const missing = await call({ method: 'GET', url: `/api/reports/truck?carrier=999&${range()}` });
    expect(missing.status).toBe(404);
  });

  it('the single-plate register still answers as before', async () => {
    await gateIn('CARR0051', slot(5, 1), '411');
    const { status, body } = await call({
      method: 'GET',
      url: `/api/reports/truck?truck=411&${range()}`,
    });
    expect(status).toBe(200);
    expect(body.rows).toHaveLength(1);
  });
});

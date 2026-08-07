import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type { BlockConfig, Position } from '../src/shared/types';

/**
 * The whole API driven through Fastify's own request simulator against an
 * in-memory database — same routing, validation and transaction path as
 * production, no port to bind.
 */

let app: FastifyInstance;
let cookie: string;

const YARD = { twenty: { rows: 3, cols: 5 }, forty: { rows: 2, cols: 4 } };
/** Setup inserts the 20 block first, so ids are deterministic. */
const B20 = 1;
const B40 = 2;

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

const at = (block: number, row: number, col: number, tier: 1 | 2): Position => ({
  block,
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
): Promise<{
  status: number;
  body: { id?: number; position?: Position; code?: string; cardIn?: number };
}> {
  const result = await call({
    method: 'POST',
    url: '/api/containers',
    payload: {
      number,
      size,
      customer,
      cargo: 'LADEN',
      notes: '',
      position,
      truck: '500',
      driver: 'أبو أحمد',
      weight: '25',
    },
  });
  return result as {
    status: number;
    body: { id?: number; position?: Position; code?: string; cardIn?: number };
  };
}

async function gateOut(id: number | undefined): Promise<{ status: number; body: unknown }> {
  return call({
    method: 'POST',
    url: `/api/containers/${String(id)}/exit`,
    payload: { truck: '522', driver: '' },
  });
}

async function currentBlocks(): Promise<BlockConfig[]> {
  const state = await call({ method: 'GET', url: '/api/state' });
  return (state.body as { yard: { blocks: BlockConfig[] } }).yard.blocks;
}

async function putLayout(blocks: unknown[]): Promise<{ status: number; body: unknown }> {
  return call({ method: 'PUT', url: '/api/yard', payload: { blocks } });
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

describe('setup layout', () => {
  it('creates the two named blocks and reports their names', async () => {
    const blocks = await currentBlocks();
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ id: B20, size: 20, rows: 3, cols: 5 });
    expect(blocks[1]).toMatchObject({ id: B40, size: 40, rows: 2, cols: 4 });

    const state = await call({ method: 'GET', url: '/api/state' });
    const names = (state.body as { blockNames: Record<string, string> }).blockNames;
    expect(names[String(B20)]).toBe('منطقة 20');
    expect(names[String(B40)]).toBe('منطقة 40');
  });
});

describe('gate in', () => {
  it('receives a container and reports it in the state', async () => {
    const created = await gateIn('CSQU3054383', 20, at(B20, 1, 1, 1));
    expect(created.status).toBe(201);

    const state = await call({ method: 'GET', url: '/api/state' });
    const body = state.body as { containers: Array<{ number: string; numberValid: boolean }> };
    expect(body.containers).toHaveLength(1);
    expect(body.containers[0]?.number).toBe('CSQU3054383');
    expect(body.containers[0]?.numberValid).toBe(true);
  });

  it('an invalid number is received with a warning, never refused', async () => {
    const created = await gateIn('MSCU1234567', 20, at(B20, 1, 1, 1));
    expect(created.status).toBe(201);
    const state = await call({ method: 'GET', url: '/api/state' });
    const body = state.body as { containers: Array<{ numberValid: boolean }> };
    expect(body.containers[0]?.numberValid).toBe(false);
  });

  it('refuses a taken slot', async () => {
    await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1));
    const second = await gateIn('CSQU3054383', 20, at(B20, 1, 1, 1));
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('SLOT_TAKEN');
  });

  it('refuses a 20 ft in a 40 block and the reverse', async () => {
    const wrong20 = await gateIn('MSCU1234566', 20, at(B40, 1, 1, 1));
    expect(wrong20.body.code).toBe('WRONG_ZONE');
    const wrong40 = await gateIn('MSCU1234566', 40, at(B20, 1, 1, 1));
    expect(wrong40.body.code).toBe('WRONG_ZONE');
  });

  it('refuses a position in a block that does not exist', async () => {
    const ghost = await gateIn('MSCU1234566', 20, at(99, 1, 1, 1));
    expect(ghost.status).toBe(409);
    expect(ghost.body.code).toBe('OUT_OF_BOUNDS');
  });

  it('refuses the first tier over empty ground', async () => {
    const floating = await gateIn('MSCU1234566', 20, at(B20, 1, 1, 2));
    expect(floating.body.code).toBe('NO_SUPPORT');
  });

  it('accepts stacking on a standing container, to the site limit only', async () => {
    await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1));
    const second = await gateIn('CSQU3054383', 20, at(B20, 1, 1, 2));
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
        position: { block: B20, row: 1, col: 1, tier: 3 },
      },
    });
    expect(third.status).toBe(400);
  });

  it('refuses a number already standing in the yard, allows it after it left', async () => {
    const first = await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1));
    const duplicate = await gateIn('MSCU1234566', 20, at(B20, 1, 2, 1));
    expect(duplicate.body.code).toBe('NUMBER_IN_YARD');

    await gateOut(first.body.id);
    const returning = await gateIn('MSCU1234566', 20, at(B20, 1, 2, 1));
    expect(returning.status).toBe(201);
  });
});

describe('move', () => {
  it('moves a container and records the movement', async () => {
    const created = await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1));
    const id = created.body.id;
    const moved = await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/move`,
      payload: { to: at(B20, 2, 3, 1) },
    });
    expect(moved.status).toBe(200);

    const detail = await call({ method: 'GET', url: `/api/containers/${String(id)}` });
    const body = detail.body as { movements: Array<{ type: string }> };
    expect(body.movements.map((m) => m.type)).toEqual(['IN', 'MOVE']);
  });

  it('refuses to move a buried container and names the one on top', async () => {
    const bottom = await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1));
    await gateIn('CSQU3054383', 20, at(B20, 1, 1, 2));
    const moved = await call({
      method: 'POST',
      url: `/api/containers/${String(bottom.body.id)}/move`,
      payload: { to: at(B20, 2, 2, 1) },
    });
    expect(moved.status).toBe(409);
    const body = moved.body as { code: string; details?: { by?: string } };
    expect(body.code).toBe('BURIED');
    expect(body.details?.by).toBe('CSQU3054383');
  });

  it('a container cannot move onto the tier above itself', async () => {
    const created = await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1));
    const moved = await call({
      method: 'POST',
      url: `/api/containers/${String(created.body.id)}/move`,
      payload: { to: at(B20, 1, 1, 2) },
    });
    expect((moved.body as { code: string }).code).toBe('NO_SUPPORT');
  });

  it('moving the top of a stack down to the ground is legal', async () => {
    await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1));
    const top = await gateIn('CSQU3054383', 20, at(B20, 1, 1, 2));
    const moved = await call({
      method: 'POST',
      url: `/api/containers/${String(top.body.id)}/move`,
      payload: { to: at(B20, 3, 5, 1) },
    });
    expect(moved.status).toBe(200);
  });
});

describe('gate out', () => {
  it('frees the slot and keeps the record findable', async () => {
    const created = await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1));
    const out = await gateOut(created.body.id);
    expect(out.status).toBe(200);

    const state = await call({ method: 'GET', url: '/api/state' });
    expect((state.body as { containers: unknown[] }).containers).toHaveLength(0);

    const search = await call({ method: 'GET', url: '/api/containers?q=MSCU' });
    const results = (search.body as { results: Array<{ exitedAt: string | null }> }).results;
    expect(results).toHaveLength(1);
    expect(results[0]?.exitedAt).not.toBeNull();
  });

  it('refuses to gate out a buried container', async () => {
    const bottom = await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1));
    await gateIn('CSQU3054383', 20, at(B20, 1, 1, 2));
    const out = await gateOut(bottom.body.id);
    expect(out.status).toBe(409);
    expect((out.body as { code: string }).code).toBe('BURIED');
  });

  it('gating out twice is refused', async () => {
    const created = await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1));
    await gateOut(created.body.id);
    const again = await gateOut(created.body.id);
    expect(again.status).toBe(409);
    expect((again.body as { code: string }).code).toBe('ALREADY_OUT');
  });
});

describe('edit and delete', () => {
  it('edits fields and logs which ones changed', async () => {
    const created = await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1));
    const id = created.body.id;
    const edited = await call({
      method: 'PATCH',
      url: `/api/containers/${String(id)}`,
      payload: { number: 'MSCU1234566', customer: 'عميل ثاني', cargo: 'EMPTY', size: 20, notes: '' },
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
    await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1));
    const second = await gateIn('CSQU3054383', 20, at(B20, 1, 2, 1));
    const renamed = await call({
      method: 'PATCH',
      url: `/api/containers/${String(second.body.id)}`,
      payload: { number: 'MSCU1234566', customer: 'x', cargo: 'LADEN', size: 20, notes: '' },
    });
    expect(renamed.status).toBe(409);
    expect((renamed.body as { code: string }).code).toBe('NUMBER_IN_YARD');
  });

  it('a size flip is refused while standing in a mismatched block', async () => {
    const created = await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1));
    const flipped = await call({
      method: 'PATCH',
      url: `/api/containers/${String(created.body.id)}`,
      payload: { number: 'MSCU1234566', customer: 'عميل', cargo: 'LADEN', size: 40, notes: '' },
    });
    expect(flipped.status).toBe(409);
    expect((flipped.body as { code: string }).code).toBe('WRONG_ZONE');

    // Once out of the yard, the paperwork may be corrected freely.
    await gateOut(created.body.id);
    const corrected = await call({
      method: 'PATCH',
      url: `/api/containers/${String(created.body.id)}`,
      payload: { number: 'MSCU1234566', customer: 'عميل', cargo: 'LADEN', size: 40, notes: '' },
    });
    expect(corrected.status).toBe(200);
    expect((corrected.body as { size: number }).size).toBe(40);
  });

  it('a deleted record vacates its slot and disappears from search', async () => {
    const created = await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1));
    const removed = await call({
      method: 'DELETE',
      url: `/api/containers/${String(created.body.id)}`,
    });
    expect(removed.status).toBe(200);

    const state = await call({ method: 'GET', url: '/api/state' });
    expect((state.body as { containers: unknown[] }).containers).toHaveLength(0);
    const retry = await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1));
    expect(retry.status).toBe(201);
  });

  it('deleting the bottom of a stack is refused', async () => {
    const bottom = await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1));
    await gateIn('CSQU3054383', 20, at(B20, 1, 1, 2));
    const removed = await call({
      method: 'DELETE',
      url: `/api/containers/${String(bottom.body.id)}`,
    });
    expect(removed.status).toBe(409);
  });
});

describe('yard layout', () => {
  it('grows, moves and turns freely — containers ride along', async () => {
    await gateIn('MSCU1234566', 20, at(B20, 3, 5, 1));
    const blocks = await currentBlocks();
    const changed = blocks.map((block) =>
      block.id === B20
        ? { ...block, rows: 5, cols: 8, x: block.x + 400, y: block.y + 200, angle: 45 }
        : block,
    );
    const saved = await putLayout(changed);
    expect(saved.status).toBe(200);

    const state = await call({ method: 'GET', url: '/api/state' });
    const body = state.body as {
      yard: { blocks: BlockConfig[] };
      containers: Array<{ position: Position | null }>;
    };
    expect(body.yard.blocks.find((b) => b.id === B20)).toMatchObject({ rows: 5, angle: 45 });
    expect(body.containers[0]?.position).toMatchObject({ block: B20, row: 3, col: 5 });
  });

  it('refuses a shrink that would strand a container, naming it', async () => {
    await gateIn('MSCU1234566', 20, at(B20, 3, 5, 1));
    const blocks = await currentBlocks();
    const shrunk = await putLayout(
      blocks.map((block) => (block.id === B20 ? { ...block, rows: 2 } : block)),
    );
    expect(shrunk.status).toBe(409);
    const body = shrunk.body as { code: string; details?: { containers?: string } };
    expect(body.code).toBe('SHRINK_OCCUPIED');
    expect(body.details?.containers).toContain('MSCU1234566');
  });

  it('refuses overlapping blocks', async () => {
    const blocks = await currentBlocks();
    const first = blocks[0];
    if (first === undefined) throw new Error('fixture');
    const piled = await putLayout(
      blocks.map((block) =>
        block.id === B40 ? { ...block, x: first.x + 10, y: first.y + 10 } : block,
      ),
    );
    expect(piled.status).toBe(409);
    expect((piled.body as { code: string }).code).toBe('BLOCK_OVERLAP');
  });

  it('refuses two blocks with the same name', async () => {
    const blocks = await currentBlocks();
    const renamed = await putLayout(blocks.map((block) => ({ ...block, name: 'الساحة' })));
    expect(renamed.status).toBe(409);
    expect((renamed.body as { code: string }).code).toBe('NAME_TAKEN');
  });

  it('refuses deleting a block that still holds containers', async () => {
    await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1));
    const blocks = await currentBlocks();
    const without = await putLayout(blocks.filter((block) => block.id !== B20));
    expect(without.status).toBe(409);
    expect((without.body as { code: string }).code).toBe('BLOCK_NOT_EMPTY');
  });

  it('deletes an empty block, adds a new one, and renames another', async () => {
    const blocks = await currentBlocks();
    const kept = blocks.filter((block) => block.id !== B40);
    const saved = await putLayout([
      ...kept.map((block) => ({ ...block, name: 'المخزن الشمالي' })),
      { name: 'جنب البوابة', size: 40, rows: 2, cols: 3, x: 0, y: 2000, angle: 15 },
    ]);
    expect(saved.status).toBe(200);

    const after = await currentBlocks();
    expect(after).toHaveLength(2);
    expect(after.map((b) => b.name)).toEqual(['المخزن الشمالي', 'جنب البوابة']);

    // The deleted block's name still resolves for history.
    const state = await call({ method: 'GET', url: '/api/state' });
    const names = (state.body as { blockNames: Record<string, string> }).blockNames;
    expect(names[String(B40)]).toBe('منطقة 40');
  });

  it('accepts any whole degree, refuses fractional or out-of-range angles', async () => {
    const blocks = await currentBlocks();
    const free = await putLayout(
      blocks.map((block) =>
        block.id === B20 ? { ...block, angle: 37, y: block.y - 800 } : block,
      ),
    );
    expect(free.status).toBe(200);

    const fractional = await putLayout(
      blocks.map((block) => (block.id === B20 ? { ...block, angle: 22.5 } : block)),
    );
    expect(fractional.status).toBe(400);

    const wild = await putLayout(
      blocks.map((block) => (block.id === B20 ? { ...block, angle: 400 } : block)),
    );
    expect(wild.status).toBe(400);
  });

  it('a mixed block takes both sizes, chosen at the gate', async () => {
    const blocks = await currentBlocks();
    const saved = await putLayout([
      ...blocks,
      { name: 'مختلطة', size: 0, rows: 2, cols: 2, x: 0, y: 3000, angle: 0 },
    ]);
    expect(saved.status).toBe(200);
    const mixedId = (saved.body as { blocks: BlockConfig[] }).blocks.find(
      (b) => b.name === 'مختلطة',
    )?.id;
    if (mixedId === undefined) throw new Error('mixed block missing');

    const small = await gateIn('MSCU1234', 20, at(mixedId, 1, 1, 1));
    expect(small.status).toBe(201);
    const big = await gateIn('TGHU5678', 40, at(mixedId, 1, 2, 1));
    expect(big.status).toBe(201);

    // Converting an occupied block to mixed is free; back to one size is
    // refused while the other size still stands in it.
    const after = await currentBlocks();
    const to20 = await putLayout(
      after.map((b) => (b.id === mixedId ? { ...b, size: 20 } : b)),
    );
    expect(to20.status).toBe(409);
    expect((to20.body as { code: string }).code).toBe('SHRINK_OCCUPIED');
  });

  it('the dev reset wipes containers and counters, keeps the yard', async () => {
    await gateIn('MSCU1234', 20, at(B20, 1, 1, 1));
    const reset = await call({ method: 'POST', url: '/api/dev/reset', payload: {} });
    expect(reset.status).toBe(200);

    const state = await call({ method: 'GET', url: '/api/state' });
    const body = state.body as { containers: unknown[]; yard: { blocks: unknown[] } };
    expect(body.containers).toHaveLength(0);
    expect(body.yard.blocks.length).toBeGreaterThan(0);

    const again = await gateIn('MSCU1234', 20, at(B20, 1, 1, 1));
    expect(again.body.cardIn).toBe(1);
  });

  it('refuses an unknown block id', async () => {
    const blocks = await currentBlocks();
    const forged = await putLayout([...blocks, { ...blocks[0], id: 77, name: 'شبح', y: 5000 }]);
    expect(forged.status).toBe(404);
  });
});

describe('gate paperwork', () => {
  it('a truckless gate-in is refused — the owner made the truck mandatory', async () => {
    const result = await call({
      method: 'POST',
      url: '/api/containers',
      payload: {
        number: 'MSCU1234',
        size: 20,
        customer: 'عميل',
        cargo: 'LADEN',
        notes: '',
        position: at(B20, 1, 1, 1),
      },
    });
    expect(result.status).toBe(400);
  });

  it('the local 4+4 number form is valid, not a warning', async () => {
    const created = await gateIn('MSCU 1234', 20, at(B20, 1, 1, 1));
    expect(created.status).toBe(201);
    const state = await call({ method: 'GET', url: '/api/state' });
    const body = state.body as { containers: Array<{ number: string; numberValid: boolean }> };
    expect(body.containers[0]?.number).toBe('MSCU1234');
    expect(body.containers[0]?.numberValid).toBe(true);
  });

  it('card serials count up from 1, separately per direction', async () => {
    const first = await gateIn('MSCU1234', 20, at(B20, 1, 1, 1));
    const second = await gateIn('CSQU5678', 20, at(B20, 1, 2, 1));
    expect(first.body.cardIn).toBe(1);
    expect(second.body.cardIn).toBe(2);

    const out = await gateOut(first.body.id);
    const outBody = out.body as { cardOut: number | null; truckOut: string };
    expect(out.status).toBe(200);
    expect(outBody.cardOut).toBe(1);
    expect(outBody.truckOut).toBe('522');
  });

  it('a bare exit without the truck is refused', async () => {
    const created = await gateIn('MSCU1234', 20, at(B20, 1, 1, 1));
    const bare = await call({
      method: 'POST',
      url: `/api/containers/${String(created.body.id)}/exit`,
      payload: {},
    });
    expect(bare.status).toBe(400);
  });
});

describe('reports', () => {
  const wideRange = (): { from: string; to: string } => ({
    from: new Date(Date.now() - 86_400_000).toISOString(),
    to: new Date(Date.now() + 86_400_000).toISOString(),
  });

  it('the entry register lists gate-ins with their paperwork', async () => {
    await gateIn('MSCU1234', 20, at(B20, 1, 1, 1), 'شركة البحر');
    const { from, to } = wideRange();
    const report = await call({
      method: 'GET',
      url: `/api/reports/gate?type=IN&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    });
    expect(report.status).toBe(200);
    const rows = (report.body as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      number: 'MSCU1234',
      truck: '500',
      driver: 'أبو أحمد',
      weight: '25',
      card: 1,
      customer: 'شركة البحر',
      dwellDays: null,
    });
  });

  it('the exit register carries the exit truck, card and dwell', async () => {
    const created = await gateIn('MSCU1234', 20, at(B20, 1, 1, 1));
    await gateOut(created.body.id);
    const { from, to } = wideRange();
    const report = await call({
      method: 'GET',
      url: `/api/reports/gate?type=OUT&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    });
    const rows = (report.body as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ number: 'MSCU1234', truck: '522', card: 1, dwellDays: 0 });
  });

  it('the daily summary counts ins, outs, and who is standing', async () => {
    const a = await gateIn('MSCU1234', 20, at(B20, 1, 1, 1));
    await gateIn('CSQU5678', 20, at(B20, 1, 2, 1));
    await gateOut(a.body.id);
    const { from, to } = wideRange();
    const report = await call({
      method: 'GET',
      url: `/api/reports/daily?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    });
    expect(report.status).toBe(200);
    const rows = (report.body as { rows: Array<Record<string, unknown>> }).rows;
    const today = rows.find((r) => (r['inCount'] as number) > 0);
    expect(today).toMatchObject({ inCount: 2, outCount: 1, standing: 1 });
  });

  it('a soft-deleted record leaves the registers', async () => {
    const created = await gateIn('MSCU1234', 20, at(B20, 1, 1, 1));
    await call({ method: 'DELETE', url: `/api/containers/${String(created.body.id)}` });
    const { from, to } = wideRange();
    const report = await call({
      method: 'GET',
      url: `/api/reports/gate?type=IN&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    });
    expect((report.body as { rows: unknown[] }).rows).toHaveLength(0);
  });

  it('the operations log records everything, deletions included', async () => {
    const a = await gateIn('MSCU1234', 20, at(B20, 1, 1, 1));
    await call({
      method: 'POST',
      url: `/api/containers/${String(a.body.id)}/move`,
      payload: { to: at(B20, 2, 2, 1) },
    });
    await call({ method: 'DELETE', url: `/api/containers/${String(a.body.id)}` });

    const { from, to } = wideRange();
    const report = await call({
      method: 'GET',
      url: `/api/reports/log?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    });
    expect(report.status).toBe(200);
    const rows = (report.body as { rows: Array<{ type: string; deleted: boolean }> }).rows;
    expect(rows.map((r) => r.type)).toEqual(['IN', 'MOVE', 'DELETE']);
    expect(rows.every((r) => r.deleted)).toBe(true);
  });

  it('the truck register gathers one truck across both directions', async () => {
    const a = await gateIn('MSCU1234', 20, at(B20, 1, 1, 1)); // truck 500 in
    await gateIn('CSQU5678', 20, at(B20, 1, 2, 1)); // truck 500 in
    await gateOut(a.body.id); // truck 522 out

    const { from, to } = wideRange();
    const for500 = await call({
      method: 'GET',
      url: `/api/reports/truck?truck=500&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    });
    const rows500 = (for500.body as { rows: Array<{ statement: string; number: string }> }).rows;
    expect(rows500).toHaveLength(2);
    expect(rows500.every((r) => r.statement === 'IN')).toBe(true);

    const for522 = await call({
      method: 'GET',
      url: `/api/reports/truck?truck=522&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    });
    const rows522 = (for522.body as { rows: Array<{ statement: string; number: string }> }).rows;
    expect(rows522).toHaveLength(1);
    expect(rows522[0]).toMatchObject({ statement: 'OUT', number: 'MSCU1234' });
  });
});

describe('search', () => {
  it('finds by number fragment and by customer, in-yard first', async () => {
    const first = await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1), 'شركة البحر');
    await gateOut(first.body.id);
    await gateIn('CSQU3054383', 20, at(B20, 1, 2, 1), 'شركة البحر');

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
    await gateIn('MSCU1234566', 20, at(B20, 1, 1, 1));
    const result = await call({ method: 'GET', url: '/api/containers?q=%25' });
    expect((result.body as { results: unknown[] }).results).toHaveLength(0);
  });
});

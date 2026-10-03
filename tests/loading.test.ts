import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type {
  ContainerDto,
  DailyReportRow,
  GateReportRow,
  Handling,
  LogReportRow,
  MachineReportRow,
  MovementDto,
  Permission,
  Position,
  StandingReportRow,
  TaskDto,
} from '../src/shared/types';

/**
 * «بانتظار التحميل»: the office records the exit FIRST, because it needs the
 * printed card while the box still stands on the ground. The exit card is
 * the paper; the lift onto the truck is the ground. Between the two the box
 * waits in its slot — on the map, holding up what rests on it — while every
 * register already counts it out from its card. The lift is confirmed by
 * the machine driver's «تم», by the office's «تم التحميل», or by the yard's
 * own clock 24 hours after the card, whichever comes first.
 */

let db: DatabaseSync;
let app: FastifyInstance;
let ownerCookie: string;

const DAY = 24 * 60 * 60 * 1000;

const at = (bay: number, stack: number, tier: 'A' | 'B' | 'C' = 'A'): Position => ({
  zone: 'B',
  bay,
  stack,
  tier,
});

const cookieOf = (headers: Record<string, unknown>): string => {
  const raw = headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : (raw as string | undefined);
  if (header === undefined) throw new Error('no session cookie');
  return header.split(';')[0] ?? '';
};

interface Reply {
  status: number;
  body: unknown;
}

async function call(options: {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  payload?: unknown;
  cookie?: string;
}): Promise<Reply> {
  const response = await app.inject({
    method: options.method,
    url: options.url,
    ...(options.payload === undefined ? {} : { payload: options.payload as object }),
    headers: { cookie: options.cookie ?? ownerCookie },
  });
  return {
    status: response.statusCode,
    body: response.body === '' ? null : (JSON.parse(response.body) as unknown),
  };
}

const codeOf = (reply: Reply): string | undefined => (reply.body as { code?: string }).code;
const detailsOf = (reply: Reply): Record<string, string> | undefined =>
  (reply.body as { details?: Record<string, string> }).details;

/** Create an account (office or driver) and sign in as them. */
async function hire(
  name: string,
  pin: string,
  permissions: readonly Permission[],
  machine: Handling | '' = '',
): Promise<{ id: number; cookie: string }> {
  const made = await call({
    method: 'POST',
    url: '/api/users',
    payload: { name, pin, permissions, machine },
  });
  if (made.status !== 201) throw new Error(`hire failed: ${JSON.stringify(made.body)}`);
  const id = (made.body as { id: number }).id;
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { userId: id, pin } });
  if (login.statusCode !== 200) throw new Error('sign-in failed');
  return { id, cookie: cookieOf(login.headers as Record<string, unknown>) };
}

const gateInPayload = (
  number: string,
  position: Position,
  bill = '3210',
  handling: Handling = 'CRANE',
): Record<string, unknown> => ({
  number,
  // The bay's parity IS the class: an even bay is a forty's address.
  size: position.bay % 2 === 1 ? 20 : 40,
  bill,
  notes: '',
  position,
  truck: '500',
  seal: 'JO100001',
  driver: 'أبو أحمد',
  weight: '25000',
  handling,
});

/** Gate a container in as the owner; returns its id. */
async function receive(
  number: string,
  position: Position,
  bill = '3210',
  handling: Handling = 'CRANE',
): Promise<number> {
  const made = await call({
    method: 'POST',
    url: '/api/containers',
    payload: gateInPayload(number, position, bill, handling),
  });
  if (made.status !== 201) throw new Error(`gate-in failed: ${JSON.stringify(made.body)}`);
  return (made.body as { id: number }).id;
}

/** The exit CARD — the paper half. */
const exit = (id: number, cookie?: string): Promise<Reply> =>
  call({
    method: 'POST',
    url: `/api/containers/${String(id)}/exit`,
    payload: { truck: '60-71544', driver: 'معاذ' },
    ...(cookie === undefined ? {} : { cookie }),
  });

/** «تم التحميل» from the office — the ground half, by hand. */
const loaded = (id: number, cookie?: string): Promise<Reply> =>
  call({
    method: 'POST',
    url: `/api/containers/${String(id)}/loaded`,
    payload: {},
    ...(cookie === undefined ? {} : { cookie }),
  });

async function detail(id: number): Promise<{ container: ContainerDto; movements: MovementDto[] }> {
  const reply = await call({ method: 'GET', url: `/api/containers/${String(id)}` });
  if (reply.status !== 200) throw new Error(`detail failed: ${JSON.stringify(reply.body)}`);
  return reply.body as { container: ContainerDto; movements: MovementDto[] };
}

const where = async (id: number): Promise<Position | null> => (await detail(id)).container.position;

async function tasksOf(query: string, cookie?: string): Promise<readonly TaskDto[]> {
  const answer = await call({
    method: 'GET',
    url: `/api/tasks${query}`,
    ...(cookie === undefined ? {} : { cookie }),
  });
  if (answer.status !== 200) throw new Error(`tasks failed: ${JSON.stringify(answer.body)}`);
  return (answer.body as { tasks: TaskDto[] }).tasks;
}

/** The OUT task — the loading task — standing on one container. */
async function loadingTask(containerId: number, status: 'PENDING' | 'DONE'): Promise<TaskDto> {
  const task = (await tasksOf(`?status=${status}`)).find(
    (row) => row.kind === 'OUT' && row.containerId === containerId,
  );
  if (task === undefined) throw new Error(`no ${status} loading task on ${String(containerId)}`);
  return task;
}

const taskDone = (taskId: number, cookie?: string): Promise<Reply> =>
  call({
    method: 'POST',
    url: `/api/tasks/${String(taskId)}/done`,
    payload: {},
    ...(cookie === undefined ? {} : { cookie }),
  });

/** Yesterday to three days on — the sweep writes 24 hours ahead in these tests. */
const range = (): string =>
  `from=${encodeURIComponent(new Date(Date.now() - DAY).toISOString())}` +
  `&to=${encodeURIComponent(new Date(Date.now() + 3 * DAY).toISOString())}`;

async function rowsOf<T>(url: string): Promise<T[]> {
  const reply = await call({ method: 'GET', url });
  if (reply.status !== 200) throw new Error(`${url} failed: ${JSON.stringify(reply.body)}`);
  return (reply.body as { rows: T[] }).rows;
}

const mapNumbers = async (): Promise<string[]> =>
  ((await call({ method: 'GET', url: '/api/state' })).body as { containers: ContainerDto[] }).containers
    .map((container) => container.number)
    .sort();

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  await app.ready();
  const response = await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { password: 'yard-secret' },
  });
  if (response.statusCode !== 200) throw new Error('setup failed');
  ownerCookie = cookieOf(response.headers as Record<string, unknown>);
});

describe('the exit card keeps the box on the ground', () => {
  it('writes the paper, keeps the slot, and brings nothing down', async () => {
    const ground = await receive('WAIT0001', at(1, 1, 'A'));
    const middle = await receive('WAIT0002', at(1, 1, 'B'));
    const top = await receive('WAIT0003', at(1, 1, 'C'));

    const out = await exit(ground);
    expect(out.status).toBe(200);
    const card = out.body as ContainerDto;
    // The paper exactly as it always was: the year's serial, the truck, the
    // driver, the instant of the card.
    expect(card.cardOut).toBe(1);
    expect(card.truckOut).toBe('60-71544');
    expect(card.driverOut).toBe('معاذ');
    expect(card.exitedAt).not.toBeNull();
    // …and the ground exactly as it is: the box still stands in its slot.
    expect(card.position).toEqual(at(1, 1, 'A'));
    expect(card.loadedAt).toBeNull();

    // Nothing above it came down — it has not been lifted yet.
    expect(await where(middle)).toEqual(at(1, 1, 'B'));
    expect(await where(top)).toEqual(at(1, 1, 'C'));
    const { movements } = await detail(ground);
    expect(movements.map((movement) => movement.type)).toEqual(['IN', 'OUT']);
    // The OUT names the slot the card was written in.
    expect(movements[1]?.from).toEqual(at(1, 1, 'A'));
    for (const id of [middle, top]) {
      expect((await detail(id)).movements.map((movement) => movement.type)).toEqual(['IN']);
    }

    // The map keeps all three.
    expect(await mapNumbers()).toEqual(['WAIT0001', 'WAIT0002', 'WAIT0003']);
  });

  it('refuses a second exit, and a تجهيز, for a box whose card is written', async () => {
    const id = await receive('WAIT0004', at(3, 1));
    expect((await exit(id)).status).toBe(200);

    const again = await exit(id);
    expect(again.status).toBe(409);
    expect(codeOf(again)).toBe('ALREADY_OUT');
    // Still exactly one exit card.
    expect((await detail(id)).container.cardOut).toBe(1);

    const prepare = await call({
      method: 'POST',
      url: '/api/tasks/prepare',
      payload: { containerId: id },
    });
    expect(prepare.status).toBe(409);
    expect(codeOf(prepare)).toBe('ALREADY_OUT');
  });

  it('a buried box is still refused at the card when what rests on it could not come down', async () => {
    // A forty across two twenties: lifting one twenty would leave the forty
    // with one leg in the air. The early check stays where it was — at the
    // card, not a day later at the truck.
    await receive('LEGS0001', at(1, 1));
    const right = await receive('LEGS0003', at(3, 1));
    await receive('LEGS0040', at(2, 1, 'B'));

    const refused = await exit(right);
    expect(refused.status).toBe(409);
    expect(codeOf(refused)).toBe('BLOCKED_DESCENT');
    expect(detailsOf(refused)?.['other']).toBe('LEGS0040');
    expect((await detail(right)).container.exitedAt).toBeNull();
  });
});

describe('the machine driver’s «تم» is the loading', () => {
  it('«تم» on the exit-born task lifts the box off the map and settles the stack', async () => {
    const driver = await hire('سائق الونش', '1111', ['MOVE'], 'CRANE');
    const ground = await receive('LIFT0001', at(5, 1, 'A'));
    const middle = await receive('LIFT0002', at(5, 1, 'B'));
    const top = await receive('LIFT0003', at(5, 1, 'C'));
    const card = (await exit(ground)).body as ContainerDto;

    // The exit-born task is the loading task, and it names the live slot.
    const task = await loadingTask(ground, 'PENDING');
    expect(task.machine).toBe('CRANE');
    expect(task.truck).toBe('60-71544');
    expect(task.position).toEqual(at(5, 1, 'A'));

    const answer = await taskDone(task.id, driver.cookie);
    expect(answer.status).toBe(200);
    expect((answer.body as TaskDto).status).toBe('DONE');
    // His own «تم», under his own name: no close code.
    expect((answer.body as TaskDto).closedNote).toBe('');
    expect((answer.body as TaskDto).doneBy).toBe('سائق الونش');

    const gone = (await detail(ground)).container;
    expect(gone.position).toBeNull();
    expect(gone.loadedAt).not.toBeNull();
    // The paper did not move: the card is the card it always was.
    expect(gone.exitedAt).toBe(card.exitedAt);
    expect(gone.cardOut).toBe(card.cardOut);

    // Gravity, each descent its own DROP naming the box that left.
    expect(await where(middle)).toEqual(at(5, 1, 'A'));
    expect(await where(top)).toEqual(at(5, 1, 'B'));
    const drop = (await detail(middle)).movements.find((movement) => movement.type === 'DROP');
    expect(drop?.note).toBe('LIFT0001');
    expect(drop?.from).toEqual(at(5, 1, 'B'));
    expect(drop?.to).toEqual(at(5, 1, 'A'));
    expect(drop?.user).toBe('سائق الونش');

    // After the lift the task still tells where the box stood.
    expect((await loadingTask(ground, 'DONE')).position).toEqual(at(5, 1, 'A'));
    expect(await mapNumbers()).toEqual(['LIFT0002', 'LIFT0003']);
  });

  it('a تجهيز sent before the exit stays open as the loading task, and its «تم» loads', async () => {
    const driver = await hire('سائق العقرب', '2222', ['MOVE'], 'STRADDLE');
    const id = await receive('PREP0001', at(7, 1), '3210', 'STRADDLE');
    const prepared = await call({
      method: 'POST',
      url: '/api/tasks/prepare',
      payload: { containerId: id },
    });
    expect(prepared.status).toBe(201);
    const prepareId = (prepared.body as TaskDto).id;

    expect((await exit(id)).status).toBe(200);
    // The card answered nothing: the تجهيز is the loading task now, and no
    // second OUT task was born beside it.
    const open = (await tasksOf('?status=PENDING')).filter((task) => task.kind === 'OUT');
    expect(open.map((task) => task.id)).toEqual([prepareId]);
    expect((await tasksOf('?status=DONE')).filter((task) => task.kind === 'OUT')).toHaveLength(0);
    // The truck the gate wrote reaches the driver's card through it.
    expect(open[0]?.gateTruck).toBe('60-71544');

    expect((await taskDone(prepareId, driver.cookie)).status).toBe(200);
    const gone = (await detail(id)).container;
    expect(gone.position).toBeNull();
    expect(gone.loadedAt).not.toBeNull();
    const closed = await loadingTask(id, 'DONE');
    expect(closed.id).toBe(prepareId);
    expect(closed.closedNote).toBe('');
    expect(closed.doneBy).toBe('سائق العقرب');
  });

  it('a تجهيز answered before the exit loads nothing, and the exit births the loading task', async () => {
    const id = await receive('PREP0002', at(9, 1));
    const prepared = await call({
      method: 'POST',
      url: '/api/tasks/prepare',
      payload: { containerId: id },
    });
    expect((await taskDone((prepared.body as TaskDto).id)).status).toBe(200);
    // Fetched to the gate, card not written yet: still standing, nothing lifted.
    expect((await detail(id)).container.loadedAt).toBeNull();
    expect(await where(id)).toEqual(at(9, 1));

    expect((await exit(id)).status).toBe(200);
    const born = await loadingTask(id, 'PENDING');
    expect(born.id).not.toBe((prepared.body as TaskDto).id);
    expect(born.truck).toBe('60-71544');
  });

  it('«تحديد الكل ثم تم» at the desk loads every waiting box among them', async () => {
    const clerk = await hire('كاتب', '3333', ['GATE_OUT']);
    const first = await receive('MANY0001', at(11, 1));
    const second = await receive('MANY0002', at(13, 1));
    const above = await receive('MANY0003', at(13, 1, 'B'));
    await exit(first);
    await exit(second);
    const ids = [(await loadingTask(first, 'PENDING')).id, (await loadingTask(second, 'PENDING')).id];

    const answer = await call({
      method: 'POST',
      url: '/api/tasks/done-many',
      payload: { ids },
      cookie: clerk.cookie,
    });
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ done: 2, skipped: 0 });

    for (const id of [first, second]) {
      const box = (await detail(id)).container;
      expect(box.position).toBeNull();
      expect(box.loadedAt).not.toBeNull();
      const task = await loadingTask(id, 'DONE');
      // The desk's «تم» on the task itself — its own hand, no close code.
      expect(task.closedNote).toBe('');
      expect(task.doneBy).toBe('كاتب');
    }
    expect(await where(above)).toEqual(at(13, 1, 'A'));
  });
});

describe('«تم التحميل» من المكتب', () => {
  it('needs the gate-out hand, loads a waiting box, and answers AUTO_LOADED on its task', async () => {
    const clerk = await hire('كاتب', '3333', ['GATE_OUT']);
    const stranger = await hire('مدخل', '4444', ['GATE_IN', 'MOVE']);
    const id = await receive('DESK0001', at(15, 1));
    const above = await receive('DESK0002', at(15, 1, 'B'));
    await exit(id);

    const refused = await loaded(id, stranger.cookie);
    expect(refused.status).toBe(403);
    expect(await where(id)).toEqual(at(15, 1));

    const done = await loaded(id, clerk.cookie);
    expect(done.status).toBe(200);
    const box = done.body as ContainerDto;
    expect(box.id).toBe(id);
    expect(box.position).toBeNull();
    expect(box.loadedAt).not.toBeNull();
    expect(box.exitedAt).not.toBeNull();

    expect(await where(above)).toEqual(at(15, 1, 'A'));
    const drop = (await detail(above)).movements.find((movement) => movement.type === 'DROP');
    expect(drop?.user).toBe('كاتب');

    // The task still asking is answered — by code, under the clerk's hand.
    const task = await loadingTask(id, 'DONE');
    expect(task.closedNote).toBe('AUTO_LOADED');
    expect(task.doneBy).toBe('كاتب');
    expect(await tasksOf('?status=PENDING')).toHaveLength(1); // the box above: its entry task
  });

  it('refuses a box that is not waiting: still standing, or already gone', async () => {
    const standing = await receive('DESK0003', at(17, 1));
    const notYet = await loaded(standing);
    expect(notYet.status).toBe(409);
    expect(codeOf(notYet)).toBe('NOT_AWAITING_LOAD');

    const gone = await receive('DESK0004', at(19, 1));
    await exit(gone);
    expect((await loaded(gone)).status).toBe(200);
    const twice = await loaded(gone);
    expect(twice.status).toBe(409);
    expect(codeOf(twice)).toBe('NOT_AWAITING_LOAD');

    expect((await loaded(99_999)).status).toBe(404);
  });
});

describe('the 24-hour clock', () => {
  it('leaves a box at 23:59 and clears it at 24:00, naming nobody', async () => {
    const id = await receive('CLCK0001', at(21, 1));
    const above = await receive('CLCK0002', at(21, 1, 'B'));
    const card = (await exit(id)).body as ContainerDto;
    const issued = Date.parse(card.exitedAt ?? '');

    expect(app.sweepLoading(new Date(issued + DAY - 60_000).toISOString())).toBe(0);
    expect(await where(id)).toEqual(at(21, 1));
    expect((await detail(id)).container.loadedAt).toBeNull();

    const clock = new Date(issued + DAY).toISOString();
    expect(app.sweepLoading(clock)).toBe(1);
    const box = (await detail(id)).container;
    expect(box.position).toBeNull();
    expect(box.loadedAt).toBe(clock);
    expect(await where(above)).toEqual(at(21, 1, 'A'));

    // Nothing the clock wrote may read as a person's work — least of all as
    // the owner's, whose own hand is the other NULL in these tables.
    const task = await loadingTask(id, 'DONE');
    expect(task.closedNote).toBe('AUTO_LOADED');
    expect(task.doneBy).toBe('');
    const drop = (await detail(above)).movements.find((movement) => movement.type === 'DROP');
    expect(drop?.at).toBe(clock);
    expect(drop?.user).toBe('');
    const log = await rowsOf<LogReportRow>(`/api/reports/log?${range()}`);
    const dropRow = log.find((row) => row.type === 'DROP');
    expect(dropRow?.user).toBe('');
    // Every row a person wrote still names its hand.
    expect(log.filter((row) => row.type !== 'DROP').every((row) => row.user === 'المالك')).toBe(true);

    // A second round finds nothing left to do.
    expect(app.sweepLoading(new Date(issued + 2 * DAY).toISOString())).toBe(0);
  });

  it('a box that cannot come down yet stays waiting, and never holds the others back', async () => {
    // Two twenties side by side; one is carded out and waits — and while it
    // waits, a forty is set across both. The forty rests on the waiting box,
    // so lifting it would leave the forty with one leg in the air.
    const left = await receive('BLCK0001', at(1, 2));
    await receive('BLCK0003', at(3, 2));
    const other = await receive('BLCK0009', at(9, 2));
    const leftCard = (await exit(left)).body as ContainerDto;
    expect((await receive('BLCK0040', at(2, 2, 'B'))) > 0).toBe(true);
    const otherCard = (await exit(other)).body as ContainerDto;

    const last = Math.max(Date.parse(leftCard.exitedAt ?? ''), Date.parse(otherCard.exitedAt ?? ''));
    expect(app.sweepLoading(new Date(last + DAY).toISOString())).toBe(1);
    // The other one went; the blocked one waits on the map, intact.
    expect(await where(other)).toBeNull();
    expect(await where(left)).toEqual(at(1, 2));
    expect((await detail(left)).container.loadedAt).toBeNull();
    // Its task is still asking: nobody has lifted it.
    expect((await loadingTask(left, 'PENDING')).closedNote).toBe('');
  });
});

describe('a forty across two twenties, one of them waiting', () => {
  it('the desk is told which box to move, the clock and the driver leave it waiting', async () => {
    const driver = await hire('سائق الونش', '1111', ['MOVE'], 'CRANE');
    const left = await receive('FRTY0001', at(25, 1));
    await receive('FRTY0003', at(27, 1));
    const card = (await exit(left)).body as ContainerDto;
    const forty = await receive('FRTY0040', at(26, 1, 'B'));

    // The desk: refused, with the forty named — it has to be moved first.
    const desk = await loaded(left);
    expect(desk.status).toBe(409);
    expect(codeOf(desk)).toBe('BLOCKED_DESCENT');
    expect(detailsOf(desk)?.['other']).toBe('FRTY0040');
    expect(await where(left)).toEqual(at(25, 1));

    // The clock: silently leaves it.
    expect(app.sweepLoading(new Date(Date.parse(card.exitedAt ?? '') + DAY).toISOString())).toBe(0);
    expect(await where(left)).toEqual(at(25, 1));

    // The driver: his «تم» is recorded as his, and nothing is broken.
    const task = await loadingTask(left, 'PENDING');
    const answer = await taskDone(task.id, driver.cookie);
    expect(answer.status).toBe(200);
    expect((answer.body as TaskDto).closedNote).toBe('');
    expect((answer.body as TaskDto).doneBy).toBe('سائق الونش');
    const box = (await detail(left)).container;
    expect(box.position).toEqual(at(25, 1));
    expect(box.loadedAt).toBeNull();
    expect(await where(forty)).toEqual(at(26, 1, 'B'));

    // Once the forty is moved away, the desk can confirm it.
    const moved = await call({
      method: 'POST',
      url: `/api/containers/${String(forty)}/move`,
      payload: { to: at(32, 1) },
    });
    expect(moved.status).toBe(200);
    expect((await loaded(left)).status).toBe(200);
    expect(await where(left)).toBeNull();
  });
});

describe('a box carried while it waited', () => {
  it('may be moved, and leaves the ground from where it truly stood', async () => {
    const id = await receive('SHFT0001', at(29, 3));
    await exit(id);
    const moved = await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/move`,
      payload: { to: at(33, 3) },
    });
    expect(moved.status).toBe(200);
    // The loading task follows the box: it names the slot it stands in now.
    expect((await loadingTask(id, 'PENDING')).position).toEqual(at(33, 3));

    expect((await loaded(id)).status).toBe(200);
    const { movements } = await detail(id);
    expect(movements.map((movement) => movement.type)).toEqual(['IN', 'OUT', 'MOVE']);
    // The departure is rewritten to the slot it actually left from — the
    // registers and «إلغاء الخروج» read it there.
    expect(movements[1]?.from).toEqual(at(33, 3));

    const exits = await rowsOf<GateReportRow>(`/api/reports/gate?type=OUT&${range()}`);
    expect(exits.find((row) => row.number === 'SHFT0001')?.position).toEqual(at(33, 3));
  });
});

describe('the waiting slot is held', () => {
  it('a landing on it is refused by name, and a forty’s half too', async () => {
    const id = await receive('HOLD0001', at(35, 4));
    await exit(id);

    const onIt = await call({
      method: 'POST',
      url: '/api/containers',
      payload: gateInPayload('HOLD0002', at(35, 4)),
    });
    expect(onIt.status).toBe(409);
    expect(codeOf(onIt)).toBe('SLOT_AWAITING_LOAD');
    expect(detailsOf(onIt)?.['other']).toBe('HOLD0001');

    const mover = await receive('HOLD0003', at(39, 4));
    const moving = await call({
      method: 'POST',
      url: `/api/containers/${String(mover)}/move`,
      payload: { to: at(35, 4) },
    });
    expect(moving.status).toBe(409);
    expect(codeOf(moving)).toBe('SLOT_AWAITING_LOAD');
    expect(detailsOf(moving)?.['other']).toBe('HOLD0001');

    // A forty whose far half is the waiting box's ground.
    const forty = await call({
      method: 'POST',
      url: '/api/containers',
      payload: gateInPayload('HOLD0040', at(36, 4)),
    });
    expect(forty.status).toBe(409);
    expect(codeOf(forty)).toBe('SLOT_AWAITING_LOAD');
    expect(detailsOf(forty)?.['other']).toBe('HOLD0001');

    // An ordinary occupant is still OCCUPIED, as it always was.
    const plain = await call({
      method: 'POST',
      url: '/api/containers',
      payload: gateInPayload('HOLD0004', at(39, 4)),
    });
    expect(codeOf(plain)).toBe('OCCUPIED');

    // Loaded, the slot is free.
    expect((await loaded(id)).status).toBe(200);
    expect(
      (
        await call({
          method: 'POST',
          url: '/api/containers',
          payload: gateInPayload('HOLD0002', at(35, 4)),
        })
      ).status,
    ).toBe(201);
  });

  it('its number cannot be received again until it has left', async () => {
    const id = await receive('TWIN0001', at(37, 5));
    await exit(id);
    const twin = await call({
      method: 'POST',
      url: '/api/containers',
      payload: gateInPayload('TWIN0001', at(41, 5)),
    });
    expect(twin.status).toBe(409);
    expect(codeOf(twin)).toBe('NUMBER_AWAITING_LOAD');
    expect(detailsOf(twin)?.['number']).toBe('TWIN0001');

    expect((await loaded(id)).status).toBe(200);
    expect((await receive('TWIN0001', at(41, 5))) > 0).toBe(true);
  });
});

describe('إلغاء الخروج', () => {
  it('a waiting box is cancelled in place: the paper goes, the box stays', async () => {
    const id = await receive('BACK0001', at(1, 6));
    const above = await receive('BACK0002', at(1, 6, 'B'));
    await exit(id);
    expect((await loadingTask(id, 'PENDING')).kind).toBe('OUT');

    // Any OTHER slot named is refused — carrying it is a move, not a footnote.
    const elsewhere = await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/unexit`,
      payload: { position: at(3, 6) },
    });
    expect(elsewhere.status).toBe(400);
    expect((await detail(id)).container.exitedAt).not.toBeNull();

    const back = await call({ method: 'POST', url: `/api/containers/${String(id)}/unexit`, payload: {} });
    expect(back.status).toBe(200);
    const box = back.body as ContainerDto;
    expect(box.position).toEqual(at(1, 6));
    expect(box.exitedAt).toBeNull();
    expect(box.loadedAt).toBeNull();
    expect(box.cardOut).toBeNull();
    expect(box.cardOutYear).toBeNull();
    expect(box.truckOut).toBe('');
    expect(box.driverOut).toBe('');

    // Nothing moved.
    expect(await where(above)).toEqual(at(1, 6, 'B'));
    const { movements } = await detail(id);
    expect(movements.map((movement) => movement.type)).toEqual(['IN', 'OUT', 'RETURN']);
    expect(movements[2]?.to).toEqual(at(1, 6));
    expect((await loadingTask(id, 'DONE')).closedNote).toBe('AUTO_RETURN');

    // Its own slot, named explicitly, is the same request.
    await exit(id);
    const same = await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/unexit`,
      payload: { position: at(1, 6) },
    });
    expect(same.status).toBe(200);
    expect((same.body as ContainerDto).position).toEqual(at(1, 6));
  });

  it('a box already loaded comes back where the clerk names, as before', async () => {
    const id = await receive('BACK0003', at(5, 6));
    await exit(id);
    expect((await loaded(id)).status).toBe(200);

    const back = await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/unexit`,
      payload: { position: at(7, 6) },
    });
    expect(back.status).toBe(200);
    const box = back.body as ContainerDto;
    expect(box.position).toEqual(at(7, 6));
    expect(box.exitedAt).toBeNull();
    expect(box.loadedAt).toBeNull();
    expect(box.cardOut).toBeNull();
  });
});

describe('تجهيز البوليصة', () => {
  it('skips a box whose card is written, and finds nothing to do when all are', async () => {
    const waiting = await receive('BILL0001', at(9, 6), '7777');
    const standing = await receive('BILL0002', at(11, 6), '7777');
    await exit(waiting);

    const sent = await call({ method: 'POST', url: '/api/tasks/prepare-bill', payload: { bill: '7777' } });
    expect(sent.status).toBe(201);
    expect(sent.body).toEqual({ created: 1, skipped: 0 });
    const pending = (await tasksOf('?status=PENDING')).filter((task) => task.kind === 'OUT');
    expect(pending.map((task) => task.containerId).sort()).toEqual([standing, waiting].sort());

    const lone = await receive('BILL0003', at(13, 6), '8888');
    await exit(lone);
    const none = await call({ method: 'POST', url: '/api/tasks/prepare-bill', payload: { bill: '8888' } });
    expect(none.status).toBe(404);
  });
});

describe('the paper counts it out from its card', () => {
  it('the gate register and the daily report read the same before and after the lift', async () => {
    const id = await receive('PAPR0001', at(15, 6));
    await exit(id);

    const read = async (): Promise<{ exits: GateReportRow[]; days: DailyReportRow[] }> => ({
      exits: await rowsOf<GateReportRow>(`/api/reports/gate?type=OUT&${range()}`),
      days: await rowsOf<DailyReportRow>(`/api/reports/daily?${range()}`),
    });
    const waiting = await read();
    expect(waiting.exits).toHaveLength(1);
    expect(waiting.exits[0]).toMatchObject({ number: 'PAPR0001', card: 1, truck: '60-71544' });
    expect(waiting.days).toHaveLength(1);
    expect(waiting.days[0]).toMatchObject({ inCount: 1, outCount: 1, standing: 0 });

    expect((await loaded(id)).status).toBe(200);
    const after = await read();
    expect(after.exits.map((row) => [row.number, row.card, row.at])).toEqual(
      waiting.exits.map((row) => [row.number, row.card, row.at]),
    );
    expect(after.days).toEqual(waiting.days);
  });

  it('«الحاويات بالساحة» leaves it out while the map keeps it', async () => {
    const id = await receive('PAPR0002', at(17, 6));
    await receive('PAPR0003', at(19, 6));
    await exit(id);

    const standing = await rowsOf<StandingReportRow>('/api/reports/standing');
    expect(standing.map((row) => row.number)).toEqual(['PAPR0003']);
    expect(await mapNumbers()).toEqual(['PAPR0002', 'PAPR0003']);
  });

  it('the bill sheet files it with the departed; the search lists it with the standing', async () => {
    const waiting = await receive('PAPR0004', at(21, 6), '5151');
    await receive('PAPR0005', at(23, 6), '5151');
    const departed = await receive('PAPR0006', at(25, 6), '5151');
    await exit(departed);
    await loaded(departed);
    await exit(waiting);

    const sheet = await rowsOf<ContainerDto>('/api/reports/bill?number=5151');
    expect(sheet.map((row) => row.number)).toEqual(['PAPR0005', 'PAPR0004', 'PAPR0006']);

    const found = (
      (await call({ method: 'GET', url: '/api/containers?q=5151' })).body as { results: ContainerDto[] }
    ).results;
    // Steel first: the waiting box still stands, the departed one does not.
    // (Within the standing the newest leads, and two gate-ins may share a
    // millisecond here, so only the split is asserted.)
    expect(found.slice(0, 2).map((row) => row.number).sort()).toEqual(['PAPR0004', 'PAPR0005']);
    expect(found[2]?.number).toBe('PAPR0006');
  });
});

describe('correcting a waiting record', () => {
  it('is judged by its paper: the exit fields are mandatory, and a corrected date moves the OUT', async () => {
    const id = await receive('EDIT0001', at(27, 6));
    await exit(id);
    const { container } = await detail(id);
    const payload = {
      number: container.number,
      bill: container.bill,
      size: container.size,
      notes: container.notes,
      weight: container.weight,
      handling: container.handling,
      truckIn: container.truckIn,
      driverIn: container.driverIn,
      sealIn: container.sealIn,
      truckOut: container.truckOut,
      driverOut: container.driverOut,
      enteredAt: container.enteredAt,
      exitedAt: container.exitedAt,
    };
    const edit = (overrides: Record<string, unknown>): Promise<Reply> =>
      call({
        method: 'PATCH',
        url: `/api/containers/${String(id)}`,
        payload: { ...payload, ...overrides },
      });

    // It has its card, so it is edited like a departed record…
    const lostDate = await edit({ exitedAt: null });
    expect(lostDate.status).toBe(409);
    expect(codeOf(lostDate)).toBe('EXIT_PAPERS_MISSING');
    const lostTruck = await edit({ truckOut: '' });
    expect(codeOf(lostTruck)).toBe('EXIT_PAPERS_MISSING');

    // …and the OUT movement is retimed with a corrected card date.
    const fixed = await edit({
      enteredAt: '2026-08-01T08:00:00.000Z',
      exitedAt: '2026-08-02T08:00:00.000Z',
      driverOut: 'خليل',
    });
    expect(fixed.status).toBe(200);
    const after = await detail(id);
    expect(after.container.exitedAt).toBe('2026-08-02T08:00:00.000Z');
    expect(after.container.driverOut).toBe('خليل');
    expect(after.movements.find((movement) => movement.type === 'OUT')?.at).toBe(
      '2026-08-02T08:00:00.000Z',
    );
    // Still on the ground, still waiting.
    expect(after.container.position).toEqual(at(27, 6));
    expect(after.container.loadedAt).toBeNull();
  });

  it('a number clash on the ground is named by what holds it', async () => {
    const waiting = await receive('NAME0001', at(29, 6));
    const standing = await receive('NAME0002', at(31, 6));
    await exit(waiting);
    const rename = async (id: number, number: string): Promise<Reply> => {
      const { container } = await detail(id);
      return call({
        method: 'PATCH',
        url: `/api/containers/${String(id)}`,
        payload: {
          number,
          bill: container.bill,
          size: container.size,
          notes: container.notes,
          weight: container.weight,
          handling: container.handling,
          truckIn: container.truckIn,
          driverIn: container.driverIn,
          sealIn: container.sealIn,
          truckOut: container.truckOut,
          driverOut: container.driverOut,
          enteredAt: container.enteredAt,
          exitedAt: container.exitedAt,
        },
      });
    };
    const ontoWaiting = await rename(standing, 'NAME0001');
    expect(ontoWaiting.status).toBe(409);
    expect(codeOf(ontoWaiting)).toBe('NUMBER_AWAITING_LOAD');
    const ontoStanding = await rename(waiting, 'NAME0002');
    expect(ontoStanding.status).toBe(409);
    expect(codeOf(ontoStanding)).toBe('NUMBER_IN_YARD');
  });
});

describe('striking a waiting record', () => {
  it('brings down what rested on it, and a restore brings it back still waiting', async () => {
    const struck = await receive('STRK0001', at(33, 6));
    const above = await receive('STRK0002', at(33, 6, 'B'));
    await exit(struck);
    const removed = await call({ method: 'DELETE', url: `/api/containers/${String(struck)}` });
    expect(removed.status).toBe(200);
    // Gravity, exactly as for a standing box.
    expect(await where(above)).toEqual(at(33, 6, 'A'));
    const task = (await tasksOf('?status=DONE')).find(
      (row) => row.kind === 'OUT' && row.containerId === struck,
    );
    expect(task?.closedNote).toBe('AUTO_DELETE');

    // A lone waiting box struck and restored stands again in its slot,
    // still carded out and still waiting — and the clock still clears it.
    const lone = await receive('STRK0003', at(35, 6));
    const card = (await exit(lone)).body as ContainerDto;
    await call({ method: 'DELETE', url: `/api/containers/${String(lone)}` });
    expect(app.sweepLoading(new Date(Date.parse(card.exitedAt ?? '') + DAY).toISOString())).toBe(0);
    const restored = await call({
      method: 'POST',
      url: `/api/containers/${String(lone)}/restore`,
      payload: {},
    });
    expect(restored.status).toBe(200);
    const back = restored.body as ContainerDto;
    expect(back.position).toEqual(at(35, 6));
    expect(back.exitedAt).toBe(card.exitedAt);
    expect(back.loadedAt).toBeNull();
    expect(app.sweepLoading(new Date(Date.parse(card.exitedAt ?? '') + DAY).toISOString())).toBe(1);
    expect(await where(lone)).toBeNull();
  });
});

describe('كشف إنتاجية الآليات', () => {
  it('counts the driver’s «تم» on a loading task, never a close the desk or the clock made', async () => {
    const driver = await hire('سائق الونش', '1111', ['MOVE'], 'CRANE');
    const byDriver = await receive('PROD0001', at(37, 6));
    const byDesk = await receive('PROD0002', at(39, 6));
    const byClock = await receive('PROD0003', at(41, 6));
    // The entry tasks are somebody else's work; close them out of the way.
    for (const task of await tasksOf('?status=PENDING')) {
      await call({
        method: 'POST',
        url: '/api/tasks/done-many',
        payload: { ids: [task.id] },
      });
    }
    await exit(byDriver);
    await exit(byDesk);
    const clockCard = (await exit(byClock)).body as ContainerDto;

    await taskDone((await loadingTask(byDriver, 'PENDING')).id, driver.cookie);
    await loaded(byDesk);
    app.sweepLoading(new Date(Date.parse(clockCard.exitedAt ?? '') + DAY).toISOString());

    const rows = await rowsOf<MachineReportRow>(`/api/reports/machines?${range()}`);
    const his = rows.find((row) => row.doer === 'سائق الونش');
    expect(his).toMatchObject({ machine: 'CRANE', inDone: 0, outDone: 1, total: 1 });
    // The owner closed the three entry tasks by hand — and nothing else.
    const owner = rows.find((row) => row.doer === 'المالك');
    expect(owner).toMatchObject({ inDone: 3, outDone: 0, total: 3 });
    expect(rows).toHaveLength(2);
  });
});

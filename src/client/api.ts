import type {
  ApiError,
  BatchDto,
  BatchMatch,
  BatchSummaryDto,
  BillKind,
  CardSheetRow,
  CarrierDto,
  ContainerDto,
  CustomZoneDto,
  DailyReportRow,
  DriverHaulRow,
  ErrorCode,
  HaulDirection,
  FleetDto,
  GateReportRow,
  Handling,
  LogReportRow,
  MachineReportRow,
  MeDto,
  MovementDto,
  Permission,
  PermitDto,
  PermitReportRow,
  PhotoDto,
  Position,
  RetiredZoneDto,
  StandingReportRow,
  TaskDto,
  TaskStatus,
  TruckDto,
  UnassignedPlateRow,
  UserDto,
  YardStateDto,
  Zone,
} from '../shared/types';
import { daysBetween } from '../shared/dates';
import type { SheetRow } from '../shared/customsSheet';
import { AR } from './ar';

/**
 * The one place HTTP happens. Every failure becomes an ApiFailure carrying the
 * machine code and a ready Arabic sentence, so no component parses errors.
 */

export class ApiFailure extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK',
    readonly arabic: string,
    readonly details?: Record<string, string | number>,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    // Claim a JSON body only when one is sent (null is fetch's own "no
    // body"): a bodyless POST with the JSON content-type makes the server
    // refuse the empty body it promises.
    response = await fetch(path, {
      ...init,
      ...(init?.body !== undefined &&
        init.body !== null && {
          headers: { 'content-type': 'application/json', ...init.headers },
        }),
    });
  } catch {
    throw new ApiFailure('NETWORK', AR.networkError);
  }

  if (!response.ok) {
    let body: ApiError | null = null;
    try {
      body = (await response.json()) as ApiError;
    } catch {
      // The body was not JSON; fall through to the generic failure below.
    }
    if (body !== null && typeof body.code === 'string') {
      // Refusals that involve another container carry its number, so the
      // sentence can say WHO is on top or already standing there.
      const other = body.details?.['other'];
      // A rejected field names itself, when the server could say which one.
      const field = body.details?.['field'];
      const named = typeof field === 'string' ? AR.fieldName[field] : undefined;
      const fit = body.details?.['fit'];
      const total = body.details?.['total'];
      const arabic =
        (body.code === 'BLOCKED_DESCENT' || body.code === 'OCCUPIED') && typeof other === 'string'
          ? AR.errorWith(body.code, other)
          : body.code === 'GROUP_BURIED' && typeof other === 'string'
            ? AR.groupBuried(other)
            : body.code === 'GROUP_NO_ROOM' && typeof fit === 'number' && typeof total === 'number'
              ? AR.groupNoRoom(fit, total)
              : body.code === 'VALIDATION' && named !== undefined
                ? AR.validationField(named)
                : (AR.errors[body.code] ?? AR.networkError);
      throw new ApiFailure(body.code, arabic, body.details);
    }
    throw new ApiFailure('NETWORK', AR.networkError);
  }

  return (await response.json()) as T;
}

/**
 * A sheet file as raw bytes — the دفعة uploads. Hand-rolled like
 * restoreBackup because the shared request() promises a JSON body.
 */
async function uploadSheet<T>(path: string, file: File): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: await file.arrayBuffer(),
    });
  } catch {
    throw new ApiFailure('NETWORK', AR.networkError);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    const code = body?.code ?? 'NETWORK';
    throw new ApiFailure(code, AR.errors[code as ErrorCode] ?? AR.networkError);
  }
  return (await response.json()) as T;
}

/**
 * Everything a person entered, correctable — because a person entered it.
 * The dates are full ISO instants; the form turns the Amman wall clock the
 * user typed back into one.
 */
export interface ContainerEditInput {
  number: string;
  bill: string;
  billKind: BillKind | null;
  size: 20 | 40;
  notes: string;
  weight: string;
  handling: Handling | null;
  truckIn: string;
  driverIn: string;
  sealIn: string;
  truckOut: string;
  driverOut: string;
  enteredAt: string;
  exitedAt: string | null;
}

/** The edit payload that changes nothing — the base a correction is laid on. */
export function editPayloadOf(container: ContainerDto): ContainerEditInput {
  return {
    number: container.number,
    bill: container.bill,
    billKind: container.billKind,
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
}

export interface BootDto {
  firstRun: boolean;
  authorized: boolean;
  /** The employees the sign-in screen offers as buttons. */
  staff: Array<{ id: number; name: string }>;
  /** When the running build was compiled — the answer to «نزلت التعديلات؟». */
  build: string;
  /** Is the CALLER's own session a driver's — the idle lock reads this. */
  driver: boolean;
}

export const api = {
  boot: (): Promise<BootDto> => request('/api/boot'),

  /** First run: the password alone — the yard IS the official layout. */
  setup: (password: string): Promise<{ ok: boolean }> =>
    request('/api/setup', { method: 'POST', body: JSON.stringify({ password }) }),

  /** The owner's door. */
  login: (password: string): Promise<{ ok: boolean }> =>
    request('/api/login', { method: 'POST', body: JSON.stringify({ password }) }),

  /** An employee's door: their name from the picker, then their PIN. */
  loginAs: (userId: number, pin: string): Promise<{ ok: boolean }> =>
    request('/api/login', { method: 'POST', body: JSON.stringify({ userId, pin }) }),

  logout: (): Promise<{ ok: boolean }> => request('/api/logout', { method: 'POST' }),

  me: (): Promise<MeDto> => request('/api/me'),

  users: (): Promise<{ users: UserDto[] }> => request('/api/users'),

  addUser: (input: {
    name: string;
    pin: string;
    permissions: readonly Permission[];
    machine: Handling | '';
  }): Promise<UserDto> => request('/api/users', { method: 'POST', body: JSON.stringify(input) }),

  /** Send a `pin` only to replace it; leave it out to keep the current one. */
  editUser: (
    id: number,
    input: {
      name: string;
      permissions: readonly Permission[];
      machine?: Handling | '';
      pin?: string;
    },
  ): Promise<UserDto> =>
    request(`/api/users/${String(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),

  removeUser: (id: number): Promise<{ ok: boolean }> =>
    request(`/api/users/${String(id)}`, { method: 'DELETE' }),

  state: (): Promise<YardStateDto> => request('/api/state'),

  gateIn: (input: {
    number: string;
    size: 20 | 40;
    bill: string;
    billKind: BillKind | null;
    notes: string;
    position: Position;
    truck: string;
    seal: string;
    driver: string;
    weight: string;
    handling: Handling;
  }): Promise<ContainerDto> =>
    request('/api/containers', { method: 'POST', body: JSON.stringify(input) }),

  /**
   * The move hands back the movement as well as the container: the move card
   * is numbered by the server, so nothing here could know its serial.
   */
  move: (id: number, to: Position): Promise<{ container: ContainerDto; move: MovementDto }> =>
    request(`/api/containers/${String(id)}/move`, {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),

  exit: (id: number, gate: { truck: string; driver: string }): Promise<ContainerDto> =>
    request(`/api/containers/${String(id)}/exit`, {
      method: 'POST',
      body: JSON.stringify(gate),
    }),

  /**
   * An exit taken back — the container never left. It returns to its own slot
   * and its exit card is voided; the server refuses if that slot is taken.
   */
  unexit: (id: number): Promise<ContainerDto> =>
    request(`/api/containers/${String(id)}/unexit`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  reportGate: (type: 'IN' | 'OUT', fromIso: string, toIso: string): Promise<{ rows: GateReportRow[] }> =>
    request(
      `/api/reports/gate?type=${type}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
    ),

  reportDaily: (fromIso: string, toIso: string): Promise<{ rows: DailyReportRow[] }> =>
    request(
      `/api/reports/daily?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
    ),

  driverNames: (): Promise<{ rows: Array<{ name: string; hauls: number }> }> =>
    request('/api/drivers/names'),

  mergeDrivers: (keep: string, drop: readonly string[]): Promise<{ hauls: number; trucks: number }> =>
    request('/api/drivers/merge', { method: 'POST', body: JSON.stringify({ keep, drop }) }),

  reportMachines: (fromIso: string, toIso: string): Promise<{ rows: MachineReportRow[] }> =>
    request(
      `/api/reports/machines?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
    ),

  /** A snapshot of what is standing right now — no range, it is «الآن». */
  reportStanding: (): Promise<{ rows: StandingReportRow[] }> => request('/api/reports/standing'),

  reportLog: (fromIso: string, toIso: string): Promise<{ rows: LogReportRow[] }> =>
    request(
      `/api/reports/log?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
    ),

  reportTruck: (
    truck: string,
    fromIso: string,
    toIso: string,
  ): Promise<{ rows: Array<GateReportRow & { statement: 'IN' | 'OUT' }> }> =>
    request(
      `/api/reports/truck?truck=${encodeURIComponent(truck)}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
    ),

  /** الكشف مفتوحاً على كل السيارات: حركات الفترة كلها، دخولاً وخروجاً. */
  reportTruckAll: (
    fromIso: string,
    toIso: string,
  ): Promise<{ rows: Array<GateReportRow & { statement: 'IN' | 'OUT' }> }> =>
    request(
      `/api/reports/truck?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
    ),

  /** كشف سيارات ناقل واحد: كل ما حملته سياراته المسجَّلة، دخولاً وخروجاً. */
  reportCarrier: (
    carrierId: number,
    fromIso: string,
    toIso: string,
  ): Promise<{ rows: Array<GateReportRow & { statement: 'IN' | 'OUT' }> }> =>
    request(
      `/api/reports/truck?carrier=${String(carrierId)}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
    ),

  /** الناقلون وسياراتهم — ما تحتاجه البوابة للتعرّف على رقم مكتوب. */
  fleet: (): Promise<FleetDto> => request('/api/fleet'),

  /** الزونات التي عرّفها المالك — ما تحتاجه الخريطة لرسم ساحاته كلها. */
  zones: (): Promise<{ zones: CustomZoneDto[]; retired: RetiredZoneDto[] }> =>
    request('/api/zones'),

  addZone: (input: {
    yard: number;
    name: string;
    bays: number;
    stacks: number;
  }): Promise<CustomZoneDto> =>
    request('/api/zones', { method: 'POST', body: JSON.stringify(input) }),

  /**
   * تعديل شكل الزون — جزئياً: ما لا يُرسل لا يُمسّ، فتحريك الموقع لا يمسح
   * خانات أُغلقت قبله بلحظة.
   */
  editZone: (
    id: number,
    input: {
      bays?: number;
      stacks?: number;
      closed?: ReadonlyArray<readonly [number, number]>;
      x?: number | null;
      y?: number | null;
    },
  ): Promise<CustomZoneDto> =>
    request(`/api/zones/${String(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),

  removeZone: (id: number): Promise<{ ok: boolean }> =>
    request(`/api/zones/${String(id)}`, { method: 'DELETE' }),

  // ---- photos ----
  photos: (id: number): Promise<{ photos: PhotoDto[] }> =>
    request(`/api/containers/${String(id)}/photos`),
  /** The one non-JSON POST: the photo's own bytes, typed by the blob itself
   * — usually a shrunk copy, never the camera original. */
  addPhoto: async (id: number, file: Blob): Promise<{ id: number }> => {
    let response: Response;
    try {
      response = await fetch(`/api/containers/${String(id)}/photos`, {
        method: 'POST',
        body: file,
        headers: { 'content-type': file.type },
      });
    } catch {
      throw new ApiFailure('NETWORK', AR.networkError);
    }
    if (!response.ok) {
      let body: ApiError | null = null;
      try {
        body = (await response.json()) as ApiError;
      } catch {
        // Not JSON; the generic failure below carries the news.
      }
      if (body !== null && typeof body.code === 'string') {
        throw new ApiFailure(body.code, AR.errors[body.code] ?? AR.networkError, body.details);
      }
      throw new ApiFailure('NETWORK', AR.networkError);
    }
    return (await response.json()) as { id: number };
  },
  removePhoto: (id: number): Promise<{ ok: boolean }> =>
    request(`/api/photos/${String(id)}`, { method: 'DELETE' }),

  // ---- driver accounting ----
  drivers: (from: string, to: string): Promise<{ rows: DriverHaulRow[] }> =>
    request(`/api/drivers?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  setWage: (input: {
    containerId: number;
    direction: HaulDirection;
    amount: number;
  }): Promise<{ ok: boolean }> =>
    request('/api/wages', { method: 'PUT', body: JSON.stringify(input) }),
  clearWage: (input: {
    containerId: number;
    direction: HaulDirection;
  }): Promise<{ ok: boolean }> =>
    request('/api/wages/clear', { method: 'POST', body: JSON.stringify(input) }),
  payWage: (input: {
    containerId: number;
    direction: HaulDirection;
    paid: boolean;
  }): Promise<{ ok: boolean }> =>
    request('/api/wages/pay', { method: 'POST', body: JSON.stringify(input) }),
  /**
   * تصحيح الفئة: the class is NEVER sent — the bay decides it, exactly as at
   * the gate. `to` is absent only for a departed record whose exit movement
   * remembers no slot.
   */
  reclass: (id: number, to?: Position): Promise<{ container: ContainerDto }> =>
    request(`/api/containers/${String(id)}/reclass`, {
      method: 'POST',
      body: JSON.stringify(to === undefined ? {} : { to }),
    }),
  payMany: (input: {
    hauls: ReadonlyArray<{ containerId: number; direction: HaulDirection }>;
  }): Promise<{ ok: boolean; stamped: number }> =>
    request('/api/wages/pay-many', { method: 'POST', body: JSON.stringify(input) }),

  // ---- correcting a move ----
  correctMove: (
    movementId: number,
    to: Position,
  ): Promise<{ container: ContainerDto; move: MovementDto }> =>
    request(`/api/movements/${String(movementId)}/correct`, {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),

  /** السيارات التي كتبتها البوابة ولا تطابق أي سيارة مسجّلة — للتوزيع. */
  unassignedPlates: (): Promise<{ rows: UnassignedPlateRow[] }> =>
    request('/api/fleet/unassigned'),

  addCarrier: (name: string): Promise<CarrierDto> =>
    request('/api/carriers', { method: 'POST', body: JSON.stringify({ name }) }),

  renameCarrier: (id: number, name: string): Promise<CarrierDto> =>
    request(`/api/carriers/${String(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) }),

  removeCarrier: (id: number): Promise<{ ok: boolean }> =>
    request(`/api/carriers/${String(id)}`, { method: 'DELETE' }),

  addTruck: (input: {
    carrierId: number;
    code: string;
    number: string;
    driver: string;
  }): Promise<TruckDto> =>
    request('/api/trucks', { method: 'POST', body: JSON.stringify(input) }),

  /** تعديل بيانات سيارة، أو نقلها إلى ناقل آخر بتغيير carrierId — «توزيع». */
  editTruck: (
    id: number,
    input: { carrierId: number; code: string; number: string; driver: string },
  ): Promise<TruckDto> =>
    request(`/api/trucks/${String(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),

  removeTruck: (id: number): Promise<{ ok: boolean }> =>
    request(`/api/trucks/${String(id)}`, { method: 'DELETE' }),

  /** كشف البوليصة: every container under one bill, standing first. */
  reportBill: (bill: string): Promise<{ rows: ContainerDto[] }> =>
    request(`/api/reports/bill?number=${encodeURIComponent(bill)}`),

  /** الكشف مفتوحاً على كل البوالص: كل سجل حاوية، القائم أولاً. */
  reportBillAll: (): Promise<{ rows: ContainerDto[] }> => request('/api/reports/bill'),

  /**
   * تصريح تحميل وخروج داخلي: issue the paper for one bill's containers. The
   * server mints the yearly serial and hands the whole permit back, so the
   * paper can go straight to the printer.
   */
  createPermit: (input: {
    bill: string;
    items: ReadonlyArray<{ containerId: number; truck: string; weight: string }>;
  }): Promise<PermitDto> =>
    request('/api/permits', { method: 'POST', body: JSON.stringify(input) }),

  /** كشف خروج وتحميل داخلي: the permits issued in a period. */
  reportPermits: (fromIso: string, toIso: string): Promise<{ rows: PermitReportRow[] }> =>
    request(
      `/api/permits?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
    ),

  /** One permit exactly as issued — the register row's reprint. */
  permit: (id: number): Promise<PermitDto> => request(`/api/permits/${String(id)}`),

  /** Void a wrongly-issued permit; the year's book closes over its serial. */
  removePermit: (id: number): Promise<{ ok: boolean }> =>
    request(`/api/permits/${String(id)}`, { method: 'DELETE' }),

  /**
   * One tap, two copies: the server writes a dated snapshot beside the live
   * file and streams the same bytes back for the browser to save.
   */
  backup: async (): Promise<{ blob: Blob; filename: string }> => {
    let response: Response;
    try {
      response = await fetch('/api/backup', { method: 'POST' });
    } catch {
      throw new ApiFailure('NETWORK', AR.networkError);
    }
    if (!response.ok) throw new ApiFailure('NETWORK', AR.networkError);
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
    const filename = match?.[1] === undefined ? 'yard-backup.db' : decodeURIComponent(match[1]);
    return { blob: await response.blob(), filename };
  },

  /**
   * The owner's training tools. Temporary, for the period the staff are
   * learning on the live yard — they come out with OwnerToolsScreen.
   */
  ownerTools: (): Promise<{ wipePasswordSet: boolean }> => request('/api/owner/tools'),

  setWipePassword: (password: string): Promise<{ ok: boolean }> =>
    request('/api/owner/wipe-password', { method: 'POST', body: JSON.stringify({ password }) }),

  wipeData: (
    password: string,
  ): Promise<{
    ok: boolean;
    /** What actually went, counted from the tables themselves. */
    containers: number;
    movements: number;
    left: number;
    backup: string;
  }> =>
    request('/api/owner/wipe', { method: 'POST', body: JSON.stringify({ password }) }),

  seedDemo: (): Promise<{ added: number; departed: number; fullBay: string | null }> =>
    request('/api/owner/seed', { method: 'POST', body: JSON.stringify({}) }),

  /** Upload a .db backup and put the whole snapshot back. */
  restoreBackup: async (
    file: File,
  ): Promise<{
    ok: boolean;
    containers: number;
    movements: number;
    users: number;
    carriers: number;
    trucks: number;
    permits: number;
    zones: number;
    backup: string;
  }> => {
    let response: Response;
    try {
      response = await fetch('/api/owner/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: await file.arrayBuffer(),
      });
    } catch {
      throw new ApiFailure('NETWORK', AR.networkError);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiError | null;
      const code = body?.code ?? 'NETWORK';
      throw new ApiFailure(code, AR.errors[code as ErrorCode] ?? AR.networkError);
    }
    return (await response.json()) as {
      ok: boolean;
      containers: number;
      movements: number;
      users: number;
      carriers: number;
      trucks: number;
      permits: number;
      zones: number;
      backup: string;
    };
  },

  /** النقل الجماعي: a group of ids and one destination bay — the server plans. */
  moveMany: (ids: readonly number[], to: { zone: Zone; bay: number }): Promise<{ moved: number }> =>
    request('/api/containers/move-many', {
      method: 'POST',
      body: JSON.stringify({ ids, to }),
    }),

  /** تجديد الجلسة بلمسة إنسان — pinged on real interaction, throttled. */
  refreshSession: (): Promise<{ ok: boolean }> =>
    request('/api/session/refresh', { method: 'POST', body: JSON.stringify({}) }),

  // ---- مهام الآليات ----
  tasks: (status: TaskStatus, machine?: Handling, limit?: number): Promise<{ tasks: TaskDto[] }> =>
    request(
      `/api/tasks?status=${status}` +
        (machine === undefined ? '' : `&machine=${machine}`) +
        (limit === undefined ? '' : `&limit=${String(limit)}`),
    ),

  prepareTask: (containerId: number, machine?: Handling): Promise<TaskDto> =>
    request('/api/tasks/prepare', { method: 'POST', body: JSON.stringify({ containerId, machine }) }),

  prepareBill: (bill: string, machine?: Handling): Promise<{ created: number; skipped: number }> =>
    request('/api/tasks/prepare-bill', { method: 'POST', body: JSON.stringify({ bill, machine }) }),

  taskDone: (id: number): Promise<TaskDto> =>
    request(`/api/tasks/${String(id)}/done`, { method: 'POST', body: JSON.stringify({}) }),

  taskUrgent: (id: number, urgent: boolean): Promise<TaskDto> =>
    request(`/api/tasks/${String(id)}/urgent`, { method: 'POST', body: JSON.stringify({ urgent }) }),

  taskMachine: (id: number, machine: Handling): Promise<TaskDto> =>
    request(`/api/tasks/${String(id)}/machine`, { method: 'POST', body: JSON.stringify({ machine }) }),

  // ---- دفعات كشف الجمارك ----
  /** Read the sheet on the server and answer what it says — stores nothing. */
  previewBatch: (file: File): Promise<{ rows: SheetRow[] }> => uploadSheet('/api/batches/preview', file),

  /** Approve: the same bytes again — the deterministic reader keeps its word. */
  createBatch: (file: File, name: string): Promise<BatchDto> =>
    uploadSheet(
      `/api/batches?name=${encodeURIComponent(name)}&filename=${encodeURIComponent(file.name)}`,
      file,
    ),

  batches: (): Promise<{ batches: BatchSummaryDto[] }> => request('/api/batches'),

  batch: (id: number): Promise<BatchDto> => request(`/api/batches/${String(id)}`),

  removeBatch: (id: number): Promise<{ ok: boolean }> =>
    request(`/api/batches/${String(id)}`, { method: 'DELETE' }),

  /** The gate's live question: does an open دفعة expect this number? */
  batchLookup: (number: string): Promise<{ match: BatchMatch | null }> =>
    request(`/api/batches/lookup?number=${encodeURIComponent(number)}`),

  /** تغيير كلمة سر المالك — his current word first, six letters at least. */
  changeOwnerPassword: (current: string, password: string): Promise<{ ok: boolean }> =>
    request('/api/owner-password', {
      method: 'POST',
      body: JSON.stringify({ current, password }),
    }),

  /**
   * الطباعة الكلية للبطاقات — للمالك: the card DATA of a range, ordered by
   * serial. The Arabic card around it is written here on the client.
   */
  cardRows: (kind: 'in' | 'out' | 'move', fromIso: string, toIso: string): Promise<{ rows: CardSheetRow[] }> =>
    request(
      `/api/reports/cards?kind=${kind}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
    ),

  /** The bulk card book as one server-printed PDF — the owner's route. */
  cardsPdf: async (title: string, html: string): Promise<Blob> => {
    let response: Response;
    try {
      response = await fetch('/api/reports/cards-pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, html }),
      });
    } catch {
      throw new ApiFailure('NETWORK', AR.networkError);
    }
    if (!response.ok) throw new ApiFailure('NETWORK', AR.networkError);
    return response.blob();
  },

  /** The sheet as a server-printed PDF file. */
  reportPdf: async (title: string, html: string, landscape: boolean): Promise<Blob> => {
    let response: Response;
    try {
      response = await fetch('/api/reports/pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, html, landscape }),
      });
    } catch {
      throw new ApiFailure('NETWORK', AR.networkError);
    }
    if (!response.ok) throw new ApiFailure('NETWORK', AR.networkError);
    return response.blob();
  },

  edit: (id: number, input: ContainerEditInput): Promise<ContainerDto> =>
    request(`/api/containers/${String(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),

  remove: (id: number): Promise<{ ok: boolean }> =>
    request(`/api/containers/${String(id)}`, { method: 'DELETE' }),

  /** Undo a soft delete: the record returns, standing back if its slot allows. */
  restore: (id: number): Promise<ContainerDto> =>
    request(`/api/containers/${String(id)}/restore`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  search: (q: string): Promise<{ results: ContainerDto[] }> =>
    request(`/api/containers?q=${encodeURIComponent(q)}`),

  detail: (id: number): Promise<{ container: ContainerDto; movements: MovementDto[] }> =>
    request(`/api/containers/${String(id)}`),
};

// Latin digit order (dd/mm/yyyy) so the date never scrambles inside RTL text
// — the ar-JO date pattern carries RLM marks that visually reverse it. The
// same split sheetKit and PrintCard already use; api.ts cannot import them
// back without inverting the layering.
const dateOnlyFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'short',
  timeZone: 'Asia/Amman',
});
/** 12-hour clock with the Arabic م/ص marker, Western digits. */
const timeOnlyFormat = new Intl.DateTimeFormat('ar-JO-u-nu-latn', {
  timeStyle: 'short',
  timeZone: 'Asia/Amman',
});

/** dd/mm/yyyy — render it inside a dir="ltr" element. */
export function formatDateOnly(iso: string): string {
  return dateOnlyFormat.format(new Date(iso));
}

/** h:mm م/ص — render it inside a dir="ltr" element. */
export function formatTimeOnly(iso: string): string {
  return timeOnlyFormat.format(new Date(iso));
}

/** Date then time in one run — must be rendered inside dir="ltr". */
export function formatDate(iso: string): string {
  return `${formatDateOnly(iso)}، ${formatTimeOnly(iso)}`;
}

/**
 * Calendar days in the yard. The counting itself lives in `shared/dates` so
 * the screen and the register can never disagree about what a day is.
 */
export function dwellDays(enteredAt: string, until?: string): number {
  return daysBetween(enteredAt, until ?? new Date());
}

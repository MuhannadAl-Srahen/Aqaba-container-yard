import type {
  ApiError,
  ContainerDto,
  ErrorCode,
  MovementDto,
  Position,
  YardConfig,
  YardStateDto,
} from '../shared/types';
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
    response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
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
      const by = body.details?.['by'];
      const arabic =
        typeof by === 'string'
          ? AR.errorWithBy(body.code, by)
          : (AR.errors[body.code] ?? AR.networkError);
      throw new ApiFailure(body.code, arabic, body.details);
    }
    throw new ApiFailure('NETWORK', AR.networkError);
  }

  return (await response.json()) as T;
}

export interface BootDto {
  firstRun: boolean;
  authorized: boolean;
  yardConfigured: boolean;
}

export const api = {
  boot: (): Promise<BootDto> => request('/api/boot'),

  setup: (password: string, yard: YardConfig): Promise<{ ok: boolean }> =>
    request('/api/setup', { method: 'POST', body: JSON.stringify({ password, yard }) }),

  login: (password: string): Promise<{ ok: boolean }> =>
    request('/api/login', { method: 'POST', body: JSON.stringify({ password }) }),

  logout: (): Promise<{ ok: boolean }> => request('/api/logout', { method: 'POST' }),

  state: (): Promise<YardStateDto> => request('/api/state'),

  gateIn: (input: {
    number: string;
    size: 20 | 40;
    customer: string;
    cargo: 'EMPTY' | 'LADEN';
    notes: string;
    position: Position;
  }): Promise<ContainerDto> =>
    request('/api/containers', { method: 'POST', body: JSON.stringify(input) }),

  move: (id: number, to: Position): Promise<ContainerDto> =>
    request(`/api/containers/${String(id)}/move`, {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),

  exit: (id: number): Promise<ContainerDto> =>
    request(`/api/containers/${String(id)}/exit`, { method: 'POST' }),

  edit: (
    id: number,
    input: { number: string; customer: string; cargo: 'EMPTY' | 'LADEN'; notes: string },
  ): Promise<ContainerDto> =>
    request(`/api/containers/${String(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),

  remove: (id: number): Promise<{ ok: boolean }> =>
    request(`/api/containers/${String(id)}`, { method: 'DELETE' }),

  search: (q: string): Promise<{ results: ContainerDto[] }> =>
    request(`/api/containers?q=${encodeURIComponent(q)}`),

  detail: (id: number): Promise<{ container: ContainerDto; movements: MovementDto[] }> =>
    request(`/api/containers/${String(id)}`),
};

const dateFormat = new Intl.DateTimeFormat('ar-JO-u-nu-latn', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Amman',
});

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function dwellDays(enteredAt: string, until?: string): number {
  const end = until === undefined ? Date.now() : new Date(until).getTime();
  const days = Math.floor((end - new Date(enteredAt).getTime()) / 86_400_000);
  return Math.max(0, days);
}

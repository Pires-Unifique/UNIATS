/**
 * Cliente HTTP do frontend. Centraliza:
 *  - URL base da API (NEXT_PUBLIC_API_BASE_URL).
 *  - Anexo de Bearer token (Azure AD) via callback que o AuthProvider configura.
 *  - Tratamento de 401 (sessão expirada) e mensagens de erro amigáveis.
 *  - Validação opcional de schema com Zod.
 */
import { z } from 'zod';

const BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider = async () => null;

/** Chamado pelo AuthProvider no boot. */
export function configurarTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  schema?: z.ZodType<T>;
  /** Se `true`, retorna `null` em 404 em vez de lançar. */
  toleraNotFound?: boolean;
  signal?: AbortSignal;
}

export async function api<T = unknown>(
  path: string,
  opts: RequestOptions<T> = {},
): Promise<T> {
  const url = new URL(path.startsWith('http') ? path : `${BASE_URL}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }

  const isFormData =
    typeof FormData !== 'undefined' && opts.body instanceof FormData;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  // Para FormData o browser define o Content-Type (com boundary) sozinho.
  if (opts.body !== undefined && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  const token = await tokenProvider();
  if (token) headers.Authorization = `Bearer ${token}`;

  const resp = await fetch(url.toString(), {
    method: opts.method ?? 'GET',
    headers,
    body:
      opts.body === undefined
        ? undefined
        : isFormData
          ? (opts.body as FormData)
          : JSON.stringify(opts.body),
    credentials: 'include',
    signal: opts.signal,
  });

  if (resp.status === 401) {
    if (typeof window !== 'undefined') {
      window.location.href = '/login?expired=1';
    }
    throw new ApiError('Sessão expirada.', 401, null);
  }
  if (resp.status === 404 && opts.toleraNotFound) {
    return null as T;
  }

  if (!resp.ok) {
    let body: unknown = null;
    try {
      body = await resp.json();
    } catch {
      try {
        body = await resp.text();
      } catch {
        /* ignore */
      }
    }
    const msg =
      (body as { message?: string })?.message ?? `Erro HTTP ${resp.status}`;
    throw new ApiError(msg, resp.status, body);
  }

  if (resp.status === 204) return undefined as T;

  const data = await resp.json();
  if (opts.schema) {
    const parsed = opts.schema.safeParse(data);
    if (!parsed.success) {
      throw new ApiError(
        `Resposta inválida da API: ${parsed.error.message}`,
        500,
        data,
      );
    }
    return parsed.data;
  }
  return data as T;
}

/**
 * Baixa um arquivo de um endpoint autenticado (anexa o Bearer token e dispara o
 * download no navegador via Blob). Usado p/ o termo de desligamento, que o `api`
 * acima não atende (ele sempre faz parse de JSON).
 */
export async function baixarArquivo(
  path: string,
  filenameFallback = 'arquivo',
): Promise<void> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const headers: Record<string, string> = {};
  const token = await tokenProvider();
  if (token) headers.Authorization = `Bearer ${token}`;

  const resp = await fetch(url, { headers, credentials: 'include' });
  if (!resp.ok) {
    throw new ApiError(`Erro HTTP ${resp.status}`, resp.status, null);
  }

  // Nome do arquivo a partir do Content-Disposition, se houver.
  const cd = resp.headers.get('Content-Disposition') ?? '';
  const m = /filename="?([^"]+)"?/.exec(cd);
  const filename = m?.[1] ?? filenameFallback;

  const blob = await resp.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

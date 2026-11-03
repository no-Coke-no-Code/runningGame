import { ElMessage } from 'element-plus';

/**
 * 后端统一响应结构（按实际后端约定调整：
 * 这里假设 { code: 0, data: T, message: string } 为成功）
 */
interface ApiResult<T = unknown> {
  code: number;
  data: T;
  message: string;
}

class RequestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: number,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
const TIMEOUT = 15000;
const TOKEN_KEY = 'app_token';

/* ---------- Token 管理 ---------- */
function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/* ---------- 请求核心 ---------- */
interface RequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  data?: unknown;
  headers?: Record<string, string>;
  /** 是否静默处理错误（不弹出全局提示），默认 false */
  silent?: boolean;
  signal?: AbortSignal;
}

function buildUrl(url: string, params?: RequestOptions['params']): string {
  const full = /^https?:\/\//.test(url) ? url : `${BASE_URL}${url}`;
  if (!params) return full;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.append(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${full}${full.includes('?') ? '&' : '?'}${qs}` : full;
}

async function request<T>(method: string, url: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(buildUrl(url, options.params), {
      method,
      headers,
      body: options.data === undefined ? undefined : JSON.stringify(options.data),
      signal: options.signal ?? controller.signal,
    });

    if (res.status === 401) {
      setToken(null);
      throw new RequestError('登录已过期，请重新登录', 401);
    }
    if (!res.ok) {
      throw new RequestError(`请求失败（HTTP ${res.status}）`, res.status);
    }

    const body = (await res.json()) as ApiResult<T>;
    if (body.code !== 0) {
      throw new RequestError(body.message || '业务处理失败', res.status, body.code);
    }
    return body.data;
  } catch (err) {
    const normalized =
      err instanceof RequestError
        ? err
        : new RequestError(
            err instanceof DOMException && err.name === 'AbortError'
              ? '请求超时，请稍后重试'
              : '网络异常，请检查网络连接',
          );
    if (!options.silent) ElMessage.error(normalized.message);
    throw normalized;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- 对外方法 ---------- */
export const http = {
  get<T>(url: string, params?: RequestOptions['params'], options?: Omit<RequestOptions, 'params'>) {
    return request<T>('GET', url, { ...options, params });
  },
  post<T>(url: string, data?: unknown, options?: Omit<RequestOptions, 'data'>) {
    return request<T>('POST', url, { ...options, data });
  },
};

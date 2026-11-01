import { BACKEND_URL, getApiUrl, getBackendBaseUrl } from '@/llmai_constant';

export { BACKEND_URL, getApiUrl, getBackendBaseUrl };

const TOKEN_KEY = 'freellmapi_dashboard_token';

// Dashboard session token (#35). Stored in localStorage; sent as a Bearer on
// every /api request and cleared on a 401.
export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token: string): void {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
}
export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('freellmapi_jwt');
    localStorage.removeItem('freellmapi_mother_id');
    localStorage.removeItem('freellmapi_company_name');
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem('freellmapi_jwt');
  } catch { /* ignore */ }
}

export const UNAUTHORIZED_EVENT = 'freellmapi:unauthorized';

// Error thrown by apiFetch on a non-2xx response. Carries the HTTP status and
// the server's machine-readable `error.type` so callers can branch on them.
export interface ApiError extends Error {
  status?: number;
  code?: string;
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(options?.headers);
  const isFormData = typeof FormData !== 'undefined' && options?.body instanceof FormData;
  if (!isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const isAuthEndpoint = path.startsWith('/api/auth/login') || path.startsWith('/api/auth/register') || path.startsWith('/api/auth/setup') || path.startsWith('/api/auth/forgot-password');
  if (token && !isAuthEndpoint) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const url = getApiUrl(path);
  const res = await fetch(url, {
    // `...options` first so an explicit method/body/signal applies, but headers
    // are merged last — otherwise an options.headers would clobber the
    // Content-Type and Authorization we set here.
    ...options,
    headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: res.statusText } }));
    // A 401 ends the dashboard session ONLY when it is OUR auth saying so.
    // Discover/probe endpoints deliberately relay an upstream provider's 401
    // ("the endpoint rejected the key") with its status intact; treating those
    // as session-expired signed the operator out every time they tested a bad
    // provider key. The auth middleware and every session 401 carry
    // type 'authentication_error'; upstream relays never do.
    if (res.status === 401 && body.error?.type === 'authentication_error') {
      clearToken();
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    // Surface the HTTP status and the machine-readable error type on the thrown
    // Error so callers can branch on them (e.g. the setup form reveals a code
    // field on a `setup_code_required` 403). `.message` behaviour is unchanged.
    // Most routes send { error: { message, type } }; some (e.g. /api/premium)
    // send { error: '...' }. Without the string case those users only saw
    // "HTTP 502".
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    const err = new Error(message || `HTTP ${res.status}`) as ApiError;
    err.status = res.status;
    err.code = body.error?.type;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  // A 200 whose body isn't JSON means this request never reached the API — the
  // usual cause is a reverse proxy (or static host) serving the dashboard's
  // index.html for /api/* instead of forwarding it to the backend. Without this
  // guard the raw res.json() throws an opaque "Unexpected token '<'", which on
  // the setup/login form surfaces as "sign up page cannot work". Say what's
  // actually wrong. (#257)
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Expected JSON from ${url} but got a non-JSON response. ` +
      `Make sure the backend is running and reachable at ${getBackendBaseUrl() || 'the current origin'}, ` +
      `and that /api is forwarded to it.`,
    );
  }
}

export async function logout(): Promise<void> {
  try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  clearToken();
  try { sessionStorage.clear(); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));

  // Clean hard navigation to login / root
  if (typeof window !== 'undefined') {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '';
    window.location.href = `${base}/`;
  }
}

/**
 * llmai_constant.ts (Frontend Client)
 *
 * Central configuration constants for PolarAI Client.
 * When hosting the backend on a separate server (e.g. Render, Railway, VPS, EC2),
 * set your backend URL below, or set VITE_BACKEND_URL in your environment.
 */

// If you want to hardcode your backend server URL, specify it here:
// e.g. export const HARDCODED_BACKEND_URL = 'https://api.yourdomain.com';
export const HARDCODED_BACKEND_URL: string = '';

/**
 * Resolves the configured backend server URL.
 * Priority:
 * 1. localStorage override ('polarai_backend_url' or 'freellmai_backend_url')
 * 2. HARDCODED_BACKEND_URL (defined above)
 * 3. Environment variables (VITE_BACKEND_URL, VITE_API_BASE_URL, VITE_API_URL)
 * 4. Empty string '' (meaning relative same-origin / proxy)
 */
export function getBackendBaseUrl(): string {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('polarai_backend_url') || localStorage.getItem('freellmai_backend_url');
      if (stored && stored.trim()) {
        return stored.trim().replace(/\/$/, '');
      }
    } catch {
      // ignore
    }
  }

  if (HARDCODED_BACKEND_URL && HARDCODED_BACKEND_URL.trim()) {
    return HARDCODED_BACKEND_URL.trim().replace(/\/$/, '');
  }

  const envUrl = (
    import.meta.env.VITE_BACKEND_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_API_URL ||
    ''
  ).trim();

  return envUrl.replace(/\/$/, '');
}

export const BACKEND_URL = getBackendBaseUrl();

/**
 * Returns the full URL for an API or service endpoint path.
 * If backend URL is set (e.g. 'https://api.example.com'), prepends it:
 * getApiUrl('/api/auth/status') -> 'https://api.example.com/api/auth/status'
 */
export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const baseBackend = getBackendBaseUrl();
  if (baseBackend) {
    return `${baseBackend}${cleanPath}`;
  }
  const routerBase = (import.meta.env.BASE_URL || '').replace(/\/$/, '');
  return `${routerBase}${cleanPath}`;
}

export const LLMAI_FRONTEND_CONSTANTS = {
  get BACKEND_URL() {
    return getBackendBaseUrl();
  },
  getApiUrl,
};

export default LLMAI_FRONTEND_CONSTANTS;

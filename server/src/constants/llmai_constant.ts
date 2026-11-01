/**
 * llmai_constant.ts
 *
 * Central configuration constants for FreeLLMAPI.
 * Dynamically resolves PolarList Java Backend endpoints based on environment variables.
 */

/**
 * Dynamically resolves the PolarList AI Login endpoint URL.
 * Priority:
 * 1. process.env.POLAR_AI_LOGIN_URL (explicit endpoint URL)
 * 2. process.env.POLAR_JAVA_BACKEND_URL or process.env.POLAR_BACKEND_URL (base URL, e.g. http://localhost:8001)
 * 3. Fallback: http://localhost:8001/api/v1/auth/ai-login (local backend default)
 */
export function getPolarAiLoginUrl(): string {
  const explicit = process.env.POLAR_AI_LOGIN_URL;
  if (explicit && explicit.trim()) {
    return explicit.trim();
  }

  const base = process.env.POLAR_JAVA_BACKEND_URL || process.env.POLAR_BACKEND_URL;
  if (base && base.trim()) {
    const trimmed = base.trim().replace(/\/+$/, '');
    if (trimmed.includes('/api/v1/auth/ai-login')) {
      return trimmed;
    }
    if (trimmed.includes('/api/v1/auth')) {
      return `${trimmed}/ai-login`;
    }
    return `${trimmed}/api/v1/auth/ai-login`;
  }

  // Default to local Java Spring Boot backend on port 8001
  return 'http://localhost:8001/api/v1/auth/ai-login';
}

/**
 * Dynamically resolves the PolarList QR Code Validation endpoint URL.
 */
export function getPolarQrValidateUrl(): string {
  const explicit = process.env.POLAR_QR_VALIDATE_URL;
  if (explicit && explicit.trim()) {
    return explicit.trim();
  }

  const base = process.env.POLAR_JAVA_BACKEND_URL || process.env.POLAR_BACKEND_URL;
  if (base && base.trim()) {
    const trimmed = base.trim().replace(/\/+$/, '');
    if (trimmed.includes('/api/v1/auth/qr-code/validate')) {
      return trimmed;
    }
    if (trimmed.includes('/api/v1/auth')) {
      return `${trimmed}/qr-code/validate`;
    }
    return `${trimmed}/api/v1/auth/qr-code/validate`;
  }

  return 'https://polardata.polarlist.in/api/v1/auth/qr-code/validate';
}

export const LLMAI_CONSTANTS = {
  // PolarList QR code validation endpoint
  get POLAR_QR_VALIDATE_URL() {
    return getPolarQrValidateUrl();
  },

  // PolarList AI login endpoint
  get POLAR_AI_LOGIN_URL() {
    return getPolarAiLoginUrl();
  },

  // Request headers for internal upstream calls to Polar backend
  POLAR_API_HEADERS: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
    'Referer': 'https://my.polarlist.in/',
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
  },
};

export default LLMAI_CONSTANTS;

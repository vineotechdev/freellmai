/**
 * llmai_constant.js
 * Root reference for FreeLLMAPI constants
 */

function getPolarAiLoginUrl() {
  const explicit = process.env.POLAR_AI_LOGIN_URL;
  if (explicit && explicit.trim()) return explicit.trim();
  const base = process.env.POLAR_JAVA_BACKEND_URL || process.env.POLAR_BACKEND_URL;
  if (base && base.trim()) {
    const trimmed = base.trim().replace(/\/+$/, '');
    if (trimmed.includes('/api/v1/auth/ai-login')) return trimmed;
    if (trimmed.includes('/api/v1/auth')) return `${trimmed}/ai-login`;
    return `${trimmed}/api/v1/auth/ai-login`;
  }
  return 'http://localhost:8001/api/v1/auth/ai-login';
}

function getPolarQrValidateUrl() {
  const explicit = process.env.POLAR_QR_VALIDATE_URL;
  if (explicit && explicit.trim()) return explicit.trim();
  const base = process.env.POLAR_JAVA_BACKEND_URL || process.env.POLAR_BACKEND_URL;
  if (base && base.trim()) {
    const trimmed = base.trim().replace(/\/+$/, '');
    if (trimmed.includes('/api/v1/auth/qr-code/validate')) return trimmed;
    if (trimmed.includes('/api/v1/auth')) return `${trimmed}/qr-code/validate`;
    return `${trimmed}/api/v1/auth/qr-code/validate`;
  }
  return 'https://polardata.polarlist.in/api/v1/auth/qr-code/validate';
}


module.exports = {
  getPolarAiLoginUrl,
  getPolarQrValidateUrl,
  POLAR_QR_VALIDATE_URL: getPolarQrValidateUrl(),
  POLAR_AI_LOGIN_URL: getPolarAiLoginUrl(),
};

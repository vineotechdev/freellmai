/**
 * llmai_constant.ts
 *
 * Central configuration constants for FreeLLMAPI.
 * Update POLAR_QR_VALIDATE_URL here if the Polar backend endpoint changes.
 */

export const LLMAI_CONSTANTS = {
  // PolarList QR code validation endpoint
  POLAR_QR_VALIDATE_URL: process.env.POLAR_QR_VALIDATE_URL || 'https://polardata.polarlist.in/api/v1/auth/qr-code/validate',

  // PolarList AI login endpoint
  POLAR_AI_LOGIN_URL: process.env.POLAR_AI_LOGIN_URL || 'https://polardata.polarlist.in/api/v1/auth/ai-login',

  // Request headers for internal upstream calls to Polar backend
  POLAR_API_HEADERS: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
    'Referer': 'https://my.polarlist.in/',
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
  },
};

export const POLAR_QR_VALIDATE_URL = LLMAI_CONSTANTS.POLAR_QR_VALIDATE_URL;
export const POLAR_AI_LOGIN_URL = LLMAI_CONSTANTS.POLAR_AI_LOGIN_URL;

export default LLMAI_CONSTANTS;


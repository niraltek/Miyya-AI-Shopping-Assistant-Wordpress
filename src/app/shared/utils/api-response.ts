import { HttpErrorResponse } from '@angular/common/http';

export const REQUEST_FAILED_MESSAGE = 'The request could not be completed. Please try again.';

export function responseMessage(value: unknown, depth = 0): string | null {
  if (depth > 6 || value == null) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text || /<(?:!doctype|html)\b/i.test(text)) return null;
    if (/^[\[{]/.test(text)) {
      try {
        return responseMessage(JSON.parse(text), depth + 1);
      } catch {
        return null;
      }
    }
    return text;
  }
  if (Array.isArray(value)) {
    const messages = value.map((item) => responseMessage(item, depth + 1)).filter(Boolean);
    return messages.length ? messages.join('; ') : null;
  }
  if (typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  for (const key of ['detail', 'error', 'message', 'msg', 'data']) {
    const message = responseMessage(body[key], depth + 1);
    if (message) return message;
  }
  return null;
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    return responseMessage(error.error) ?? REQUEST_FAILED_MESSAGE;
  }
  if (error instanceof TypeError || error instanceof SyntaxError) return REQUEST_FAILED_MESSAGE;
  return responseMessage(error) ?? REQUEST_FAILED_MESSAGE;
}

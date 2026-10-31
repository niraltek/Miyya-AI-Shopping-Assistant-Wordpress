import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorMessage, REQUEST_FAILED_MESSAGE, responseMessage } from './api-response';

describe('API response messages', () => {
  it.each([
    [{ message: 'The store needs to reconnect.' }, 'The store needs to reconnect.'],
    [{ detail: 'Catalog sync is already running.' }, 'Catalog sync is already running.'],
    [
      { detail: { code: 'CAPACITY', message: 'Please try after the current import.' } },
      'Please try after the current import.',
    ],
    [{ error: { message: 'The connection was refused.' } }, 'The connection was refused.'],
    [{ detail: [{ loc: ['body', 'name'], msg: 'Name is required' }] }, 'Name is required'],
    [
      '{"detail":{"message":"The service is temporarily unavailable."}}',
      'The service is temporarily unavailable.',
    ],
  ])('reads the server response shape %#', (body, expected) => {
    expect(responseMessage(body)).toBe(expected);
  });

  it('prefers an HTTP response body over Angular transport wording', () => {
    const error = new HttpErrorResponse({
      status: 429,
      error: { message: 'Try again in 30 seconds.' },
    });
    expect(apiErrorMessage(error)).toBe('Try again in 30 seconds.');
  });

  it('keeps a streamed backend failure message', () => {
    expect(apiErrorMessage(new Error('Your store has no spendable credits.'))).toBe(
      'Your store has no spendable credits.',
    );
  });

  it('uses one fallback when the server supplies no readable response', () => {
    expect(apiErrorMessage(new HttpErrorResponse({ status: 0 }))).toBe(REQUEST_FAILED_MESSAGE);
    expect(
      apiErrorMessage(new HttpErrorResponse({ status: 502, error: '<html>Gateway error</html>' })),
    ).toBe(REQUEST_FAILED_MESSAGE);
    expect(apiErrorMessage(null)).toBe(REQUEST_FAILED_MESSAGE);
  });

  it('ignores empty or malformed message fields', () => {
    expect(responseMessage({ message: '', detail: { message: 7 } })).toBeNull();
  });
});

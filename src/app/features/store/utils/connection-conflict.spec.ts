import { HttpErrorResponse } from '@angular/common/http';
import { storeIdentityConflict } from './connection-conflict';

describe('storeIdentityConflict', () => {
  it('recognizes verified identity conflicts and retains only public approval fields', () => {
    expect(
      storeIdentityConflict(
        new HttpErrorResponse({
          status: 409,
          error: {
            detail: {
              code: 'STORE_IDENTITY_CONFLICT',
              message: 'Approve the move.',
              handshakeId: 'request-1',
            },
          },
        }),
      ),
    ).toEqual({
      code: 'STORE_IDENTITY_CONFLICT',
      message: 'Approve the move.',
      handshakeId: 'request-1',
    });
  });

  it('does not mistake pending verification or an unrelated failure for a migration decision', () => {
    expect(
      storeIdentityConflict(
        new HttpErrorResponse({
          status: 409,
          error: { detail: 'Connection verification is still pending.' },
        }),
      ),
    ).toBeNull();
    expect(
      storeIdentityConflict(
        new HttpErrorResponse({ status: 503, error: { code: 'STORE_IDENTITY_CONFLICT' } }),
      ),
    ).toBeNull();
  });
});

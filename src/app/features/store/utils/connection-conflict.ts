import { HttpErrorResponse } from '@angular/common/http';
import { StoreIdentityConflict } from '../models/woocommerce';

export function storeIdentityConflict(error: unknown): StoreIdentityConflict | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 409) return null;
  const detail = error.error?.detail ?? error.error;
  if (!detail || detail.code !== 'STORE_IDENTITY_CONFLICT') return null;
  return {
    code: 'STORE_IDENTITY_CONFLICT',
    message:
      typeof detail.message === 'string'
        ? detail.message
        : 'This installation is connected at another address.',
    handshakeId: typeof detail.handshakeId === 'string' ? detail.handshakeId : null,
  };
}

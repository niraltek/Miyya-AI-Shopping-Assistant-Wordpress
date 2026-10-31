import { inject, Service } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Service()
export class MerchantApiService {
  private readonly http = inject(HttpClient);

  request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const config = window.AIAssistantConfig;
    if (!config?.merchantApiUrl || !config.restNonce) {
      return Promise.reject(new Error('Open Miyya in WordPress administration to manage this store.'));
    }
    return firstValueFrom(
      this.http.request<T>(method, `${config.merchantApiUrl}${path}`, {
        body,
        headers: { 'X-WP-Nonce': config.restNonce },
        withCredentials: true,
      }),
    );
  }
}

import { Service, signal } from '@angular/core';
import {
  apiErrorMessage,
  responseMessage,
  REQUEST_FAILED_MESSAGE,
} from '../../../../shared/utils/api-response';
import { WebhookRegistrationResult, StoreDisconnectResponse } from '../../models/webhook';

@Service()
export class WebhookService {
  private readonly config = window.AIAssistantConfig;
  private readonly siteLinked = signal(this.config?.hasSiteToken !== false);

  async registerProductWebhooks(
    provisionToken?: string | null,
  ): Promise<WebhookRegistrationResult> {
    const url = this.config?.webhookRegisterUrl;
    const nonce = this.config?.restNonce;
    if (!url || !nonce) {
      return { outcome: 'skipped' };
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
        credentials: 'same-origin',
        body: JSON.stringify(provisionToken ? { provisionToken } : {}),
      });
      const body = await response.json().catch(() => null);
      if (response.ok) {
        this.confirmSiteLink();
        return { outcome: 'registered', topics: body?.topics ?? [] };
      }
      if (response.status === 409) {
        return {
          outcome: 'not-connected',
          message: responseMessage(body) ?? REQUEST_FAILED_MESSAGE,
        };
      }
      return { outcome: 'failed', message: responseMessage(body) ?? REQUEST_FAILED_MESSAGE };
    } catch (error) {
      return { outcome: 'failed', message: apiErrorMessage(error) };
    }
  }

  isSiteLinked(): boolean {
    return this.siteLinked();
  }

  confirmSiteLink(): void {
    this.siteLinked.set(true);
  }

  async disconnectStore(): Promise<StoreDisconnectResponse> {
    const url = this.config?.webhookDisconnectUrl;
    const nonce = this.config?.restNonce;
    if (!url || !nonce) {
      return { ok: false, message: 'Disconnecting is only available from your WordPress admin.' };
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
        credentials: 'same-origin',
      });
      if (response.ok) {
        this.siteLinked.set(false);
        return { ok: true };
      }
      const body = await response.json().catch(() => null);
      return {
        ok: false,
        message: responseMessage(body) ?? REQUEST_FAILED_MESSAGE,
        reason: body?.reason,
      };
    } catch (error) {
      return { ok: false, message: apiErrorMessage(error) };
    }
  }
}

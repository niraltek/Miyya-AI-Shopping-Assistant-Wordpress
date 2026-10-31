import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { WebhookService } from './webhook-service';

describe('WebhookService site link', () => {
  const original = window.AIAssistantConfig;

  afterEach(() => {
    window.AIAssistantConfig = original;
    vi.unstubAllGlobals();
  });

  function create(): WebhookService {
    window.AIAssistantConfig = {
      hasSiteToken: false,
      restNonce: 'n',
      webhookRegisterUrl: '/register',
      webhookDisconnectUrl: '/disconnect',
    } as never;
    return TestBed.inject(WebhookService);
  }

  it('reports linked once registration succeeds, without a page reload', async () => {
    const service = create();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ topics: [] }) }),
    );

    expect(service.isSiteLinked()).toBe(false);
    await service.registerProductWebhooks('token');
    expect(service.isSiteLinked()).toBe(true);
  });

  it('reports unlinked again after a disconnect', async () => {
    const service = create();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    await service.registerProductWebhooks('token');
    await service.disconnectStore();
    expect(service.isSiteLinked()).toBe(false);
  });
});

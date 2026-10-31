import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { MerchantApiService } from '../../../../core/services/merchant-api-service/merchant-api-service';
import { WebhookService } from '../../services/webhook-service/webhook-service';
import { WooCommerceService } from '../../services/woocommerce-service/woocommerce-service';
import { SettingsComponent } from './settings-component';

describe('SettingsComponent', () => {
  let component: SettingsComponent;
  let fixture: ComponentFixture<SettingsComponent>;
  let merchantApi: { request: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    // The live-website and design-format pickers load and save through these WordPress
    // routes, so they are stubbed rather than left to reject.
    merchantApi = {
      request: vi
        .fn()
        .mockImplementation(
          (_method: string, path: string, body?: { mode?: string; layout?: string }) =>
            path === 'widget/layout'
              ? Promise.resolve({ layout: body?.layout ?? 'classic' })
              : Promise.resolve({
                  mode: body?.mode ?? 'everyone',
                  enabled: body?.mode !== 'hidden',
                }),
        ),
    };

    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        // Settings injects WooCommerceService (for connection status), which injects
        // HttpClient, and navigates to /connect after a successful disconnect.
        // Disconnect itself goes through WebhookService, which uses fetch against this
        // site's own WordPress route rather than HttpClient — the backend's revoke needs
        // the site token, and that never leaves PHP.
        provideHttpClient(),
        provideRouter([]),
        { provide: MerchantApiService, useValue: merchantApi },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('has no sync interval control', () => {
    const view = fixture.nativeElement as HTMLElement;
    expect(view.querySelector('[aria-label="Sync interval"]')).toBeNull();
    expect(view.textContent).not.toContain('Catalog updates');
  });

  it('reports no connected store when WordPress injected no identity', () => {
    // window.AIAssistantConfig is undefined outside WordPress, so ngOnInit returns
    // early without calling the backend and the disconnect section stays hidden.
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Not connected');
    expect(compiled.textContent).toContain('Connect your store');
  });

  describe('the store connection card', () => {
    const identity = { email: 'owner@example.com', storeUrl: 'https://shop.example.com' };

    it('shows disconnect without a refresh when the status check restores the reinstall link', async () => {
      const originalConfig = window.AIAssistantConfig;
      window.AIAssistantConfig = { route: '/settings', ...identity, hasSiteToken: false };
      let finish!: (value: { status: string; store: { storeUrl: string } }) => void;
      const connection = new Promise((resolve) => (finish = resolve));
      merchantApi.request.mockImplementation((_method: string, path: string) => {
        if (path === 'connection/status') return connection;
        return Promise.resolve(
          path === 'widget/layout' ? { layout: 'classic' } : { mode: 'everyone' },
        );
      });
      try {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
          imports: [SettingsComponent],
          providers: [provideRouter([]), { provide: MerchantApiService, useValue: merchantApi }],
        });
        fixture = TestBed.createComponent(SettingsComponent);
        fixture.detectChanges();
        const view = fixture.nativeElement as HTMLElement;
        expect(view.textContent).toContain('Checking connection…');
        expect(view.textContent).not.toContain('This site lost its secure link');

        // PHP has now recovered the credential and successfully checked the backend
        // using it. The original page config still describes the pre-recovery state.
        const checked = TestBed.inject(WooCommerceService).getConnectionStatus();
        finish({ status: 'connected', store: { storeUrl: identity.storeUrl } });
        await checked;
        await fixture.whenStable();
        fixture.detectChanges();

        expect(view.textContent).toContain('Connected to');
        expect(view.textContent).toContain('Disconnect your store');
        expect(view.textContent).not.toContain('This site lost its secure link');
        expect(window.AIAssistantConfig.hasSiteToken).toBe(false);
      } finally {
        window.AIAssistantConfig = originalConfig;
      }
    });

    function createWith(woocommerce: object, webhooks: object = {}) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [SettingsComponent],
        providers: [
          provideHttpClient(),
          provideRouter([]),
          { provide: MerchantApiService, useValue: merchantApi },
          { provide: WooCommerceService, useValue: woocommerce },
          { provide: WebhookService, useValue: { isSiteLinked: () => true, ...webhooks } },
        ],
      });
      return TestBed.createComponent(SettingsComponent);
    }

    it('shows a spinner while the connection is being checked, not "Not connected"', async () => {
      fixture = createWith({
        getIdentity: () => identity,
        getConnectionStatus: () => new Promise(() => undefined),
      });
      fixture.detectChanges();
      const view = fixture.nativeElement as HTMLElement;

      expect(view.textContent).toContain('Checking connection…');
      expect(view.querySelector('[role="status"] .animate-spin')).not.toBeNull();
      expect(view.textContent).not.toContain('Not connected');
    });

    it('shows a spinner on the confirm button while disconnecting', async () => {
      let finish!: (value: { ok: boolean }) => void;
      fixture = createWith(
        {
          getIdentity: () => identity,
          getConnectionStatus: () =>
            Promise.resolve({ status: 'connected', store: { storeUrl: identity.storeUrl } }),
        },
        { disconnectStore: () => new Promise((resolve) => (finish = resolve)) },
      );
      await fixture.whenStable();
      fixture.detectChanges();
      const view = fixture.nativeElement as HTMLElement;
      const click = (label: string) =>
        [...view.querySelectorAll('button')]
          .find((button) => button.textContent!.includes(label))!
          .click();

      click('Disconnect your store');
      fixture.detectChanges();
      click('Yes, disconnect');
      fixture.detectChanges();

      const busy = [...view.querySelectorAll('button')].find((button) =>
        button.textContent!.includes('Disconnecting…'),
      )!;
      expect(busy.querySelector('.animate-spin')).not.toBeNull();
      expect(busy.disabled).toBe(true);
      finish({ ok: false });
    });
  });

  describe('the design format picker', () => {
    /** The four cards, in the order they are offered: floating left/right, then docked left/right. */
    function cards(): HTMLButtonElement[] {
      const compiled = fixture.nativeElement as HTMLElement;
      return [
        ...compiled.querySelectorAll<HTMLButtonElement>('[aria-label="Design format"] button'),
      ];
    }

    it('offers floating and docked formats, left before right in both, with the current design selected', () => {
      const labels = cards().map((card) => card.textContent!.trim());

      expect(labels.length).toBe(4);
      expect(labels[0]).toContain('Floating left');
      expect(labels[1]).toContain('Floating right');
      expect(labels[2]).toContain('Docked left');
      expect(labels[3]).toContain('Docked right');
      // The original bottom-right bubble is still what an unconfigured site shows.
      expect(cards()[1].getAttribute('aria-pressed')).toBe('true');
      expect(cards()[0].getAttribute('aria-pressed')).toBe('false');
    });

    it('groups them as Floating and Docked', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const titles = [...compiled.querySelectorAll('[aria-label="Design format"] h3')].map((h) =>
        h.textContent!.trim(),
      );

      expect(titles).toEqual(['Floating', 'Docked']);
    });

    it('does not name another product in the descriptions', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      const text = compiled.querySelector('[aria-label="Design format"]')!.textContent!;

      expect(text).not.toMatch(/amazon|rufus/i);
    });

    it('shows the saved format when WordPress has one', async () => {
      merchantApi.request.mockImplementation((_method: string, path: string) =>
        Promise.resolve(path === 'widget/layout' ? { layout: 'right' } : { mode: 'everyone' }),
      );
      fixture = TestBed.createComponent(SettingsComponent);
      await fixture.whenStable();

      expect(cards()[3].getAttribute('aria-pressed')).toBe('true');
    });

    it('shows the saved floating-left format when WordPress has one', async () => {
      merchantApi.request.mockImplementation((_method: string, path: string) =>
        Promise.resolve(
          path === 'widget/layout' ? { layout: 'floating-left' } : { mode: 'everyone' },
        ),
      );
      fixture = TestBed.createComponent(SettingsComponent);
      await fixture.whenStable();

      expect(cards()[0].getAttribute('aria-pressed')).toBe('true');
      expect(cards()[1].getAttribute('aria-pressed')).toBe('false');
    });

    it('saves the picked format to WordPress and marks it selected', async () => {
      cards()[2].click();
      await fixture.whenStable();

      expect(merchantApi.request).toHaveBeenCalledWith('POST', 'widget/layout', { layout: 'left' });
      expect(cards()[2].getAttribute('aria-pressed')).toBe('true');
      expect(cards()[1].getAttribute('aria-pressed')).toBe('false');
    });

    it('saves the floating-left format', async () => {
      cards()[0].click();
      await fixture.whenStable();

      expect(merchantApi.request).toHaveBeenCalledWith('POST', 'widget/layout', {
        layout: 'floating-left',
      });
      expect(cards()[0].getAttribute('aria-pressed')).toBe('true');
    });

    it('says so, and keeps the old format, when the save fails', async () => {
      merchantApi.request.mockRejectedValueOnce(
        new Error('The backend could not save this setting.'),
      );

      cards()[3].click();
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('The backend could not save this setting.');
      expect(cards()[1].getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('the live website visibility picker', () => {
    /** The three choices, in the order they are offered. */
    function choices(): HTMLButtonElement[] {
      const compiled = fixture.nativeElement as HTMLElement;
      return [
        ...compiled.querySelectorAll<HTMLButtonElement>('[role="radiogroup"] [role="radio"]'),
      ];
    }

    function checked(): string[] {
      return choices()
        .filter((choice) => choice.getAttribute('aria-checked') === 'true')
        .map((choice) => choice.textContent!.trim());
    }

    it('offers everyone, admins only and hidden, with the saved mode selected', () => {
      const labels = choices().map((choice) => choice.textContent!.trim());

      expect(labels.length).toBe(3);
      expect(labels[0]).toContain('Everyone');
      expect(labels[1]).toContain('Admins only');
      expect(labels[2]).toContain('Hidden');
      expect(checked().length).toBe(1);
      expect(checked()[0]).toContain('Everyone');
    });

    it('gives each choice its own icon', () => {
      const icons = choices().map((choice) => choice.querySelector('svg')?.outerHTML);

      expect(new Set(icons).size).toBe(3);
    });

    it('saves the admin-only mode to WordPress', async () => {
      choices()[1].click();
      await fixture.whenStable();

      expect(merchantApi.request).toHaveBeenCalledWith('POST', 'widget/visibility', {
        mode: 'admins',
      });
      expect(checked()[0]).toContain('Admins only');
    });

    it('says so, and keeps the old mode, when the save fails', async () => {
      merchantApi.request.mockRejectedValueOnce(
        new Error('The backend could not save this setting.'),
      );

      choices()[2].click();
      await fixture.whenStable();

      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.textContent).toContain('The backend could not save this setting.');
      expect(checked()[0]).toContain('Everyone');
    });
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { ConnectComponent } from './connect-component';
import { AIAssistantConfig } from '../../models/woocommerce';
import { WooCommerceService } from '../../services/woocommerce-service/woocommerce-service';

/**
 * The connect form reads window.AIAssistantConfig at construction, so each test sets the
 * config it wants BEFORE creating the component. Deleting it between tests covers the
 * standalone `ng serve` case, where WordPress injects nothing.
 */
async function createWith(
  config: Partial<AIAssistantConfig> | null,
): Promise<ComponentFixture<ConnectComponent>> {
  if (config) {
    window.AIAssistantConfig = { route: '/connect', ...config } as AIAssistantConfig;
  } else {
    delete (window as { AIAssistantConfig?: AIAssistantConfig }).AIAssistantConfig;
  }

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ConnectComponent],
    providers: [provideHttpClient(), provideRouter([])],
  }).compileComponents();

  const fixture = TestBed.createComponent(ConnectComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

/** fixture.nativeElement is `any`, which forbids generic type args on querySelector. */
function dom(fixture: ComponentFixture<ConnectComponent>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function inputValue(fixture: ComponentFixture<ConnectComponent>, id: string): string {
  return dom(fixture).querySelector<HTMLInputElement>(`#${id}`)!.value;
}

describe('ConnectComponent', () => {
  afterEach(() => {
    delete (window as { AIAssistantConfig?: AIAssistantConfig }).AIAssistantConfig;
    localStorage.clear();
  });

  it.each([undefined, 'pending-handshake'])(
    'offers connection choices after an identity conflict (%s)',
    async (handshakeId) => {
      window.AIAssistantConfig = {
        route: '/connect',
        email: 'owner@example.test',
        storeUrl: 'https://destination.test',
      };
      const woo = {
        getIdentity: () => ({ email: 'owner@example.test', storeUrl: 'https://destination.test' }),
        getConnectionStatus: vi.fn().mockRejectedValue(
          new HttpErrorResponse({
            status: 409,
            error: {
              detail: {
                code: 'STORE_IDENTITY_CONFLICT',
                message: 'Approve a migration in the portal.',
                handshakeId,
              },
            },
          }),
        ),
      };
      await TestBed.configureTestingModule({
        imports: [ConnectComponent],
        providers: [provideRouter([]), { provide: WooCommerceService, useValue: woo }],
      }).compileComponents();
      const fixture = TestBed.createComponent(ConnectComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(dom(fixture).textContent).toContain('Connect as separate store');
      const submit = dom(fixture).querySelector<HTMLButtonElement>('button[type="submit"]')!;
      expect(submit.disabled).toBe(false);
      submit.click();
      fixture.detectChanges();
      expect(dom(fixture).querySelector('[data-testid="connect-mode-manual"]')).not.toBeNull();
      expect(woo.getConnectionStatus).toHaveBeenCalledOnce();
    },
  );

  it('checks the connection then stays on Connect with the connected form disabled', async () => {
    window.AIAssistantConfig = {
      route: '/connect',
      email: 'owner@example.test',
      storeUrl: 'https://shop.example.test',
    } as AIAssistantConfig;
    let finish!: (value: object) => void;
    const woo = {
      getIdentity: () => ({ email: 'owner@example.test', storeUrl: 'https://shop.example.test' }),
      getConnectionStatus: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      ),
      connectStore: vi.fn(),
    };
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ConnectComponent],
      providers: [provideRouter([]), { provide: WooCommerceService, useValue: woo }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ConnectComponent);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture.detectChanges();
    const button = dom(fixture).querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Checking connection');
    expect(button.querySelector('.animate-spin')).toBeTruthy();
    dom(fixture).querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(dom(fixture).querySelector('[data-testid="connect-mode-automatic"]')).toBeNull();
    finish({ status: 'connected', store: { storeUrl: 'https://shop.example.test' } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(navigate).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Store is connected');
    expect(dom(fixture).querySelector<HTMLInputElement>('#aa-store-url')!.disabled).toBe(true);
    expect(dom(fixture).querySelector<HTMLInputElement>('#aa-store-name')!.disabled).toBe(true);
    expect(woo.connectStore).not.toHaveBeenCalled();
  });

  it('retries a failed connection check before offering a new connection', async () => {
    window.AIAssistantConfig = {
      route: '/connect',
      email: 'owner@example.test',
      storeUrl: 'https://shop.example.test',
    } as AIAssistantConfig;
    const woo = {
      getIdentity: () => ({ email: 'owner@example.test', storeUrl: 'https://shop.example.test' }),
      getConnectionStatus: vi
        .fn()
        .mockRejectedValueOnce(new Error('Offline'))
        .mockResolvedValueOnce({ status: 'failed' }),
    };
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ConnectComponent],
      providers: [provideRouter([]), { provide: WooCommerceService, useValue: woo }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ConnectComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const button = dom(fixture).querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.textContent).toContain('Retry connection check');
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(woo.getConnectionStatus).toHaveBeenCalledTimes(2);
    expect(dom(fixture).querySelector('[data-testid="connect-mode-automatic"]')).toBeNull();
    expect(button.textContent).toContain('Allow read-only access');
  });

  it('prefills both fields from what WordPress injected', async () => {
    const fixture = await createWith({
      storeUrl: 'https://yellowfalcon.com',
      storeName: 'Yellow Falcon Store',
    });

    expect(inputValue(fixture, 'aa-store-url')).toBe('https://yellowfalcon.com');
    expect(inputValue(fixture, 'aa-store-name')).toBe('Yellow Falcon Store');
  });

  it('leaves the prefilled values editable', async () => {
    const fixture = await createWith({
      storeUrl: 'https://yellowfalcon.com',
      storeName: 'Yellow Falcon Store',
    });

    const url = dom(fixture).querySelector<HTMLInputElement>('#aa-store-url')!;
    url.value = 'https://someotherstore.com';
    url.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    // The typed value wins — auto-detection seeds the field, it does not lock it.
    expect(inputValue(fixture, 'aa-store-url')).toBe('https://someotherstore.com');
  });

  it('warns once the typed store URL is a different host than this site', async () => {
    const fixture = await createWith({ storeUrl: 'https://yellowfalcon.com' });

    const url = dom(fixture).querySelector<HTMLInputElement>('#aa-store-url')!;
    url.value = 'https://someotherstore.com';
    url.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(dom(fixture).textContent).toContain('differs from the site the plugin');
  });

  it('does not warn while the typed URL still points at this site', async () => {
    const fixture = await createWith({ storeUrl: 'https://yellowfalcon.com' });

    // Same host, different formatting — not a mismatch.
    const url = dom(fixture).querySelector<HTMLInputElement>('#aa-store-url')!;
    url.value = 'yellowfalcon.com';
    url.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(dom(fixture).textContent).not.toContain('differs from the site the plugin');
    expect(dom(fixture).textContent).toContain('Detected from your WordPress site');
  });

  it('restores the detected site URL', async () => {
    const fixture = await createWith({ storeUrl: 'https://yellowfalcon.com' });

    const url = dom(fixture).querySelector<HTMLInputElement>('#aa-store-url')!;
    url.value = 'https://someotherstore.com';
    url.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();

    const restore = [...dom(fixture).querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Use this site'),
    );
    restore!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(inputValue(fixture, 'aa-store-url')).toBe('https://yellowfalcon.com');
  });

  it('starts blank with no injected config, as under ng serve', async () => {
    const fixture = await createWith(null);

    expect(inputValue(fixture, 'aa-store-url')).toBe('');
    expect(inputValue(fixture, 'aa-store-name')).toBe('');
    // Nothing was detected, so neither the hint nor the restore action is offered.
    expect(dom(fixture).textContent).not.toContain('Detected from your WordPress site');
    expect(dom(fixture).textContent).not.toContain('Use this site');
  });

  describe('consent and the approve screen', () => {
    const AUTHORIZE = 'https://yellowfalcon.com/wc-auth/v1/authorize?x=1';
    const CONNECTED =
      'https://yellowfalcon.com/wp-admin/admin.php?page=ai-assistant-connected&aaProvisionToken=abc';

    /** Mounts with a stubbed WooCommerce service and a spy standing in for the top window. */
    async function mountWith(connectResponse: object): Promise<{
      fixture: ComponentFixture<ConnectComponent>;
      assign: ReturnType<typeof vi.fn>;
    }> {
      window.AIAssistantConfig = {
        route: '/connect',
        email: 'owner@yellowfalcon.com',
        storeUrl: 'https://yellowfalcon.com',
      } as AIAssistantConfig;
      const woo = {
        getIdentity: vi.fn().mockReturnValue({
          email: 'owner@yellowfalcon.com',
          storeUrl: 'https://yellowfalcon.com',
        }),
        getConnectionStatus: vi.fn().mockResolvedValue({ status: 'not_connected' }),
        connectStore: vi.fn().mockResolvedValue(connectResponse),
        rememberIdentity: vi.fn(),
      };
      const assign = vi.fn();
      vi.spyOn(window, 'top', 'get').mockReturnValue({ location: { assign } } as never);

      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [ConnectComponent],
        providers: [provideRouter([]), { provide: WooCommerceService, useValue: woo }],
      }).compileComponents();
      const fixture = TestBed.createComponent(ConnectComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      return { fixture, assign };
    }

    async function startConnection(fixture: ComponentFixture<ConnectComponent>): Promise<void> {
      dom(fixture).querySelector('form')!.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
      await fixture.whenStable();
      const terms = dom(fixture).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      terms.checked = true;
      terms.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      dom(fixture)
        .querySelector<HTMLButtonElement>('[data-testid="connect-confirm-connect"]')!
        .click();
      fixture.detectChanges();
    }

    async function submit(fixture: ComponentFixture<ConnectComponent>): Promise<void> {
      await startConnection(fixture);
      for (let i = 0; i < 6; i++) {
        await Promise.resolve();
        await fixture.whenStable();
      }
      fixture.detectChanges();
    }

    afterEach(() => vi.restoreAllMocks());

    it('preserves Automatic through the approval redirect so setup can continue', async () => {
      const { fixture, assign } = await mountWith({ authorizationUrl: AUTHORIZE });
      await submit(fixture);
      expect(TestBed.inject(WooCommerceService).connectStore).toHaveBeenCalledWith(
        expect.objectContaining({ approvalMode: 'automatic', connectionMode: 'separate' }),
      );
      expect(assign).toHaveBeenCalledWith(AUTHORIZE);
      expect(localStorage.getItem('aa_automatic_setup:https%3A%2F%2Fyellowfalcon.com')).toBe(
        'accepted',
      );
    });

    it('clears a previous Automatic choice when the merchant connects manually', async () => {
      localStorage.setItem('aa_automatic_setup:https%3A%2F%2Fyellowfalcon.com', 'accepted');
      const { fixture } = await mountWith({ authorizationUrl: AUTHORIZE });
      dom(fixture).querySelector('form')!.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
      dom(fixture).querySelector<HTMLButtonElement>('[data-testid="connect-mode-manual"]')!.click();
      fixture.detectChanges();
      const consent = dom(fixture).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      expect(dom(fixture).querySelector<HTMLButtonElement>('[data-testid="connect-confirm-connect"]')!.disabled).toBe(true);
      consent.checked = true;
      consent.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      dom(fixture)
        .querySelector<HTMLButtonElement>('[data-testid="connect-confirm-connect"]')!
        .click();
      await fixture.whenStable();
      expect(localStorage.getItem('aa_automatic_setup:https%3A%2F%2Fyellowfalcon.com')).toBeNull();
    });

    it('shows connection progress in the dialog and locks its choices until redirecting', async () => {
      let finish!: (value: object) => void;
      const pending = new Promise<object>((resolve) => (finish = resolve));
      const { fixture } = await mountWith(pending);
      await startConnection(fixture);

      const dialog = dom(fixture).querySelector<HTMLElement>('[role="dialog"]')!;
      const confirm = dialog.querySelector<HTMLButtonElement>(
        '[data-testid="connect-confirm-connect"]',
      )!;
      expect(confirm.textContent).toContain('Connecting');
      expect(confirm.querySelector('.animate-spin')).not.toBeNull();
      expect(confirm.disabled).toBe(true);
      expect(dialog.querySelector('[role="status"]')?.textContent).toContain('Setting up');
      expect(
        dialog.querySelector<HTMLButtonElement>('[data-testid="connect-mode-manual"]')!.disabled,
      ).toBe(true);
      expect(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
      expect(
        dialog.querySelector<HTMLButtonElement>('[data-testid="connect-open-terms"]')!.disabled,
      ).toBe(true);
      expect(dom(fixture).querySelector('form .animate-spin')).toBeNull();

      confirm.click();
      const woo = TestBed.inject(WooCommerceService) as unknown as {
        connectStore: ReturnType<typeof vi.fn>;
      };
      expect(woo.connectStore).toHaveBeenCalledOnce();
      finish({ authorizationUrl: AUTHORIZE, autoApproved: true, redirectUrl: CONNECTED });
      await fixture.whenStable();
      fixture.detectChanges();
      expect(confirm.textContent).toContain('Redirecting');
      expect(dialog.querySelector('[role="status"]')?.textContent).toContain('Opening');
      expect(confirm.disabled).toBe(true);
    });

    it('explains the WooCommerce approval step while a manual connection is pending', async () => {
      let finish!: (value: object) => void;
      const { fixture } = await mountWith(new Promise<object>((resolve) => (finish = resolve)));
      dom(fixture).querySelector('form')!.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
      dom(fixture).querySelector<HTMLButtonElement>('[data-testid="connect-mode-manual"]')!.click();
      fixture.detectChanges();
      const consent = dom(fixture).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      expect(dom(fixture).querySelector<HTMLButtonElement>('[data-testid="connect-confirm-connect"]')!.disabled).toBe(true);
      consent.checked = true;
      consent.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      dom(fixture)
        .querySelector<HTMLButtonElement>('[data-testid="connect-confirm-connect"]')!
        .click();
      fixture.detectChanges();

      expect(dom(fixture).querySelector('[role="dialog"] [role="status"]')?.textContent).toContain(
        'WooCommerce',
      );
      finish({ authorizationUrl: AUTHORIZE });
      await fixture.whenStable();
    });

    it('shows a failed connection inside the dialog and lets the merchant retry', async () => {
      const { fixture, assign } = await mountWith({ authorizationUrl: AUTHORIZE });
      const woo = TestBed.inject(WooCommerceService) as unknown as {
        connectStore: ReturnType<typeof vi.fn>;
      };
      woo.connectStore.mockRejectedValueOnce(new Error('Connection timed out. Please try again.'));
      await submit(fixture);

      const dialog = dom(fixture).querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('Connection timed out');
      const confirm = dialog.querySelector<HTMLButtonElement>(
        '[data-testid="connect-confirm-connect"]',
      )!;
      expect(confirm.textContent).toContain('Try again');
      expect(confirm.disabled).toBe(false);
      expect(
        dialog.querySelector<HTMLButtonElement>('[data-testid="connect-mode-manual"]')!.disabled,
      ).toBe(false);
      expect(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
      expect(dom(fixture).querySelector('form [role="alert"]')).toBeNull();

      confirm.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(dialog.querySelector('[role="alert"]')).toBeNull();
      expect(assign).toHaveBeenCalledWith(AUTHORIZE);
    });

    it('requires choosing a connection mode before it starts the connection', async () => {
      const { fixture } = await mountWith({ authorizationUrl: AUTHORIZE });

      expect(dom(fixture).querySelector('[data-testid="connect-consent"]')).toBeNull();
      const button = dom(fixture).querySelector<HTMLButtonElement>('button[type="submit"]')!;
      expect(button.textContent).toContain('Allow read-only access & connect');
      button.click();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(dom(fixture).querySelector('[data-testid="connect-mode-automatic"]')).toBeTruthy();
      expect(dom(fixture).querySelector('[data-testid="connect-mode-manual"]')).toBeTruthy();
      expect(dom(fixture).querySelector('[data-testid="connect-open-terms"]')).toBeTruthy();
    });

    it('sends the manual choice to the plugin so WooCommerce presents its approval page', async () => {
      const { fixture } = await mountWith({ authorizationUrl: AUTHORIZE });
      dom(fixture).querySelector('form')!.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
      await fixture.whenStable();
      dom(fixture).querySelector<HTMLButtonElement>('[data-testid="connect-mode-manual"]')!.click();
      // Manual approval requires the same authorization before data is sent.
      fixture.detectChanges();
      const consent = dom(fixture).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      consent.checked = true;
      consent.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      dom(fixture)
        .querySelector<HTMLButtonElement>('[data-testid="connect-confirm-connect"]')!
        .click();
      await fixture.whenStable();

      const woo = TestBed.inject(WooCommerceService) as unknown as {
        connectStore: ReturnType<typeof vi.fn>;
      };
      expect(woo.connectStore).toHaveBeenCalledWith(
        expect.objectContaining({ approvalMode: 'manual' }),
      );
    });

    it('goes straight to the connected page when the plugin approved the connection itself', async () => {
      const { fixture, assign } = await mountWith({
        authorizationUrl: AUTHORIZE,
        autoApproved: true,
        redirectUrl: CONNECTED,
      });

      await submit(fixture);

      expect(assign).toHaveBeenCalledTimes(1);
      expect(assign).toHaveBeenCalledWith(CONNECTED);
    });

    it('falls back to the WooCommerce approve screen when the plugin could not approve', async () => {
      const { fixture, assign } = await mountWith({
        authorizationUrl: AUTHORIZE,
        autoApproved: false,
        autoApproveReason: 'callback_not_this_backend',
      });

      await submit(fixture);

      expect(assign).toHaveBeenCalledWith(AUTHORIZE);
    });

    it('treats an older plugin that sends no approval fields as before', async () => {
      const { fixture, assign } = await mountWith({ authorizationUrl: AUTHORIZE });

      await submit(fixture);

      expect(assign).toHaveBeenCalledWith(AUTHORIZE);
    });
  });

  describe('already connected', () => {
    // The real check runs over HTTP in ngOnInit (see the other tests' early-return
    // path for stores with no identity); driving the connected state through the
    // signals it sets keeps this test independent of the network, same as
    // dashboard-component's polling tests do for its own internal state.
    async function markConnected(fixture: ComponentFixture<ConnectComponent>): Promise<void> {
      const instance = fixture.componentInstance as unknown as {
        isConnected: { set(value: boolean): void };
      };
      instance.isConnected.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
    }

    it('replaces the submit button with a disabled "connected" state', async () => {
      const fixture = await createWith({ storeUrl: 'https://yellowfalcon.com' });
      await markConnected(fixture);

      const submit = dom(fixture).querySelector<HTMLButtonElement>('button[type="submit"]')!;
      expect(submit.disabled).toBe(true);
      expect(submit.textContent).toContain('Store is connected');
      expect(submit.textContent).not.toContain('Allow read-only access');
      // No consent statement either: there is nothing left to agree to.
      expect(dom(fixture).querySelector('[data-testid="connect-consent"]')).toBeNull();
    });

    it('disables the form fields rather than leaving them editable', async () => {
      const fixture = await createWith({ storeUrl: 'https://yellowfalcon.com' });
      await markConnected(fixture);

      expect(dom(fixture).querySelector<HTMLInputElement>('#aa-store-url')!.disabled).toBe(true);
      expect(dom(fixture).querySelector<HTMLInputElement>('#aa-store-name')!.disabled).toBe(true);
    });

    it('does not show the connected-to line or the disconnect hint', async () => {
      const fixture = await createWith({ storeUrl: 'https://yellowfalcon.com' });
      await markConnected(fixture);

      expect(dom(fixture).querySelector('a[href="/settings"]')).toBeNull();
      expect(dom(fixture).textContent).not.toContain('disconnect it from Settings');
      expect(dom(fixture).textContent).not.toContain('Connected to');
    });

    it('ignores a submit attempt while connected', async () => {
      const fixture = await createWith({ storeUrl: 'https://yellowfalcon.com' });
      await markConnected(fixture);

      const form = dom(fixture).querySelector('form')!;
      form.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
      await fixture.whenStable();

      // Still showing the connected state, not a "Connecting…"/"Redirecting…" one.
      expect(dom(fixture).querySelector('button[type="submit"]')!.textContent).toContain(
        'Store is connected',
      );
    });
  });
});

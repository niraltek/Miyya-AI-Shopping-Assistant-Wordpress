import { TestBed } from '@angular/core/testing';
import { WooCommerceService } from '../../services/woocommerce-service/woocommerce-service';
import { StoreIdentityConflictComponent } from './store-identity-conflict-component';
import { rememberAutomaticSetup } from '../../../setup/utils/automatic-setup';

describe('StoreIdentityConflictComponent', () => {
  const woo = {
    getIdentity: () => ({ email: 'owner@example.test', storeUrl: 'https://destination.test' }),
    connectStore: vi.fn(),
  };

  async function render() {
    woo.connectStore
      .mockReset()
      .mockResolvedValue({ authorizationUrl: 'https://destination.test/authorize' });
    await TestBed.configureTestingModule({
      imports: [StoreIdentityConflictComponent],
      providers: [{ provide: WooCommerceService, useValue: woo }],
    }).compileComponents();
    const fixture = TestBed.createComponent(StoreIdentityConflictComponent);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('keeps approval retry available without starting another connection', async () => {
    const fixture = await render();
    const retry = vi.fn();
    fixture.componentInstance.retry.subscribe(retry);
    fixture.nativeElement.querySelector('[data-testid="identity-retry"]').click();
    expect(retry).toHaveBeenCalledOnce();
    expect(woo.connectStore).not.toHaveBeenCalled();
  });

  it('requires confirmation that a separate store has a new catalog and billing connection', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fixture = await render();
    fixture.nativeElement.querySelector('[data-testid="identity-separate"]').click();
    expect(confirm).toHaveBeenCalledWith(
      expect.stringMatching(/new catalog and billing connection[\s\S]*original store.*history/i),
    );
    expect(woo.connectStore).not.toHaveBeenCalled();
  });

  it('forwards only an explicitly confirmed separate connection and opens WooCommerce approval', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const assign = vi.fn();
    vi.spyOn(window, 'top', 'get').mockReturnValue({ location: { assign } } as never);
    const fixture = await render();
    fixture.nativeElement.querySelector('[data-testid="identity-separate"]').click();
    await fixture.whenStable();
    expect(woo.connectStore).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionMode: 'separate',
        approvalMode: 'manual',
        storeUrl: 'https://destination.test',
      }),
    );
    expect(assign).toHaveBeenCalledWith('https://destination.test/authorize');
  });

  it('shows a failed separate connection and allows another attempt', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = await render();
    woo.connectStore.mockRejectedValue(new Error('Connection unavailable.'));
    fixture.nativeElement.querySelector('[data-testid="identity-separate"]').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Connection unavailable.');
    expect(fixture.nativeElement.querySelector('[data-testid="identity-separate"]').disabled).toBe(
      false,
    );
  });

  it('keeps consented automatic setup when connecting a copied installation as a separate store', async () => {
    rememberAutomaticSetup('https://destination.test', true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const assign = vi.fn();
    vi.spyOn(window, 'top', 'get').mockReturnValue({ location: { assign } } as never);
    const fixture = await render();
    woo.connectStore.mockResolvedValue({
      authorizationUrl: 'https://destination.test/authorize',
      autoApproved: true,
      redirectUrl: 'https://destination.test/wp-admin/admin.php?page=ai-assistant-connected',
    });
    fixture.nativeElement.querySelector('[data-testid="identity-separate"]').click();
    await fixture.whenStable();
    expect(woo.connectStore).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ connectionMode: 'separate', approvalMode: 'automatic' }),
    );
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Automatic setup will continue'));
    expect(assign).toHaveBeenCalledWith(
      'https://destination.test/wp-admin/admin.php?page=ai-assistant-connected',
    );
  });

  it("does not reuse another domain's automatic consent for a separate store", async () => {
    rememberAutomaticSetup('https://original.test', true);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'top', 'get').mockReturnValue({ location: { assign: vi.fn() } } as never);
    const fixture = await render();
    fixture.nativeElement.querySelector('[data-testid="identity-separate"]').click();
    await fixture.whenStable();
    expect(woo.connectStore).toHaveBeenCalledWith(
      expect.objectContaining({ connectionMode: 'separate', approvalMode: 'manual' }),
    );
  });

  it('prepares a fresh migration request with the original Store Code from the portal', async () => {
    rememberAutomaticSetup('https://destination.test', true);
    const assign = vi.fn();
    vi.spyOn(window, 'top', 'get').mockReturnValue({ location: { assign } } as never);
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    const prepare = root.querySelector<HTMLButtonElement>(
      '[data-testid="identity-prepare-migration"]',
    )!;
    expect(prepare).not.toBeNull();
    expect(prepare.disabled).toBe(true);
    const code = root.querySelector<HTMLInputElement>('#migration-source-code')!;
    code.value = ' ORIGINAL-SHOP ';
    code.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    prepare.click();
    await fixture.whenStable();
    expect(woo.connectStore).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        migrationSourceCode: 'ORIGINAL-SHOP',
        connectionMode: 'connect',
        approvalMode: 'manual',
      }),
    );
    expect(assign).toHaveBeenCalledWith('https://destination.test/authorize');
  });

  it('reports pending work to the containing form so it cannot start a competing connection', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fixture = await render();
    const busy = vi.fn();
    fixture.componentInstance.busyChange.subscribe(busy);
    woo.connectStore.mockRejectedValue(new Error('Try again.'));
    fixture.nativeElement.querySelector('[data-testid="identity-separate"]').click();
    await fixture.whenStable();
    expect(busy.mock.calls).toEqual([[true], [false]]);
  });
});

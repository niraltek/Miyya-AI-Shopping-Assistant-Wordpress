import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { ActivatedRoute, NavigationEnd, provideRouter, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { LayoutComponent } from './layout-component';
import { AIAssistantConfig } from '../../../store/models/woocommerce';

/**
 * Only `syncTopAddressBar` is under test here, so the fixture is deliberately never
 * rendered (`detectChanges` is never called): rendering the template would also
 * construct `app-chat-component` and `app-subscription-banner-component`, which need a
 * much larger provider set unrelated to what this file checks.
 */
async function createComponent(): Promise<LayoutComponent> {
  await TestBed.configureTestingModule({
    imports: [LayoutComponent],
    providers: [provideRouter([])],
  }).compileComponents();

  return TestBed.createComponent(LayoutComponent).componentInstance;
}

interface WithSyncTopAddressBar {
  syncTopAddressBar(url: string): void;
}

describe('LayoutComponent', () => {
  beforeEach(() => {
    // A preceding chat test may leave the panel open. This test expects a closed launcher.
    sessionStorage.removeItem('aiAssistantChatOpenState');
  });

  afterEach(() => {
    delete (window as { AIAssistantConfig?: AIAssistantConfig }).AIAssistantConfig;
    sessionStorage.removeItem('aiAssistantChatOpenState');
  });

  it('renders the admin navigation before loading the chat renderer', async () => {
    await TestBed.configureTestingModule({
      imports: [LayoutComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
      deferBlockBehavior: DeferBlockBehavior.Manual,
    }).compileComponents();
    const fixture = TestBed.createComponent(LayoutComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('header')?.textContent).toContain('Miyya');
    expect(element.querySelector('nav a[href="/dashboard"]')?.textContent).toContain('Dashboard');
    expect(element.querySelector('header a[aria-label="Miyya home"]')?.getAttribute('href')).toBe(
      '/connect',
    );
    expect(
      Array.from(element.querySelectorAll('nav a')).map((link) => link.textContent?.trim()),
    ).toEqual(['Connect your store', 'Dashboard', 'Catalog Sync', 'Settings']);
    expect(element.querySelector('app-chat-component')).toBeNull();

    const blocks = await fixture.getDeferBlocks();
    expect(blocks).toHaveLength(1);
    await blocks[0].render(DeferBlockState.Complete);
    fixture.detectChanges();
    expect(element.querySelector('button[aria-label="Open Miyya chat"]')).not.toBeNull();
  });

  it('recognizes the setup route when it is already active', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { url: '/setup?step=connect', events: new Subject() } },
        { provide: ActivatedRoute, useValue: {} },
      ],
    });
    const fixture = TestBed.createComponent(LayoutComponent);

    expect(fixture.componentInstance['onSetupScreen']()).toBe(true);
  });

  it('stops observing route changes after the layout is destroyed', () => {
    const events = new Subject<NavigationEnd>();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { url: '/dashboard', events } },
        { provide: ActivatedRoute, useValue: {} },
      ],
    });
    const fixture = TestBed.createComponent(LayoutComponent);
    fixture.destroy();

    events.next(new NavigationEnd(1, '/setup', '/setup'));

    expect(fixture.componentInstance['onSetupScreen']()).toBe(false);
  });

  describe('syncTopAddressBar', () => {
    // The header tabs only ever move this app's own hash route inside the wp-admin
    // iframe — the top-level admin.php?page=... URL never follows on its own. Left
    // uncorrected, refreshing (or leaving and coming back) re-serves whatever page the
    // address bar still names, which is how the post-connect success screen kept
    // reopening even after the merchant had already navigated to the dashboard.
    it('rewrites the parent address bar to the page matching the new route', async () => {
      window.AIAssistantConfig = {
        route: '/dashboard',
        dashboardUrl: 'http://example.test/wp-admin/admin.php?page=ai-assistant',
      } as AIAssistantConfig;

      const replaceState = vi.fn();
      const fakeTop = {
        location: {
          href: 'http://example.test/wp-admin/admin.php?page=ai-assistant-connected&email=a%40b.com',
        },
        history: { replaceState, state: null },
      };
      vi.spyOn(window, 'top', 'get').mockReturnValue(fakeTop as unknown as Window);

      const component = await createComponent();
      (component as unknown as WithSyncTopAddressBar).syncTopAddressBar('/settings');

      expect(replaceState).toHaveBeenCalledWith(
        null,
        '',
        'http://example.test/wp-admin/admin.php?page=ai-assistant-settings',
      );
    });

    it('names Miyya Setup in the address bar when the setup screen is opened', async () => {
      window.AIAssistantConfig = {
        route: '/dashboard',
        dashboardUrl: 'http://example.test/wp-admin/admin.php?page=ai-assistant',
      } as AIAssistantConfig;

      const replaceState = vi.fn();
      const fakeTop = {
        location: {
          href: 'http://example.test/wp-admin/admin.php?page=ai-assistant-connected&email=a%40b.com',
        },
        history: { replaceState, state: null },
      };
      vi.spyOn(window, 'top', 'get').mockReturnValue(fakeTop as unknown as Window);

      const component = await createComponent();
      (component as unknown as WithSyncTopAddressBar).syncTopAddressBar('/setup');

      expect(replaceState).toHaveBeenCalledWith(
        null,
        '',
        'http://example.test/wp-admin/admin.php?page=ai-assistant-setup',
      );
    });

    it('does nothing once the address bar already names the right page', async () => {
      window.AIAssistantConfig = {
        route: '/dashboard',
        dashboardUrl: 'http://example.test/wp-admin/admin.php?page=ai-assistant',
      } as AIAssistantConfig;

      const replaceState = vi.fn();
      const fakeTop = {
        location: { href: 'http://example.test/wp-admin/admin.php?page=ai-assistant-catalog' },
        history: { replaceState, state: null },
      };
      vi.spyOn(window, 'top', 'get').mockReturnValue(fakeTop as unknown as Window);

      const component = await createComponent();
      (component as unknown as WithSyncTopAddressBar).syncTopAddressBar('/catalog-sync/run-1');

      expect(replaceState).not.toHaveBeenCalled();
    });

    it('leaves the post-connect screens alone — they are not in the route map', async () => {
      window.AIAssistantConfig = {
        route: '/dashboard',
        dashboardUrl: 'http://example.test/wp-admin/admin.php?page=ai-assistant',
      } as AIAssistantConfig;

      const replaceState = vi.fn();
      vi.spyOn(window, 'top', 'get').mockReturnValue({
        location: { href: 'http://example.test/wp-admin/admin.php?page=ai-assistant-connected' },
        history: { replaceState, state: null },
      } as unknown as Window);

      const component = await createComponent();
      (component as unknown as WithSyncTopAddressBar).syncTopAddressBar('/woocommerce/connected');

      expect(replaceState).not.toHaveBeenCalled();
    });

    it('does nothing outside wp-admin — no dashboardUrl to correct against', async () => {
      const replaceState = vi.fn();
      vi.spyOn(window, 'top', 'get').mockReturnValue({
        location: { href: 'http://example.test/wp-admin/admin.php?page=ai-assistant-connected' },
        history: { replaceState, state: null },
      } as unknown as Window);

      const component = await createComponent();
      (component as unknown as WithSyncTopAddressBar).syncTopAddressBar('/settings');

      expect(replaceState).not.toHaveBeenCalled();
    });
  });
});

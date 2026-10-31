import { Component, ElementRef, inject, signal, viewChildren } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import {
  LucideDynamicIcon,
  LucideLayoutGrid,
  LucideMenu,
  LucideMoon,
  LucideRefreshCw,
  LucideSettings,
  LucideStore,
  LucideSun,
} from '@lucide/angular';
import { filter } from 'rxjs';
import { BUILD_INFO } from '../../../../../build-info';
import { ThemeService } from '../../../../shared/services/theme-service/theme-service';
import { SubscriptionBannerComponent } from '../../../billing/components/subscription-banner-component/subscription-banner-component';
import { ChatComponent } from '../../../chat/components/chat-component/chat-component';
import { NavIndicator, NavItem, WordPressPageRoute } from '../../models/layout';

const ROUTE_TO_WP_PAGE: readonly WordPressPageRoute[] = [
  { path: '/dashboard', page: 'ai-assistant-dashboard' },
  { path: '/setup', page: 'ai-assistant-setup' },
  { path: '/connect', page: 'ai-assistant-connect' },
  { path: '/catalog-sync', page: 'ai-assistant-catalog' },
  { path: '/settings', page: 'ai-assistant-settings' },
];

@Component({
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ChatComponent,
    SubscriptionBannerComponent,
    LucideDynamicIcon,
    LucideMenu,
    LucideMoon,
    LucideSun,
  ],
  selector: 'app-layout-component',
  styleUrl: './layout-component.scss',
  templateUrl: './layout-component.html',
})
export class LayoutComponent {
  protected readonly version = BUILD_INFO.version;
  protected readonly commit = BUILD_INFO.commit.slice(0, 7);
  protected readonly buildDetails = `Plugin frontend ${BUILD_INFO.version} | ${BUILD_INFO.commit} | ${BUILD_INFO.builtAt}${BUILD_INFO.dirty ? ' | uncommitted changes' : ''}`;
  protected readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  protected readonly miyyaIconSrc =
    (window.AIAssistantConfig?.assetsBaseUrl ?? '') + 'images/miyya-icon.svg';
  protected readonly mobileNavOpen = signal(false);
  protected readonly onSetupScreen = signal(this.router.url.split(/[?#]/)[0] === '/setup');
  protected readonly navItems: readonly NavItem[] = [
    {
      path: '/connect',
      label: 'Connect your store',
      icon: LucideStore.icon,
    },
    {
      path: '/dashboard',
      label: 'Dashboard',
      icon: LucideLayoutGrid.icon,
    },
    {
      path: '/catalog-sync',
      label: 'Catalog Sync',
      icon: LucideRefreshCw.icon,
    },
    {
      path: '/settings',
      label: 'Settings',
      icon: LucideSettings.icon,
    },
  ];
  private readonly tabLinks = viewChildren<ElementRef<HTMLElement>>('tabLink');
  protected readonly indicator = signal<NavIndicator | null>(null);

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        this.onSetupScreen.set(event.urlAfterRedirects.split(/[?#]/)[0] === '/setup');
        this.syncIndicator();
        this.syncTopAddressBar(event.urlAfterRedirects);
      });
  }

  private syncTopAddressBar(url: string): void {
    const dashboardUrl = window.AIAssistantConfig?.dashboardUrl;
    if (!dashboardUrl) {
      return;
    }
    const match = ROUTE_TO_WP_PAGE.find(
      (entry) => url === entry.path || url.startsWith(entry.path + '/'),
    );
    if (!match) {
      return;
    }
    const top = window.top;
    if (!top || top === window) {
      return;
    }
    try {
      const currentPage = new URL(top.location.href).searchParams.get('page');
      if (currentPage === match.page) {
        return;
      }
      const target = new URL(dashboardUrl);
      target.searchParams.set('page', match.page);
      top.history.replaceState(top.history.state, '', target.toString());
    } catch {}
  }

  protected syncIndicator(): void {
    requestAnimationFrame(() => {
      const active = this.tabLinks().find(
        (link) => link.nativeElement.getAttribute('data-active') === 'true',
      );
      if (!active) {
        this.indicator.set(null);
        return;
      }
      const element = active.nativeElement;
      this.indicator.set({ left: element.offsetLeft, width: element.offsetWidth });
    });
  }

  protected toggleMobileNav(): void {
    this.mobileNavOpen.update((open) => !open);
  }

  protected closeMobileNav(): void {
    this.mobileNavOpen.set(false);
  }
}

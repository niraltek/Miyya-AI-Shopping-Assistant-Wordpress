import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { ChatLauncher } from './features/chat/services/chat-launcher/chat-launcher';

/** Every screen is lazily loaded, so each one ships in its own chunk. */
const loadCatalogSync = () =>
  import('./features/catalog/components/catalog-sync-component/catalog-sync-component').then(
    (m) => m.CatalogSyncComponent,
  );

/**
 * "Chat" is a WordPress admin menu entry, so it has to be a real route — but the chat
 * panel is mounted once by LayoutComponent so its launcher bubble is present on every
 * screen. Rendering ChatComponent here as well would put a second, independent copy
 * on the page with its own conversation.
 *
 * Instead the route opens the existing widget and hands the merchant to the
 * dashboard, so clicking "Chat" opens the chat over a real page rather than landing
 * on an empty content area.
 */
const openChatWidget: CanActivateFn = () => {
  inject(ChatLauncher).open();

  return inject(Router).createUrlTree(['/dashboard']);
};

export const routes: Routes = [
  {
    path: 'widget',
    loadComponent: () =>
      import('./features/chat/components/chat-component/chat-component').then(
        (m) => m.ChatComponent,
      ),
  },
  {
    path: '',
    loadComponent: () =>
      import('./features/layout/components/layout-component/layout-component').then(
        (m) => m.LayoutComponent,
      ),
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/components/dashboard-component/dashboard-component').then(
            (m) => m.DashboardComponent,
          ),
      },
      {
        path: 'setup',
        loadComponent: () =>
          import('./features/setup/components/setup-component/setup-component').then(
            (m) => m.SetupComponent,
          ),
      },
      { path: 'chat', canActivate: [openChatWidget], children: [] },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/store/components/settings-component/settings-component').then(
            (m) => m.SettingsComponent,
          ),
      },
      {
        path: 'connect',
        loadComponent: () =>
          import('./features/store/components/connect-component/connect-component').then(
            (m) => m.ConnectComponent,
          ),
      },
      { path: 'catalog-sync', loadComponent: loadCatalogSync },
      // One run's progress. The same screen as the bare path, which hosts the progress view
      // in place and follows this id. Keep it AFTER 'catalog-sync' so that path isn't
      // swallowed by the :syncRunId parameter.
      { path: 'catalog-sync/:syncRunId', loadComponent: loadCatalogSync },
      {
        path: 'woocommerce/connected',
        loadComponent: () =>
          import('./features/store/components/connected-component/connected-component').then(
            (m) => m.ConnectedComponent,
          ),
      },
      {
        path: 'woocommerce/error',
        loadComponent: () =>
          import('./features/store/components/connect-error-component/connect-error-component').then(
            (m) => m.ConnectErrorComponent,
          ),
      },
      { path: '', redirectTo: 'connect', pathMatch: 'full' },
    ],
  },
];

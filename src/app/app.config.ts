import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withHashLocation } from '@angular/router';
import { ngrokInterceptor } from './core/interceptors/ngrok/ngrok-interceptor';
import { subscriptionInterceptor } from './core/interceptors/subscription/subscription-interceptor';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([ngrokInterceptor, subscriptionInterceptor])),
    provideRouter(routes, withHashLocation()),
  ],
};

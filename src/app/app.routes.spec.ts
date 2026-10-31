import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { Router, provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app.routes';
import { ChatLauncher } from './features/chat/services/chat-launcher/chat-launcher';

describe('routes', () => {
  let router: Router;
  let launcher: ChatLauncher;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideRouter(routes, withHashLocation()), provideHttpClient()],
    }).compileComponents();

    router = TestBed.inject(Router);
    launcher = TestBed.inject(ChatLauncher);
  });

  it('opens the chat widget and lands on the dashboard for /chat', async () => {
    // The WordPress "Chat" menu entry navigates here. The widget is mounted once in
    // the layout, so this route must open THAT instance rather than render a second
    // copy — and it must not leave the merchant on an empty content area.
    expect(launcher.isOpen()).toBe(false);

    await router.navigateByUrl('/chat');

    expect(launcher.isOpen()).toBe(true);
    expect(router.url).toBe('/dashboard');
  });

  it('leaves the chat closed on every other route', async () => {
    await router.navigateByUrl('/settings');

    expect(launcher.isOpen()).toBe(false);
    expect(router.url).toBe('/settings');
  });
});

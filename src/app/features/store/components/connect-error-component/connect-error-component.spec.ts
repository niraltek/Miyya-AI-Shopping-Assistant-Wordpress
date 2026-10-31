import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';

import { ConnectErrorComponent } from './connect-error-component';

describe('ConnectErrorComponent', () => {
  let component: ConnectErrorComponent;
  let fixture: ComponentFixture<ConnectErrorComponent>;
  let router: {
    navigate: ReturnType<typeof vi.fn>;
    navigateByUrl: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    window.AIAssistantConfig = undefined;
    router = {
      navigate: vi.fn().mockResolvedValue(true),
      navigateByUrl: vi.fn().mockResolvedValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [ConnectErrorComponent],
      providers: [{ provide: Router, useValue: router }],
    }).compileComponents();

    fixture = TestBed.createComponent(ConnectErrorComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  afterEach(() => {
    window.AIAssistantConfig = undefined;
    vi.restoreAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('returns to setup through Angular routing when no WordPress URL is configured', () => {
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('button')!.click();

    expect(router.navigate).toHaveBeenCalledWith(['/setup']);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('navigates the top window to the configured WordPress setup screen on retry', () => {
    const setupUrl = 'https://shop.example.com/wp-admin/admin.php?page=ai-assistant-setup';
    window.AIAssistantConfig = { route: '/woocommerce/connect-error', setupUrl };
    const assign = vi.fn();
    vi.spyOn(window, 'top', 'get').mockReturnValue({ location: { assign } } as unknown as Window);

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button')!.click();

    expect(assign).toHaveBeenCalledWith(setupUrl);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('returns to the dashboard when the merchant chooses Back to Dashboard', () => {
    const element = fixture.nativeElement as HTMLElement;
    const button = Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Back to Dashboard',
    )!;
    button.click();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/dashboard');
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

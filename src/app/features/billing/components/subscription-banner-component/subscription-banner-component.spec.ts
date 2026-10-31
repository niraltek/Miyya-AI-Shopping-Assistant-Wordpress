import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { PortalAccessService } from '../../../setup/services/portal-access-service/portal-access-service';
import { SubscriptionNotice } from '../../models/subscription';
import { SubscriptionService } from '../../services/subscription-service/subscription-service';
import { SubscriptionBannerComponent } from './subscription-banner-component';

describe('SubscriptionBannerComponent', () => {
  let component: SubscriptionBannerComponent;
  let fixture: ComponentFixture<SubscriptionBannerComponent>;
  let notice: WritableSignal<SubscriptionNotice | null>;
  let status: WritableSignal<{ manageUrl: string } | null>;
  let load: ReturnType<typeof vi.fn>;
  let billingLoginUrl: ReturnType<typeof vi.fn<() => Promise<string>>>;

  const billingNotice: SubscriptionNotice = {
    tone: 'warning',
    title: 'Out of credits',
    detail: 'Recharge credits to keep answering shoppers.',
    actionLabel: 'Recharge credits',
  };

  beforeEach(async () => {
    notice = signal<SubscriptionNotice | null>(null);
    status = signal<{ manageUrl: string } | null>(null);
    load = vi.fn().mockResolvedValue(null);
    billingLoginUrl = vi.fn<() => Promise<string>>();

    await TestBed.configureTestingModule({
      imports: [SubscriptionBannerComponent],
      providers: [
        { provide: SubscriptionService, useValue: { notice, status, load } },
        { provide: PortalAccessService, useValue: { billingLoginUrl } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SubscriptionBannerComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads the subscription when the banner is created', () => {
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('stays hidden when there is no subscription notice', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('[role="status"]')).toBeNull();
  });

  it('renders the current notice and its billing destination', async () => {
    notice.set(billingNotice);
    status.set({ manageUrl: 'https://portal.example.com/layout/billing' });
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    const banner = element.querySelector<HTMLElement>('[role="status"]')!;
    const link = banner.querySelector<HTMLAnchorElement>('a')!;

    expect(banner.textContent).toContain(billingNotice.title);
    expect(banner.textContent).toContain(billingNotice.detail);
    expect(link.textContent?.trim()).toBe(billingNotice.actionLabel);
    expect(link.href).toBe('https://portal.example.com/layout/billing');
    expect(link.rel).toBe('noopener noreferrer');
  });

  it('opens the one-time billing login in the window reserved by the click', async () => {
    const replace = vi.fn();
    const portalWindow = {
      opener: window,
      closed: false,
      location: { replace },
    };
    vi.spyOn(window, 'open').mockReturnValue(portalWindow as unknown as Window);
    billingLoginUrl.mockResolvedValue('https://portal.example.com/login?token=one-time');
    notice.set(billingNotice);
    await fixture.whenStable();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('a')!.click();
    await fixture.whenStable();

    expect(window.open).toHaveBeenCalledWith('', '_blank');
    expect(portalWindow.opener).toBeNull();
    expect(billingLoginUrl).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('https://portal.example.com/login?token=one-time');
  });

  it('closes the reserved window and displays a portal failure', async () => {
    const close = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({
      opener: window,
      close,
    } as unknown as Window);
    billingLoginUrl.mockRejectedValue(new Error('Billing is temporarily unavailable.'));
    notice.set(billingNotice);
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLAnchorElement>('a')!.click();
    await fixture.whenStable();

    expect(close).toHaveBeenCalledTimes(1);
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'Billing is temporarily unavailable.',
    );
    expect(element.querySelector('a')?.textContent?.trim()).toBe(billingNotice.actionLabel);
  });

  it('preserves a server message returned without an Error object', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    billingLoginUrl.mockRejectedValue('unavailable');
    notice.set(billingNotice);
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLAnchorElement>('a')!.click();
    await fixture.whenStable();

    expect(element.querySelector('[role="alert"]')?.textContent).toContain('unavailable');
  });
});

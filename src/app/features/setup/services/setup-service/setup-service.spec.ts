import { TestBed } from '@angular/core/testing';
import { MerchantApiService } from '../../../../core/services/merchant-api-service/merchant-api-service';
import { SetupService } from './setup-service';

describe('SetupService', () => {
  let service: SetupService;
  const request = vi.fn();

  beforeEach(() => {
    request.mockReset();
    TestBed.configureTestingModule({
      providers: [{ provide: MerchantApiService, useValue: { request } }],
    });
    service = TestBed.inject(SetupService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('reads the saved setup state without changing it', async () => {
    const state = { chatVerified: false, launchedAt: null };
    request.mockResolvedValue(state);

    await expect(service.getState()).resolves.toBe(state);
    expect(request).toHaveBeenCalledExactlyOnceWith('GET', 'setup/state');
  });

  it.each([true, false])('saves the merchant chat verification as %s', async (verified) => {
    const state = { chatVerified: verified };
    request.mockResolvedValue(state);

    await expect(service.setChatVerified(verified)).resolves.toBe(state);
    expect(request).toHaveBeenCalledExactlyOnceWith('POST', 'setup/state', {
      chatVerified: verified,
    });
  });

  it('records the storefront confirmation separately from launching', async () => {
    const state = { launchConfirmed: true };
    request.mockResolvedValue(state);

    await expect(service.confirmLaunch()).resolves.toBe(state);
    expect(request).toHaveBeenCalledExactlyOnceWith('POST', 'setup/state', {
      launchConfirmed: true,
    });
  });

  it('reads launch readiness without launching the storefront', async () => {
    const check = { ready: false, checks: [] };
    request.mockResolvedValue(check);

    await expect(service.getLaunchCheck()).resolves.toBe(check);
    expect(request).toHaveBeenCalledExactlyOnceWith('GET', 'setup/launch-check');
  });

  it('launches only through the dedicated write endpoint', async () => {
    const result = { launched: true };
    request.mockResolvedValue(result);

    await expect(service.launch()).resolves.toBe(result);
    expect(request).toHaveBeenCalledExactlyOnceWith('POST', 'setup/launch');
  });

  it('starts the trial through the authenticated merchant API', async () => {
    const result = { started: true };
    request.mockResolvedValue(result);

    await expect(service.startTrial()).resolves.toBe(result);
    expect(request).toHaveBeenCalledExactlyOnceWith('POST', 'trial/start');
  });

  it('preserves trial refusals for setup to explain', async () => {
    const error = new Error('Trial capacity is full');
    request.mockRejectedValue(error);

    await expect(service.startTrial()).rejects.toBe(error);
  });
});

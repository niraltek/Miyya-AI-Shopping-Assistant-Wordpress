import { Service, inject } from '@angular/core';
import { MerchantApiService } from '../../../../core/services/merchant-api-service/merchant-api-service';
import { LaunchCheckResult, LaunchResult, SetupState, TrialStartResult } from '../../models/setup';

@Service()
export class SetupService {
  private readonly merchantApi = inject(MerchantApiService);

  getState(): Promise<SetupState> {
    return this.merchantApi.request('GET', 'setup/state');
  }

  setChatVerified(verified: boolean): Promise<SetupState> {
    return this.merchantApi.request('POST', 'setup/state', { chatVerified: verified });
  }

  confirmLaunch(): Promise<SetupState> {
    return this.merchantApi.request('POST', 'setup/state', { launchConfirmed: true });
  }

  getLaunchCheck(): Promise<LaunchCheckResult> {
    return this.merchantApi.request('GET', 'setup/launch-check');
  }

  launch(): Promise<LaunchResult> {
    return this.merchantApi.request('POST', 'setup/launch');
  }

  startTrial(): Promise<TrialStartResult> {
    return this.merchantApi.request('POST', 'trial/start');
  }
}

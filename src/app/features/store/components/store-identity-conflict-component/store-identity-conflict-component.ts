import { Component, inject, input, output, signal } from '@angular/core';
import { apiErrorMessage } from '../../../../shared/utils/api-response';
import { connectDestination, navigateTop } from '../../../../core/utils/navigation';
import { WooCommerceService } from '../../services/woocommerce-service/woocommerce-service';
import { readAutomaticSetup } from '../../../setup/utils/automatic-setup';

@Component({
  selector: 'app-store-identity-conflict',
  templateUrl: './store-identity-conflict-component.html',
})
export class StoreIdentityConflictComponent {
  private readonly woocommerce = inject(WooCommerceService);
  readonly needsConnection = input(false);
  readonly retry = output<void>();
  readonly startMigration = output<void>();
  readonly busyChange = output<boolean>();
  readonly sourceCode = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  async connectSeparate(): Promise<void> {
    if (this.busy()) return;
    const identity = this.woocommerce.getIdentity();
    const nextStep = readAutomaticSetup(identity.storeUrl)
      ? 'Automatic setup will continue using the read-only access you already accepted.'
      : 'You will approve read-only access on the WooCommerce page.';
    if (
      !window.confirm(
        `Connect ${identity.storeUrl} as a separate store? This creates a new catalog and billing connection. The original store keeps its history. ${nextStep}`,
      )
    )
      return;
    await this.startConnection('separate');
  }

  async prepareMigration(): Promise<void> {
    const sourceCode = this.sourceCode().trim();
    if (this.busy() || !sourceCode || sourceCode.length > 100) return;
    await this.startConnection('connect', sourceCode);
  }

  private async startConnection(mode: 'connect' | 'separate', sourceCode?: string): Promise<void> {
    this.busy.set(true);
    this.busyChange.emit(true);
    this.error.set(null);
    try {
      const identity = this.woocommerce.getIdentity();
      const response = await this.woocommerce.connectStore({
        ...identity,
        storeName: window.AIAssistantConfig?.storeName,
        approvalMode:
          mode === 'separate' && readAutomaticSetup(identity.storeUrl) ? 'automatic' : 'manual',
        connectionMode: mode,
        ...(sourceCode ? { migrationSourceCode: sourceCode } : {}),
      });
      navigateTop(connectDestination(response));
    } catch (error) {
      this.error.set(apiErrorMessage(error));
      this.busy.set(false);
      this.busyChange.emit(false);
    }
  }
}

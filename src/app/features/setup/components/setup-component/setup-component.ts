import { apiErrorMessage } from '../../../../shared/utils/api-response';
import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import {
  LucideArrowRight,
  LucideCheck,
  LucideCreditCard,
  LucideExternalLink,
  LucideLoaderCircle,
  LucideMessageSquare,
  LucidePackage,
  LucideRefreshCw,
  LucideRocket,
  LucideSettings,
  LucideShieldCheck,
  LucideStore,
  LucideTriangleAlert,
  LucideX,
  LucideZap,
} from '@lucide/angular';
import { connectDestination, navigateTop } from '../../../../core/utils/navigation';
import { formatStoreHost } from '../../../../shared/utils/validation';
import { SubscriptionService } from '../../../billing/services/subscription-service/subscription-service';
import {
  CatalogSyncAlreadyRunningBody,
  CatalogSyncStatusResponse,
} from '../../../catalog/models/catalog';
import { MerchantIndexStatusResponse } from '../../../catalog/models/embedding';
import { CatalogService } from '../../../catalog/services/catalog-service/catalog-service';
import { EmbeddingService } from '../../../catalog/services/embedding-service/embedding-service';
import { ChatLauncher } from '../../../chat/services/chat-launcher/chat-launcher';
import { MerchantStoreConnection } from '../../../store/models/woocommerce';
import { WooCommerceService } from '../../../store/services/woocommerce-service/woocommerce-service';
import {
  CatalogReadiness,
  BillingRefusalResponse,
  ConnectPhase,
  LaunchCheckItem,
  LaunchCheckResult,
  LaunchResult,
  SetupState,
  SetupStepId,
  SetupStepView,
  TrialPhase,
} from '../../models/setup';
import { PortalAccessService } from '../../services/portal-access-service/portal-access-service';
import { SetupService } from '../../services/setup-service/setup-service';
import { readAutomaticSetup, rememberAutomaticSetup } from '../../utils/automatic-setup';
import {
  deriveCatalogReadiness,
  deriveSetupCatalogProgress,
  deriveSteps,
  deriveTrialPhase,
} from '../../utils/setup-progress';
import { TermsComponent } from '../terms-component/terms-component';

const CHECK_FIX_STEP: Readonly<Record<string, SetupStepId>> = {
  connection: 'connect',
  catalog: 'catalog',
  plan: 'trial',
  chat: 'preview',
};

const MISSING_IDENTITY =
  'This page could not read your WordPress account details. Please reload the admin page.';

const PREVIEW_PROMPTS: readonly string[] = [
  'What products do you have?',
  'Show me your best sellers',
  'Compare two products for me',
];

@Component({
  imports: [
    RouterLink,
    TermsComponent,
    LucideArrowRight,
    LucideCheck,
    LucideCreditCard,
    LucideExternalLink,
    LucideLoaderCircle,
    LucideMessageSquare,
    LucidePackage,
    LucideRefreshCw,
    LucideRocket,
    LucideSettings,
    LucideShieldCheck,
    LucideStore,
    LucideTriangleAlert,
    LucideX,
    LucideZap,
  ],
  selector: 'app-setup-component',
  templateUrl: './setup-component.html',
  host: {
    '(document:visibilitychange)': 'onVisibilityChange()',
  },
  styleUrl: './setup-component.scss',
})
export class SetupComponent implements OnInit, OnDestroy {
  private readonly woocommerce = inject(WooCommerceService);
  private readonly catalog = inject(CatalogService);
  private readonly embeddings = inject(EmbeddingService);
  private readonly setupService = inject(SetupService);
  private readonly chatLauncher = inject(ChatLauncher);
  private readonly portalAccess = inject(PortalAccessService);
  protected readonly subscription = inject(SubscriptionService);
  static readonly REFRESH_MS = 3000;
  protected readonly loaded = signal(false);
  protected readonly isOpeningBillingPortal = signal(false);
  protected readonly billingPortalError = signal<string | null>(null);
  protected readonly phase = signal<ConnectPhase>('checking');
  protected readonly store = signal<MerchantStoreConnection | null>(null);
  protected readonly indexStatus = signal<MerchantIndexStatusResponse | null>(null);
  private readonly run = signal<CatalogSyncStatusResponse | null>(null);
  protected readonly setupState = signal<SetupState | null>(null);
  protected readonly catalogAccepted = signal(false);
  protected readonly launchAcknowledged = signal(false);
  protected readonly override = signal<SetupStepId | null>(null);
  protected readonly isConnecting = signal(false);
  protected readonly connectError = signal<string | null>(null);
  protected readonly showConnectionChoice = signal(false);
  protected readonly connectionMode = signal<'automatic' | 'manual'>('automatic');
  protected readonly termsAccepted = signal(false);
  protected readonly showTerms = signal(false);
  protected readonly automaticSetup = signal(false);
  protected readonly automaticError = signal<string | null>(null);
  protected readonly isStartingSync = signal(false);
  protected readonly isRetryingFailed = signal(false);
  protected readonly isReindexing = signal(false);
  protected readonly catalogError = signal<string | null>(null);
  protected readonly isActivatingTrial = signal(false);
  protected readonly trialError = signal<string | null>(null);
  protected readonly trialNote = signal<string | null>(null);
  private readonly trialApprovalRequired = signal(false);
  protected readonly previewOpened = signal(false);
  protected readonly isSavingChat = signal(false);
  protected readonly showTroubleshooting = signal(false);
  protected readonly previewError = signal<string | null>(null);
  protected readonly launchCheck = signal<LaunchCheckResult | null>(null);
  protected readonly isCheckingLaunch = signal(false);
  protected readonly launchCheckError = signal<string | null>(null);
  protected readonly launchResult = signal<LaunchResult | null>(null);
  protected readonly isLaunching = signal(false);
  protected readonly launchError = signal<string | null>(null);
  protected readonly isConfirmingLaunch = signal(false);
  protected readonly previewPrompts = PREVIEW_PROMPTS;
  protected readonly chatOpen = this.chatLauncher.isOpen;
  private pollTimer?: ReturnType<typeof setInterval>;
  private refreshing = false;
  private autoSyncTried = false;
  private autoAdvanceInFlight = false;
  private destroyed = false;
  private stateRevision = 0;
  protected readonly automaticStep = signal<SetupStepId | null>(null);
  protected readonly storeHost = computed(() => {
    const url = this.store()?.storeUrl ?? window.AIAssistantConfig?.storeUrl ?? '';
    return url ? formatStoreHost(url) : '';
  });
  protected readonly connectionIllustrationSrc =
    (window.AIAssistantConfig?.assetsBaseUrl ?? '') + 'images/connecting-store.png';
  protected readonly catalogReadiness = computed<CatalogReadiness>(() =>
    deriveCatalogReadiness({ store: this.store(), status: this.indexStatus(), run: this.run() }),
  );
  protected readonly displayedCatalogProgress = signal<number | null>(null);
  private progressRunId: string | null = null;
  protected readonly trialPhase = computed<TrialPhase>(() => {
    const status = this.subscription.status();
    const phase = deriveTrialPhase(status, this.subscription.loaded());
    // Older backends report membership only in a structured trial refusal.
    return this.trialApprovalRequired() &&
      status?.storeLinkStatus !== 'linked' &&
      (phase === 'available' || phase === 'unknown')
      ? 'approval_required'
      : phase;
  });
  private readonly catalogDone = computed(() => {
    const readiness = this.catalogReadiness();
    if (readiness.state === 'ready') return true;
    if (!this.catalogAccepted()) return false;
    return (
      (readiness.state === 'partial' && readiness.usable > 0) ||
      (readiness.state === 'failed' &&
        readiness.stage === 'index' &&
        this.store()?.catalogStatus === true)
    );
  });
  protected readonly widgetOnlySetup = signal(false);
  private readonly planDone = computed(() => {
    const phase = this.trialPhase();
    return phase === 'active' || phase === 'not_required';
  });
  protected readonly isLive = computed(() => {
    const state = this.setupState();
    if (!state) return false;
    return state.legacy || (!!state.launchedAt && state.visibility === 'everyone');
  });
  protected readonly steps = computed<SetupStepView[]>(() => {
    const connected = this.phase() === 'connected';
    const state = this.setupState();
    const legacy = connected && !!state?.legacy;
    return deriveSteps({
      connected,
      catalogDone: legacy || this.isLive() || this.widgetOnlySetup() || this.catalogDone(),
      planDone: legacy || this.isLive() || this.widgetOnlySetup() || this.planDone(),
      chatVerified: legacy || this.isLive() || this.widgetOnlySetup() || !!state?.chatVerifiedAt,
      launchChecked: legacy || this.launchAcknowledged() || this.isLive(),
      live: legacy || this.isLive(),
    }).map((step) => {
      if ((this.widgetOnlySetup() || this.isLive()) && step.id === 'trial' && !this.planDone()) {
        return { ...step, title: 'AI service (optional)', summary: 'Activate hosted AI service from Billing when ready' };
      }
      if ((this.widgetOnlySetup() || this.isLive()) && step.id === 'preview' && !state?.chatVerifiedAt) {
        return { ...step, title: 'AI preview skipped', summary: 'Test AI answers after activating the hosted service' };
      }
      return step;
    });
  });
  protected readonly currentStepId = computed<SetupStepId>(
    () => this.steps().find((step) => step.current)?.id ?? 'live',
  );
  protected readonly viewStepId = computed<SetupStepId>(
    () => this.automaticStep() ?? this.override() ?? this.currentStepId(),
  );
  protected readonly doneCount = computed(() => this.steps().filter((step) => step.done).length);
  protected readonly allDone = computed(() => this.doneCount() === this.steps().length);
  protected readonly viewStep = computed(
    () => this.steps().find((step) => step.id === this.viewStepId()) ?? this.steps()[0],
  );
  protected readonly connectIsRetry = computed(() => !!this.setupState()?.startedAt);
  protected readonly failedErrors = computed(() => {
    const readiness = this.catalogReadiness();
    return readiness.state === 'partial' ? readiness.errors : [];
  });
  protected readonly shownErrors = computed(() => this.failedErrors().slice(0, 8));
  protected readonly counts = computed(() => this.indexStatus()?.catalogCounts ?? null);
  protected readonly usageSummary = computed(() => {
    const status = this.subscription.status();
    if (!status) return null;
    return {
      credits: status.creditsRemaining,
      trialDays: status.reason === 'trial_active' ? status.remainingTrialDays : null,
      enforced: status.enforced,
      manageUrl: status.manageUrl,
    };
  });
  protected readonly passedChecks = computed(
    () => this.launchCheck()?.checks.filter((check) => check.passed).length ?? 0,
  );

  constructor() {
    effect(() => {
      const readiness = this.catalogReadiness();
      if (readiness.state !== 'syncing') return;
      const runId = this.run()?.syncRunId ?? this.indexStatus()?.catalogSync?.syncRunId ?? null;
      const target = deriveSetupCatalogProgress(readiness).overallPercent;
      untracked(() => {
        if (runId && runId !== this.progressRunId) {
          this.progressRunId = runId;
          this.displayedCatalogProgress.set(target);
          return;
        }
        this.displayedCatalogProgress.update((shown) => Math.max(shown ?? 0, target));
      });
    });
    effect(() => {
      const onLaunch = this.viewStepId() === 'launch';
      untracked(() => {
        if (onLaunch) {
          if (!this.automaticSetup() && !this.launchCheck() && !this.isCheckingLaunch()) {
            void this.runLaunchCheck();
          }
        } else if (this.launchCheck() && !this.launchCheck()!.passed) {
          this.launchCheck.set(null);
        }
      });
    });
  }

  ngOnInit(): void {
    this.restoreAutomaticSetupChoice();
    void this.refresh(true);
    this.pollTimer = setInterval(() => {
      if (document.visibilityState !== 'hidden' && this.needsPolling()) void this.refresh();
    }, SetupComponent.REFRESH_MS);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    clearInterval(this.pollTimer);
  }

  protected onVisibilityChange(): void {
    if (document.visibilityState !== 'hidden' && this.needsPolling()) void this.refresh();
  }

  private needsPolling(): boolean {
    if (!this.loaded()) return false;
    if (this.phase() === 'pending') return true;
    if (this.phase() !== 'connected') return false;
    if (this.catalogReadiness().state === 'syncing') return true;
    if (this.trialPhase() === 'approval_rejected') return false;
    if (this.automaticSetup() && this.catalogDone() && !this.isLive() && !this.automaticError())
      return true;
    return this.trialPhase() === 'waitlisted' || (this.catalogDone() && !this.planDone());
  }

  private async refresh(first = false): Promise<void> {
    if (this.refreshing || this.autoAdvanceInFlight || this.destroyed) return;
    this.refreshing = true;
    const stateRevision = this.stateRevision;
    try {
      const [connection, state] = await Promise.all([
        this.woocommerce.getConnectionStatus().catch(() => null),
        this.setupService.getState().catch(() => null),
      ]);
      if (this.destroyed) return;
      if (
        state &&
        stateRevision === this.stateRevision &&
        !this.isSavingChat() &&
        !this.isLaunching() &&
        !this.isConfirmingLaunch()
      ) {
        this.setupState.set(state);
      }
      if (connection) {
        this.store.set(connection.store ?? null);
        this.phase.set(
          connection.status === 'connected'
            ? 'connected'
            : connection.status === 'pending'
              ? 'pending'
              : 'not_connected',
        );
      } else if (first) {
        this.phase.set('not_connected');
      }
      if (this.phase() === 'connected') {
        await this.refreshConnectedFacts();
      }
    } finally {
      this.refreshing = false;
      this.loaded.set(true);
    }
    if (this.phase() === 'connected' && !this.autoSyncTried) {
      this.autoSyncTried = true;
      if (this.catalogReadiness().state === 'idle') await this.startSync();
    }
    void this.advanceAutomaticSetup();
  }

  private async refreshConnectedFacts(): Promise<void> {
    const status = await this.embeddings.getStatus().catch(() => null);
    if (status) this.indexStatus.set(status);
    const run = this.run();
    if (run && (run.status === 'queued' || run.status === 'running')) {
      const fresh = await this.catalog.getStatus(run.syncRunId).catch(() => null);
      if (fresh) this.run.set(fresh);
    } else if (!run && status?.catalogSync) {
      const retained = status.catalogSync;
      if (retained.status === 'queued' || retained.status === 'running') this.run.set(retained);
    }
    if (this.catalogDone() && !this.planDone()) {
      await this.subscription.refresh();
    } else if (!this.subscription.loaded()) {
      await this.subscription.load();
    }
  }

  protected openStep(step: SetupStepView): void {
    if (!step.done && !step.current) return;
    this.override.set(step.current ? null : step.id);
  }

  protected goToCurrent(): void {
    this.override.set(null);
  }

  protected fixStep(check: LaunchCheckItem): void {
    const step = CHECK_FIX_STEP[check.id];
    if (step) this.override.set(step);
  }

  protected hasFixStep(check: LaunchCheckItem): boolean {
    return check.id in CHECK_FIX_STEP;
  }

  protected stepLabel(id: SetupStepId): string {
    return this.steps().find((step) => step.id === id)?.title ?? id;
  }

  protected openConnectionChoice(): void {
    if (this.isConnecting()) return;
    this.connectError.set(null);
    this.connectionMode.set('automatic');
    this.termsAccepted.set(false);
    this.showConnectionChoice.set(true);
  }

  protected openTerms(): void {
    if (this.isConnecting()) return;
    this.showTerms.set(true);
  }

  protected closeTerms(): void {
    this.showTerms.set(false);
  }

  protected closeConnectionChoice(): void {
    if (!this.isConnecting()) this.showConnectionChoice.set(false);
  }

  protected selectConnectionMode(mode: 'automatic' | 'manual'): void {
    if (this.isConnecting()) return;
    this.connectionMode.set(mode);
  }

  protected setTermsAccepted(accepted: boolean): void {
    if (this.isConnecting()) return;
    this.termsAccepted.set(accepted);
  }

  protected canConnectFromChoice(): boolean {
    return this.termsAccepted();
  }

  protected async connect(): Promise<void> {
    if (!this.canConnectFromChoice() || this.isConnecting()) return;
    const { email, storeUrl } = this.woocommerce.getIdentity();
    if (!email || !storeUrl) {
      this.connectError.set(MISSING_IDENTITY);
      return;
    }
    this.isConnecting.set(true);
    this.connectError.set(null);
    try {
      const response = await this.woocommerce.connectStore({
        email,
        storeUrl,
        storeName: window.AIAssistantConfig?.storeName?.trim() || formatStoreHost(storeUrl),
        returnUrl: window.AIAssistantConfig?.connectedUrl,
        approvalMode: this.connectionMode(),
        connectionMode: this.connectionMode() === 'automatic' ? 'separate' : 'connect',
      });
      this.woocommerce.rememberIdentity(email, storeUrl);
      this.rememberAutomaticSetupChoice(this.connectionMode() === 'automatic');
      navigateTop(connectDestination(response));
    } catch (error) {
      this.isConnecting.set(false);
      this.connectError.set(apiErrorMessage(error));
    }
  }

  protected async startSync(): Promise<void> {
    if (this.isStartingSync()) return;
    this.isStartingSync.set(true);
    this.catalogError.set(null);
    this.catalogAccepted.set(false);
    try {
      const started = await this.catalog.start();
      this.run.set(await this.catalog.getStatus(started.syncRunId));
      await this.refreshConnectedFacts();
    } catch (error) {
      const running =
        error instanceof HttpErrorResponse && error.status === 409
          ? (error.error as CatalogSyncAlreadyRunningBody | undefined)
          : undefined;
      if (running?.syncRunId) {
        this.run.set(await this.catalog.getStatus(running.syncRunId).catch(() => null));
      } else {
        this.catalogError.set(apiErrorMessage(error));
      }
    } finally {
      this.isStartingSync.set(false);
    }
    void this.advanceAutomaticSetup();
  }

  protected async retryFailedProducts(): Promise<void> {
    if (this.isRetryingFailed()) return;
    this.isRetryingFailed.set(true);
    this.catalogError.set(null);
    try {
      for (const error of this.failedErrors()) {
        try {
          this.run.set(await this.catalog.retryError(error.id));
        } catch (failure) {
          this.catalogError.set(apiErrorMessage(failure));
        }
      }
      await this.refreshConnectedFacts();
    } finally {
      this.isRetryingFailed.set(false);
    }
    void this.advanceAutomaticSetup();
  }

  protected async checkCatalogAgain(): Promise<void> {
    this.catalogError.set(null);
    await this.refreshConnectedFacts();
    void this.advanceAutomaticSetup();
  }

  protected acceptCatalog(): void {
    this.catalogAccepted.set(true);
    void this.advanceAutomaticSetup();
  }

  protected async reindex(): Promise<void> {
    if (this.isReindexing()) return;
    this.isReindexing.set(true);
    this.catalogError.set(null);
    try {
      await this.embeddings.reindex();
      await this.refreshConnectedFacts();
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) {
        await this.refreshConnectedFacts();
      } else {
        this.catalogError.set(apiErrorMessage(error));
      }
    } finally {
      this.isReindexing.set(false);
    }
    void this.advanceAutomaticSetup();
  }

  protected async activateTrial(): Promise<void> {
    if (
      this.isActivatingTrial() ||
      this.trialPhase() === 'approval_required' ||
      this.trialPhase() === 'approval_rejected'
    )
      return;
    this.isActivatingTrial.set(true);
    this.trialError.set(null);
    this.trialNote.set(null);
    this.automaticError.set(null);
    try {
      const trial = await this.setupService.startTrial();
      if (trial.status === 'waitlisted') {
        this.trialNote.set(trial.message ?? null);
      }
      await this.subscription.refresh();
    } catch (error) {
      const refusal =
        error instanceof HttpErrorResponse ? (error.error as BillingRefusalResponse) : null;
      if (
        typeof refusal?.detail === 'object' &&
        refusal.detail?.details?.reason === 'awaiting_owner_approval'
      ) {
        this.trialApprovalRequired.set(true);
        this.trialError.set(null);
      } else {
        this.trialError.set(apiErrorMessage(error));
      }
      await this.subscription.refresh();
    } finally {
      this.isActivatingTrial.set(false);
    }
    if (this.planDone()) void this.advanceAutomaticSetup();
  }

  protected async checkPlanAgain(): Promise<void> {
    this.trialError.set(null);
    this.trialApprovalRequired.set(false);
    await this.subscription.refresh();
    if (this.planDone() || this.trialPhase() === 'available') {
      this.automaticError.set(null);
      void this.advanceAutomaticSetup();
    }
  }

  protected openPreview(): void {
    this.previewOpened.set(true);
    this.showTroubleshooting.set(false);
    this.chatLauncher.open();
  }

  protected async confirmChat(works: boolean): Promise<void> {
    if (this.isSavingChat()) return;
    this.isSavingChat.set(true);
    this.previewError.set(null);
    this.automaticError.set(null);
    if (!works) this.clearAutomaticSetupChoice();
    try {
      this.setupState.set(await this.setupService.setChatVerified(works));
      this.stateRevision++;
      this.showTroubleshooting.set(!works);
      if (works) this.chatLauncher.close();
    } catch (error) {
      this.previewError.set(apiErrorMessage(error));
    } finally {
      this.isSavingChat.set(false);
    }
    if (works && this.setupState()?.chatVerifiedAt) void this.advanceAutomaticSetup();
  }

  protected testAgain(): void {
    this.openPreview();
  }

  protected async runLaunchCheck(): Promise<void> {
    if (this.isCheckingLaunch()) return;
    this.isCheckingLaunch.set(true);
    this.launchCheckError.set(null);
    this.launchCheck.set(null);
    this.automaticError.set(null);
    try {
      this.launchCheck.set(await this.setupService.getLaunchCheck());
    } catch (error) {
      this.launchCheckError.set(apiErrorMessage(error));
    } finally {
      this.isCheckingLaunch.set(false);
    }
    if (this.launchCheck()?.passed) void this.advanceAutomaticSetup();
  }

  protected async configureWidgetOnly(): Promise<void> {
    this.clearAutomaticSetupChoice();
    this.widgetOnlySetup.set(true);
    this.override.set('launch');
    await this.runLaunchCheck();
  }

  protected continueToLaunch(): void {
    this.launchAcknowledged.set(true);
    this.override.set(null);
  }

  protected async enableOnStorefront(): Promise<void> {
    if (this.isLaunching()) return;
    this.isLaunching.set(true);
    this.launchError.set(null);
    try {
      const result = await this.setupService.launch();
      this.launchResult.set(result);
      if (result.state) {
        this.setupState.set(result.state);
        this.stateRevision++;
      }
      if (this.isLive()) this.clearAutomaticSetupChoice();
    } catch (error) {
      const body =
        error instanceof HttpErrorResponse && error.status === 409
          ? (error.error as LaunchResult | undefined)
          : undefined;
      if (body?.checks) {
        this.launchResult.set(body);
        this.launchCheck.set({ passed: false, checks: body.checks });
        this.launchAcknowledged.set(false);
        this.override.set('launch');
      } else {
        this.launchError.set(apiErrorMessage(error));
      }
    } finally {
      this.isLaunching.set(false);
    }
  }

  protected async confirmSeenOnStorefront(): Promise<void> {
    if (this.isConfirmingLaunch()) return;
    this.isConfirmingLaunch.set(true);
    try {
      this.setupState.set(await this.setupService.confirmLaunch());
      this.stateRevision++;
      this.launchResult.set(null);
      if (this.isLive()) this.clearAutomaticSetupChoice();
    } catch (error) {
      this.launchError.set(apiErrorMessage(error));
    } finally {
      this.isConfirmingLaunch.set(false);
    }
  }

  protected openStorefront(): void {
    const url = this.launchResult()?.storefrontUrl ?? this.setupState()?.storefrontUrl;
    if (url) window.open(url, '_blank', 'noopener');
  }

  protected get storefrontUrl(): string {
    return this.launchResult()?.storefrontUrl ?? this.setupState()?.storefrontUrl ?? '/';
  }

  protected openDashboard(): void {
    const url = window.AIAssistantConfig?.dashboardUrl;
    if (url) navigateTop(url);
  }

  protected async openBilling(event: MouseEvent): Promise<void> {
    return this.openPortal(event, 'billing');
  }

  protected async openStoreApprovals(event: MouseEvent): Promise<void> {
    return this.openPortal(event, 'stores');
  }

  private async openPortal(event: MouseEvent, destination: 'billing' | 'stores'): Promise<void> {
    event.preventDefault();
    if (this.isOpeningBillingPortal()) return;
    const portalWindow = window.open('', '_blank');
    if (portalWindow) portalWindow.opener = null;
    this.isOpeningBillingPortal.set(true);
    this.billingPortalError.set(null);
    try {
      const url =
        destination === 'stores'
          ? await this.portalAccess.storesLoginUrl()
          : await this.portalAccess.billingLoginUrl();
      if (portalWindow && !portalWindow.closed) {
        portalWindow.location.replace(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      portalWindow?.close();
      this.billingPortalError.set(apiErrorMessage(error));
    } finally {
      this.isOpeningBillingPortal.set(false);
    }
  }

  private async advanceAutomaticSetup(): Promise<void> {
    if (
      !this.automaticSetup() ||
      this.autoAdvanceInFlight ||
      this.refreshing ||
      this.destroyed ||
      this.automaticError() ||
      this.isSavingChat() ||
      this.isActivatingTrial() ||
      this.isCheckingLaunch() ||
      this.isLaunching() ||
      this.phase() !== 'connected' ||
      this.isLive()
    ) {
      if (this.automaticSetup() && this.isLive()) this.clearAutomaticSetupChoice();
      return;
    }
    if (!this.catalogDone()) return;
    const trial = this.trialPhase();
    if (
      trial === 'waitlisted' ||
      trial === 'approval_required' ||
      trial === 'approval_rejected' ||
      trial === 'expired' ||
      trial === 'frozen' ||
      trial === 'unknown' ||
      trial === 'loading'
    ) {
      return;
    }
    this.autoAdvanceInFlight = true;
    try {
      if (!this.planDone()) {
        this.automaticStep.set('trial');
        await this.activateTrial();
        if (this.destroyed) return;
        if (!this.planDone()) {
          if (this.trialError()) this.automaticError.set(this.trialError());
          return;
        }
      }
      if (!this.setupState()?.chatVerifiedAt) {
        this.automaticStep.set('preview');
        await this.confirmChat(true);
        if (this.destroyed) return;
        if (!this.setupState()?.chatVerifiedAt) {
          this.automaticError.set(
            this.previewError() ?? 'Chat setup could not be saved. Please retry.',
          );
          return;
        }
      }
      this.automaticStep.set('launch');
      await this.runLaunchCheck();
      if (this.destroyed) return;
      if (!this.launchCheck()?.passed) {
        this.automaticError.set(
          this.launchCheckError() ??
            'Some launch checks need attention. Review them below, then retry.',
        );
        return;
      }
      this.launchAcknowledged.set(true);
      this.automaticStep.set('live');
      await this.enableOnStorefront();
      if (this.destroyed) return;
      if (!this.isLive()) {
        this.automaticError.set(
          this.launchError() ??
            this.launchResult()?.message ??
            'Storefront verification is not complete. Please retry.',
        );
      }
      if (this.isLive()) this.clearAutomaticSetupChoice();
    } finally {
      this.automaticStep.set(null);
      this.autoAdvanceInFlight = false;
    }
  }

  protected async retryAutomaticSetup(): Promise<void> {
    if (this.autoAdvanceInFlight) return;
    this.automaticError.set(null);
    await this.refresh();
  }

  private automaticSetupStoreUrl(): string {
    return this.woocommerce.getIdentity().storeUrl || window.AIAssistantConfig?.storeUrl || '';
  }

  private rememberAutomaticSetupChoice(enabled: boolean): void {
    this.automaticSetup.set(enabled);
    rememberAutomaticSetup(this.automaticSetupStoreUrl(), enabled);
  }

  private restoreAutomaticSetupChoice(): void {
    this.automaticSetup.set(readAutomaticSetup(this.automaticSetupStoreUrl()));
  }

  private clearAutomaticSetupChoice(): void {
    this.automaticError.set(null);
    this.rememberAutomaticSetupChoice(false);
  }
}

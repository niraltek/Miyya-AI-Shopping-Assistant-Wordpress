/**
 * Miyya Setup: the guided first run inside wp-admin, from "Connect my store" to "Miyya is
 * live on the storefront".
 *
 * Almost every step is derived from a fact the backend or WordPress already holds, so a
 * merchant who reloads, or comes back tomorrow, lands on the right step rather than the
 * first. The two things only a person can say - that the private chat answered
 * correctly, and that the storefront widget was seen - are kept by the plugin (PHP) and
 * arrive as `SetupState`.
 */

import { CatalogSyncError, CatalogSyncStatusResponse } from '../../catalog/models/catalog';
import { MerchantIndexStatusResponse } from '../../catalog/models/embedding';
import { MerchantStoreConnection } from '../../store/models/woocommerce';
import { WidgetVisibilityMode } from '../../store/models/widget-visibility';

export type SetupStepId = 'connect' | 'catalog' | 'trial' | 'preview' | 'launch' | 'live';

/** One entry in the stepper along the top of the screen. */
export interface SetupStepView {
  id: SetupStepId;
  title: string;
  /** One line under the title; says what the step is, never restates the title. */
  summary: string;
  done: boolean;
  /** The step setup is waiting on - the first one that is not done. */
  current: boolean;
}

/** Independent setup facts; the stepper applies their ordering. */
export interface SetupFacts {
  connected: boolean;
  catalogDone: boolean;
  planDone: boolean;
  chatVerified: boolean;
  launchChecked: boolean;
  live: boolean;
}

export interface CatalogReadinessInput {
  store: MerchantStoreConnection | null;
  status: MerchantIndexStatusResponse | null;
  /** The run this page started or found running; preferred over retained history. */
  run: CatalogSyncStatusResponse | null;
}

/** Combined import and indexing progress displayed by the setup screen. */
export interface SetupCatalogProgress {
  stage: 'import' | 'index';
  /** Native percentage for the active job, when the API can calculate one. */
  stagePercent: number | null;
  /** One overall setup percentage, deliberately below 100 until search is ready. */
  overallPercent: number;
}

export interface PortalAccessResponse {
  /** The portal's canonical login URL, supplied by the backend. */
  portalLoginUrl: string;
  /** The authenticated store owner's email, used only to prefill the portal login. */
  email: string;
}

/** The plugin's record of what only the merchant can confirm (`GET setup/state`). */
export interface SetupState {
  startedAt: string | null;
  chatVerifiedAt: string | null;
  launchedAt: string | null;
  /** True for a store that was live before Miyya Setup existed: setup is then complete. */
  legacy: boolean;
  visibility: WidgetVisibilityMode;
  storefrontUrl: string;
}

/** What the connect step is showing. `pending` is the backend verifying credentials. */
export type ConnectPhase = 'checking' | 'not_connected' | 'pending' | 'connected';

/**
 * Where the product catalog stands, folded from the sync run, the embedding index run
 * and the live counts into the five things the merchant needs to tell apart.
 */
export type CatalogReadiness =
  /** No import has been started for this connection. */
  | { state: 'idle' }
  /** Importing from the store, or indexing the imported products for AI search. */
  | {
      state: 'syncing';
      stage: 'import' | 'index';
      processed: number;
      total: number | null;
      percent: number | null;
    }
  /** The import itself failed, or the index run did; the message says which. */
  | { state: 'failed'; stage: 'import' | 'index'; message: string }
  /** The import finished but the store has no products to search. */
  | { state: 'empty' }
  /** Some products were imported and indexed, some failed: usable, with issues to show. */
  | {
      state: 'partial';
      usable: number;
      failed: number;
      errors: CatalogSyncError[];
    }
  /** Imported and indexed with nothing outstanding. */
  | { state: 'ready'; products: number };

/** What the free-trial step shows, from the store's entitlement. */
export type TrialPhase =
  | 'loading'
  /** The entitlement could not be read; the merchant can retry. */
  | 'unknown'
  | 'approval_required'
  | 'approval_rejected'
  /** Billing is switched off on this deployment: nothing to activate. */
  | 'not_required'
  /** The store owns Miyya or has a running trial. */
  | 'active'
  | 'waitlisted'
  | 'available'
  | 'expired'
  | 'frozen';

/** One line of the launch readiness check (`GET setup/launch-check`). */
export interface LaunchCheckItem {
  id: string;
  /** False for hosted-service checks that do not block local widget publication. */
  required?: boolean;
  label: string;
  passed: boolean;
  detail: string;
  /** What to do about it; empty once it passes. */
  fix: string;
}

export interface LaunchCheckResult {
  passed: boolean;
  checks: LaunchCheckItem[];
}

/**
 * `verified` - the widget was found on the public home page.
 * `not_found` / `unreachable` - published, but not seen (a cache, or a server that cannot
 * load its own site). `checks_failed` - nothing was published because a check stopped passing.
 */
export type LaunchVerification = 'verified' | 'not_found' | 'unreachable' | 'checks_failed';

export interface LaunchResult {
  published: boolean;
  verified: boolean;
  verification: LaunchVerification;
  message: string;
  storefrontUrl?: string;
  checks?: LaunchCheckItem[];
  state?: SetupState;
}

/** `POST trial/start`: the new or existing enrollment. */
export interface TrialStartResult {
  trialId: string;
  status: 'active' | 'waitlisted' | string;
  message?: string;
  activatedAt?: string | null;
  expiresAt?: string | null;
}

/** The billing contract's refusal, as the plugin passes it through under `detail`. */
export interface BillingRefusal {
  code?: string;
  message?: string;
  details?: { reason?: string };
}

export interface BillingRefusalResponse {
  detail?: BillingRefusal | string;
}

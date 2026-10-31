import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { SubscriptionService } from '../../../features/billing/services/subscription-service/subscription-service';

/**
 * Turns the backend's 402 into an explanation.
 *
 * `require_store_subscription_access` guards catalog sync, embeddings and the copilot,
 * so the first thing a merchant whose trial lapsed sees is one of those screens failing.
 * On its own that reads as a bug: nothing on the page says billing. Refreshing the
 * subscription state here makes the banner appear in the same tick as the failure, so
 * the error and its reason arrive together.
 *
 * **The error still propagates.** This is not error handling — each screen keeps its own
 * failure UI, and swallowing the response here would leave them showing a success state
 * for a request that did not happen. The only side effect is the refresh.
 */
export const subscriptionInterceptor: HttpInterceptorFn = (req, next) => {
  const subscription = inject(SubscriptionService);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 402) {
        // Not awaited: the refresh updates a signal, and the banner reacts on its own.
        // Blocking the error path on a second network call would only delay the screen's
        // own failure message.
        void subscription.refresh();
      }
      return throwError(() => error);
    }),
  );
};

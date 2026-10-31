import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorMessage } from '../../../../shared/utils/api-response';
import {
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideArrowDown,
  LucideArrowUpRight,
  LucideCheck,
  LucideCircleCheckBig,
  LucideClipboardCheck,
  LucideCopy,
  LucideDynamicIcon,
  LucideFilter,
  LucideGift,
  LucideMaximize2,
  LucideMinimize2,
  LucideMoon,
  LucidePackage,
  LucideRotateCcw,
  LucideSearch,
  LucideSendHorizontal,
  LucideShoppingCart,
  LucideSun,
  LucideThumbsDown,
  LucideThumbsUp,
  LucideTrash2,
  LucideX,
  type LucideIconData,
} from '@lucide/angular';
import { MiyyaMarkComponent } from '../../../../shared/components/miyya-mark-component/miyya-mark-component';
import { ThemeService } from '../../../../shared/services/theme-service/theme-service';
import { SubscriptionService } from '../../../billing/services/subscription-service/subscription-service';
import { WooCommerceService } from '../../../store/services/woocommerce-service/woocommerce-service';
import {
  ChatCategoryTile,
  ChatDragState,
  ChatLoadingStep,
  ChatMessage,
  ChatReadiness,
  ChatSuggestion,
  ChatTurnStage,
  FlowStep,
  ChatProgressStage,
  ChatSuggestionGroup,
} from '../../models/chat';
import { CartCommand, CopilotCartActionBlock } from '../../models/copilot';
import {
  ComparisonTable,
  MAX_COMPARE_PRODUCTS,
  MIN_COMPARE_PRODUCTS,
  Product,
} from '../../models/product';
import { CartService } from '../../services/cart-service/cart-service';
import { ChatLauncher } from '../../services/chat-launcher/chat-launcher';
import { CopilotService } from '../../services/copilot-service/copilot-service';
import { MarkdownService } from '../../services/markdown-service/markdown-service';
import { CartOfferComponent } from '../cart-offer-component/cart-offer-component';
import { ComparisonPanelComponent } from '../comparison-panel-component/comparison-panel-component';
import { InlineCategoryGridComponent } from '../inline-category-grid-component/inline-category-grid-component';
import { InlineComparisonComponent } from '../inline-comparison-component/inline-comparison-component';
import { InlineProductListComponent } from '../inline-product-list-component/inline-product-list-component';
import {
  PRODUCT_DRAG_MIME_TYPE,
  ProductResultsPanelComponent,
} from '../product-results-panel-component/product-results-panel-component';

const HIDDEN_MESSAGES_BEFORE_SCROLL_BUTTON = 8;

const TURN_PROGRESS: readonly ChatProgressStage[] = [
  { stage: 'thinking', label: 'Understanding your request' },
  { stage: 'found', label: 'Writing your answer' },
];

const STAGE_ORDER: readonly ChatTurnStage[] = ['idle', 'sent', 'thinking', 'searching', 'found'];

const FLOW_STEPS: readonly FlowStep[] = [
  { icon: LucideSearch.icon, label: 'Looking for you…', accent: '#3b82f6' },
  { icon: LucidePackage.icon, label: 'Finding options…', accent: '#f97316' },
  { icon: LucideFilter.icon, label: 'Narrowing it down…', accent: '#8b5cf6' },
  { icon: LucideShoppingCart.icon, label: 'Adding the best matches…', accent: '#10b981' },
  { icon: LucideClipboardCheck.icon, label: 'Checking details…', accent: '#0ea5e9' },
  { icon: LucideGift.icon, label: 'Almost ready…', accent: '#f59e0b' },
  { icon: LucideCircleCheckBig.icon, label: 'Here you go!', accent: '#22c55e' },
];

const FLOW_FINAL_STEP_INDEX = FLOW_STEPS.length - 1;

const FLOW_ENTER_MS = 380;

const FLOW_HOLD_MS = 1500;

const FLOW_EXIT_MS = 320;

const COMPARE_SUGGESTION = 'compare these products?';

const RECOMMENDATION_SUGGESTIONS: readonly string[] = [
  'Show me something similar',
  'Any better option?',
  'What goes well with this?',
  'Show me another option',
];

const STARTER_ICONS: readonly LucideIconData[] = [
  LucidePackage.icon,
  LucideSearch.icon,
  LucideShoppingCart.icon,
  LucideGift.icon,
];

@Component({
  selector: 'app-chat-component',
  imports: [
    CartOfferComponent,
    FormsModule,
    ProductResultsPanelComponent,
    ComparisonPanelComponent,
    InlineProductListComponent,
    InlineComparisonComponent,
    InlineCategoryGridComponent,
    MiyyaMarkComponent,
    LucideArrowDown,
    LucideArrowUpRight,
    LucideCheck,
    LucideCopy,
    LucideDynamicIcon,
    LucideMaximize2,
    LucideMinimize2,
    LucideMoon,
    LucideRotateCcw,
    LucideSendHorizontal,
    LucideSun,
    LucideThumbsDown,
    LucideThumbsUp,
    LucideTrash2,
    LucideX,
  ],
  styleUrl: './chat-component.scss',
  templateUrl: './chat-component.html',
  host: { '(window:resize)': 'onViewportResize()' },
})
export class ChatComponent {
  protected readonly cart = inject(CartService);
  protected readonly theme = inject(ThemeService);
  private readonly copilot = inject(CopilotService);
  private readonly markdown = inject(MarkdownService);
  private readonly woocommerce = inject(WooCommerceService);
  private readonly subscription = inject(SubscriptionService);
  private readonly starterSuggestions = signal<readonly string[]>([
    'What products do you have?',
    'Help me find something within my budget',
    'Help me compare two products',
  ]);
  protected readonly latestSuggestions = computed<ChatSuggestionGroup | null>(() => {
    if (this.isTyping()) {
      return null;
    }
    const last = this.messages().at(-1);
    if (!last || last.role !== 'assistant' || !last.suggestions?.length) {
      return null;
    }
    return { messageId: last.id, items: last.suggestions };
  });
  protected readonly messages = signal<ChatMessage[]>([
    this.createMessage('assistant', 'Checking whether Miyya is ready…'),
  ]);
  private readonly readiness = signal<ChatReadiness>({
    ready: false,
    status: 'checking',
    message: 'Checking whether Miyya is ready…',
  });
  protected readonly copilotReady = computed(() => this.readiness().ready);
  protected readonly assistantStatusLabel = computed(() => {
    const status = this.readiness().status;
    return status === 'ready'
      ? 'Online'
      : status === 'checking'
        ? 'Checking…'
        : status === 'setup_incomplete'
          ? 'Setup needed'
          : 'Unavailable';
  });
  protected readonly composerPlaceholder = computed(() =>
    this.copilotReady()
      ? 'Ask about a product...'
      : this.readiness().status === 'setup_incomplete'
        ? 'Finish setup to start chatting'
        : 'Miyya is unavailable',
  );
  protected readonly draft = signal('');
  protected readonly isTyping = signal(false);
  protected readonly isStreamingReply = signal(false);
  protected readonly hasConversation = computed(() => this.messages().length > 1);
  private readonly productInFocus = computed(() => {
    const messages = this.messages();
    const newest = messages.at(-1);
    if (!newest || newest.role !== 'assistant' || newest.isSearchError) {
      return false;
    }
    if (newest.comparison?.products.length) {
      return false;
    }
    if (newest.products?.length === 1) {
      return true;
    }
    return (
      !!this.pageProductName() &&
      !messages.some((message) => message.products?.length || message.comparison?.products.length)
    );
  });
  protected readonly suggestions = computed<readonly string[]>(() => {
    if (
      !this.copilotReady() ||
      this.isTyping() ||
      this.draft().trim() ||
      this.latestSuggestions()
    ) {
      return [];
    }
    if (this.productInFocus()) {
      return RECOMMENDATION_SUGGESTIONS;
    }
    return this.hasConversation() ? [] : this.starterSuggestions();
  });
  protected readonly isFresh = computed(
    () =>
      this.copilotReady() &&
      !this.isTyping() &&
      this.messages().every((message) => message.role !== 'user'),
  );
  protected readonly starterCards = computed(() => {
    const questions = this.productInFocus()
      ? RECOMMENDATION_SUGGESTIONS
      : this.starterSuggestions();
    return questions.map((question, index) => ({
      question,
      icon: STARTER_ICONS[index % STARTER_ICONS.length],
    }));
  });
  protected readonly copiedMessageId = signal<string | null>(null);
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly turnStage = signal<ChatTurnStage>('idle');
  private readonly foundProductCount = signal(0);
  protected readonly progressSteps = signal<Pick<ChatLoadingStep, 'label' | 'done'>[]>([]);
  protected readonly flowStepIndex = signal(0);
  protected readonly flowStepShown = signal(false);
  private flowTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly currentFlowStep = computed(() => FLOW_STEPS[this.flowStepIndex()]);
  protected readonly finalStepLabel = computed(() => {
    const count = this.foundProductCount();
    return count
      ? `Found ${count} great match${count === 1 ? '' : 'es'}!`
      : FLOW_STEPS[FLOW_FINAL_STEP_INDEX].label;
  });
  protected readonly flowFinalStepIndex = FLOW_FINAL_STEP_INDEX;
  protected readonly loadingSteps = computed<ChatLoadingStep[] | null>(() => {
    const stage = this.turnStage();
    if (stage === 'idle' || stage === 'sent') {
      return null;
    }
    const current = STAGE_ORDER.indexOf(stage);
    const count = this.foundProductCount();
    return TURN_PROGRESS.filter((step) => STAGE_ORDER.indexOf(step.stage) <= current).map(
      (step) => {
        const index = STAGE_ORDER.indexOf(step.stage);
        return {
          label:
            step.stage === 'found' && count
              ? `Found ${count} product${count === 1 ? '' : 's'} — writing your answer`
              : step.label,
          done: index < current,
          active: index === current,
        };
      },
    );
  });
  protected readonly activeProducts = signal<Product[] | null>(null);
  protected readonly activeComparison = signal<ComparisonTable | null>(null);
  protected readonly showComparisonPanel = computed(
    () => !!this.activeComparison()?.products.length,
  );
  protected readonly showProductPanel = computed(
    () => !!this.activeProducts()?.length && !this.showComparisonPanel(),
  );
  protected readonly hasSidePanel = computed(
    () => this.showProductPanel() || this.showComparisonPanel(),
  );
  protected readonly sidePanelDismissed = signal(false);
  protected readonly sidePanelRequested = signal(false);
  protected readonly sidePanelVisible = computed(
    () => this.hasSidePanel() && !this.sidePanelDismissed() && this.sidePanelRequested(),
  );
  protected readonly sidePanelLabel = computed(() =>
    this.showComparisonPanel() ? 'comparison' : 'products',
  );
  protected readonly pageProductName = signal<string | null>(null);
  private static readonly MAX_PAGE_PRODUCT_CHARS = 38;
  protected readonly pageProductLabel = computed(() => {
    const name = this.pageProductName()?.trim();
    if (!name) {
      return null;
    }
    const limit = ChatComponent.MAX_PAGE_PRODUCT_CHARS;
    if (name.length <= limit) {
      return name;
    }
    const cut = name.slice(0, limit);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
  });
  protected readonly sidePanelCount = computed(() =>
    this.showComparisonPanel()
      ? this.activeComparison()!.products.length
      : (this.activeProducts()?.length ?? 0),
  );
  private sessionEpoch = 0;
  private lastCopilotQuery = '';
  protected readonly selectedProducts = signal<Product[]>([]);
  protected readonly selectedProductIds = computed(
    () => new Set(this.selectedProducts().map((product) => product.productId)),
  );
  protected readonly maxCompareProducts = MAX_COMPARE_PRODUCTS;
  protected readonly isDraggingOverComposer = signal(false);
  protected readonly floating = input(true, { transform: booleanAttribute });
  private readonly launcher = inject(ChatLauncher);
  protected readonly isOpen = this.launcher.isOpen;
  protected readonly isExpanded = signal(false);
  protected readonly showPanel = computed(() => !this.floating() || this.isOpen());
  protected readonly canClose = computed(() => this.floating());
  protected readonly canDrag = computed(() => this.floating() && !this.isExpanded() && !this.rail);
  protected readonly canExpand = computed(() => !this.rail);
  protected readonly morphing = signal(false);
  private morphTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly PANEL_MOTION_MS = 220;
  private static readonly MORPH_MS = 240;

  protected motionClass(name: string): string {
    return this.floating() ? name : '';
  }
  protected readonly showDeleteConfirm = signal(false);
  protected readonly showScrollToBottom = signal(false);
  protected readonly feedbackPromptFor = signal<string | null>(null);
  protected readonly feedbackComment = signal('');
  protected readonly feedbackReason = signal<string | null>(null);
  protected readonly feedbackError = signal(false);
  private readonly pendingFeedback = new Set<string>();
  protected readonly feedbackReasons = [
    { code: 'not_relevant', label: 'Not relevant' },
    { code: 'incorrect_info', label: 'Incorrect information' },
    { code: 'too_complex', label: 'Too complicated' },
    { code: 'incomplete', label: 'Did not answer' },
  ] as const;
  protected readonly feedbackSubmitting = signal(false);
  protected readonly dragOffset = signal({ x: 0, y: 0 });
  private readonly panel = viewChild<ElementRef<HTMLDivElement>>('panel');
  private readonly sidePanelToggle = viewChild<ElementRef<HTMLButtonElement>>('sidePanelToggle');
  private readonly scrollContainer = viewChild<ElementRef<HTMLDivElement>>('scrollContainer');
  private readonly scrollAnchor = viewChild<ElementRef<HTMLDivElement>>('scrollAnchor');
  private readonly messageEls = viewChildren<ElementRef<HTMLDivElement>>('msgEl');
  private dragState: ChatDragState | null = null;
  private scrollSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private userScrollPending = false;
  private readonly embedded = window.AIAssistantConfig?.embedded === true;
  private readonly rail =
    this.embedded &&
    (window.AIAssistantConfig?.widgetLayout === 'left' ||
      window.AIAssistantConfig?.widgetLayout === 'right');
  private hostHasSidePanel = false;
  private hostState: 'closed' | 'open' | 'expanded' = 'closed';
  private static readonly OPEN_STATE_KEY = 'aiAssistantChatOpenState';

  private readPersistedOpenState(): boolean | null {
    try {
      const value = sessionStorage.getItem(ChatComponent.OPEN_STATE_KEY);
      return value === null ? null : value === '1';
    } catch {
      return null;
    }
  }

  private persistOpenState(open: boolean): void {
    try {
      sessionStorage.setItem(ChatComponent.OPEN_STATE_KEY, open ? '1' : '0');
    } catch {}
  }

  private postToHost(message: Record<string, unknown>): void {
    if (!this.embedded) {
      return;
    }
    window.parent.postMessage({ source: 'ai-assistant-widget', ...message }, '*');
  }

  constructor() {
    afterRenderEffect(() => {
      this.messages();
      this.isTyping();
      if (this.showPanel()) {
        this.cancelScrollSync();
        const container = this.scrollContainer()?.nativeElement;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
        this.showScrollToBottom.set(false);
      }
    });
    effect((onCleanup) => {
      const state = !this.isOpen() ? 'closed' : this.isExpanded() ? 'expanded' : 'open';
      const wide = this.sidePanelVisible()
        ? this.showComparisonPanel()
          ? 'comparison'
          : 'products'
        : false;
      const publish = () => {
        this.hostHasSidePanel = !!wide;
        this.hostState = state;
        this.postToHost({ state, wide });
      };
      const releasingDrawer = state === 'open' && !wide && this.hostHasSidePanel;
      const closingPanel = state === 'closed' && this.hostState !== 'closed';
      const delay = closingPanel ? ChatComponent.PANEL_MOTION_MS : releasingDrawer ? 180 : 0;
      if (delay > 0) {
        const timer = setTimeout(publish, delay);
        onCleanup(() => clearTimeout(timer));
      } else {
        publish();
      }
    });
    effect(() => {
      const enough = this.selectedProducts().length >= MIN_COMPARE_PRODUCTS;
      const draft = untracked(() => this.draft());
      if (enough && !draft) {
        this.draft.set(COMPARE_SUGGESTION);
        return;
      }
      if (!enough && draft === COMPARE_SUGGESTION) {
        this.draft.set('');
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.sessionEpoch += 1;
      this.clearFlowTimer();
      this.cancelScrollSync();
      this.stopWatchingReadiness();
    });
    effect(() => {
      const open = this.isOpen();
      if (this.floating()) {
        this.persistOpenState(open);
      }
    });
    const persistedOpenState = this.floating() ? this.readPersistedOpenState() : null;
    if (persistedOpenState === true) {
      this.launcher.open();
    }
    void this.initializeCopilot(persistedOpenState);
  }

  private async initializeCopilot(persistedOpenState: boolean | null): Promise<void> {
    this.initialPersistedOpenState = persistedOpenState;
    const readiness = await this.evaluateReadiness();
    this.readiness.set(readiness);
    this.replaceOpeningMessage(this.readinessMessage(readiness));
    if (!readiness.ready) {
      if (!this.embedded) {
        this.watchUntilReady();
      }
      return;
    }
    void this.finishReadyInitialization(persistedOpenState);
  }

  private async evaluateReadiness(): Promise<ChatReadiness> {
    if (!this.copilot.isConfigured) {
      return {
        ready: false,
        status: 'store_not_connected',
        message: 'Miyya is not connected to this store yet.',
      };
    }
    if (!this.embedded) {
      const setupIncomplete = await this.checkSetupComplete();
      if (setupIncomplete) {
        return setupIncomplete;
      }
    }
    try {
      const readiness = await this.copilot.getReadiness();
      return this.embedded && !readiness.ready
        ? { ...readiness, message: 'This stores assistant is temporarily unavailable. Please browse the store or try again later.' }
        : readiness;
    } catch (error) {
      return {
        ready: false,
        status: 'unavailable',
        message: this.embedded ? 'This stores assistant is temporarily unavailable. Please try again later.' : apiErrorMessage(error),
      };
    }
  }

  private async finishReadyInitialization(persistedOpenState: boolean | null): Promise<void> {
    if (this.readyInitializationFinished) return;
    this.readyInitializationFinished = true;
    void this.copilot.getPageProduct().then((product) => {
      this.pageProductName.set(product?.name ?? null);
      this.announcePageProduct(product?.name ?? null);
    });
    void this.restoreConversation(persistedOpenState);
    void this.loadStoreSuggestions();
  }
  private static readonly READINESS_POLL_MS = 3000;
  private readyInitializationFinished = false;
  private readinessPollTimer: ReturnType<typeof setInterval> | null = null;
  private initialPersistedOpenState: boolean | null = null;

  private watchUntilReady(): void {
    if (this.readiness().status === 'store_not_connected') {
      this.stopWatchingReadiness();
      return;
    }
    if (this.readinessPollTimer !== null) {
      return;
    }
    this.readinessPollTimer = setInterval(() => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      void this.recheckReadiness();
    }, ChatComponent.READINESS_POLL_MS);
  }

  private stopWatchingReadiness(): void {
    if (this.readinessPollTimer !== null) {
      clearInterval(this.readinessPollTimer);
      this.readinessPollTimer = null;
    }
  }

  private async recheckReadiness(): Promise<void> {
    const readiness = await this.evaluateReadiness();
    this.readiness.set(readiness);
    this.replaceOpeningMessage(this.readinessMessage(readiness));
    if (!readiness.ready) {
      this.watchUntilReady();
      return;
    }
    this.stopWatchingReadiness();
    void this.finishReadyInitialization(this.initialPersistedOpenState);
  }

  private async checkSetupComplete(): Promise<ChatReadiness | null> {
    try {
      const connection = await this.woocommerce.getConnectionStatus();
      if (connection.status !== 'connected') {
        return {
          ready: false,
          status: 'store_not_connected',
          message: 'Connect your WooCommerce store to use Miyya chat.',
        };
      }
      await this.subscription.refresh();
      const status = this.subscription.status();
      if (!status?.setupMessage) return null;
      return {
        ready: false,
        status: 'setup_incomplete',
        message: status.setupMessage,
      };
    } catch (error) {
      // Standalone development has no WordPress proxy; its public readiness check
      // remains authoritative. In wp-admin, a failed connection check must stop here.
      if (!window.AIAssistantConfig?.merchantApiUrl) return null;
      return { ready: false, status: 'unavailable', message: apiErrorMessage(error) };
    }
  }

  private readinessMessage(readiness: ChatReadiness): string {
    return readiness.message;
  }

  private replaceOpeningMessage(text: string): void {
    if (this.messages().length !== 1 || this.messages()[0].role !== 'assistant') {
      return;
    }
    this.messages.set([this.createMessage('assistant', text)]);
  }

  private async loadStoreSuggestions(): Promise<void> {
    if (!this.copilot.isConfigured) {
      return;
    }
    try {
      const capabilities = await this.copilot.getCatalogCapabilities();
      const categories = [...(capabilities.categories ?? [])]
        .filter((category) => category.productCount > 0 && category.name.trim())
        .sort((a, b) => b.productCount - a.productCount)
        .slice(0, 2)
        .map((category) => `Show me ${category.name.trim()}`);
      if (categories.length) {
        this.starterSuggestions.set(['What products do you have?', ...categories]);
      }
    } catch {}
  }

  protected browseCategory(tile: ChatCategoryTile): void {
    this.sendMessage(tile.message);
  }

  protected sendSuggestion(suggestion: ChatSuggestion): void {
    this.sendMessage(suggestion.message);
  }

  private async restoreConversation(persistedOpenState: boolean | null): Promise<void> {
    if (!this.copilot.isConfigured || !this.copilot.resumeStoredSession()) {
      return;
    }
    let restored;
    try {
      restored = await this.copilot.getConversation();
    } catch {
      this.copilot.forgetStoredSession();
      return;
    }
    const history = (restored.messages ?? []).map((message) => {
      const products =
        message.role === 'assistant' ? this.copilot.productsFromBlocks(message.blocks ?? []) : [];
      const comparison =
        message.role === 'assistant'
          ? this.copilot.comparisonFromBlocks(message.blocks ?? [])
          : null;
      const cartAction =
        message.role === 'assistant'
          ? (message.blocks ?? []).find((block) => block.type === 'cart_action')
          : undefined;
      return this.createMessage(
        message.role,
        message.content || this.copilot.textFromBlocks(message.blocks ?? []),
        {
          products: products.length ? products : undefined,
          comparison: comparison?.products.length ? comparison : undefined,
          suggestions:
            message.role === 'assistant'
              ? this.copilot.suggestionsFromBlocks(message.blocks ?? [])
              : undefined,
          cartAction,
          cartResult: cartAction
            ? (this.cart.savedResult(cartAction.commandId) ?? {
                ok: false,
                message:
                  'This cart request was confirmed earlier. Open your cart to check its current state.',
                items: [],
              })
            : undefined,
          cartOffer:
            message.role === 'assistant'
              ? (message.blocks ?? []).find((block) => block.type === 'cart_offer')
              : undefined,
          categories:
            message.role === 'assistant'
              ? this.copilot.categoriesFromBlocks(message.blocks ?? [])
              : undefined,
        },
      );
    });
    if (!history.length) {
      return;
    }
    this.messages.set(history);
    this.announcePageProduct(this.pageProductName());
    const newestFirst = [...history].reverse();
    this.activeProducts.set(
      newestFirst.find((message) => message.products?.length)?.products ?? null,
    );
    this.activeComparison.set(
      newestFirst.find((message) => message.comparison?.products.length)?.comparison ?? null,
    );
    if (this.floating() && persistedOpenState === null) {
      this.launcher.open();
    }
  }

  protected answerCart(command: CartCommand): void {
    this.sendMessage(
      command.reply === 'confirm' ? 'Yes, confirm the cart request' : 'No, cancel the cart request',
      command,
    );
  }

  private async executeCart(
    command: CopilotCartActionBlock,
    serverId: string,
    epoch: number,
  ): Promise<void> {
    if (this.isStaleTurn(epoch)) return;
    const result = await this.cart.execute(command);
    if (this.isStaleTurn(epoch)) return;
    this.messages.update((messages) =>
      messages.map((message) =>
        message.serverId === serverId ? { ...message, cartResult: result } : message,
      ),
    );
  }

  protected sendMessage(text?: string, cartCommand?: CartCommand): void {
    const content = (text ?? this.draft()).trim();
    if (!content || this.isTyping() || !this.copilotReady()) {
      return;
    }
    this.cancelScrollSync();
    this.messages.update((messages) => [...messages, this.createMessage('user', content)]);
    this.draft.set('');
    if (!this.copilot.isConfigured) {
      this.messages.update((messages) => [
        ...messages,
        this.createMessage(
          'assistant',
          "I can't reach this store's catalog right now, so I can't answer that. This chat needs a connected WooCommerce store.",
          { isSearchError: true },
        ),
      ]);
      return;
    }
    this.runCopilotTurn(content, cartCommand);
  }

  protected retryProductSearch(): void {
    if (this.isTyping()) {
      return;
    }
    if (this.lastCopilotQuery) {
      this.runCopilotTurn(this.lastCopilotQuery);
    }
  }

  private runCopilotTurn(query: string, cartCommand?: CartCommand): void {
    this.cancelScrollSync();
    this.lastCopilotQuery = query;
    this.isTyping.set(true);
    this.startSearchLoading();
    const selectedProductIds = this.selectedProducts().map((product) => product.productId);
    const startedAt = performance.now();
    let streamedMessage: ChatMessage | null = null;
    let streamedText = '';
    const epoch = this.sessionEpoch;
    this.copilot
      .streamMessage(
        query,
        selectedProductIds.length ? { selectedProductIds } : undefined,
        (event) => {
          if (this.isStaleTurn(epoch)) {
            return;
          }
          if (event.type === 'turn.started') {
            this.advanceStage('thinking');
            return;
          }
          if (event.type === 'turn.progress') {
            this.progressSteps.update((steps) => [
              ...steps
                .filter((step) => step.label !== event.data.label)
                .map((step) => ({ ...step, done: true })),
              { label: event.data.label, done: false },
            ]);
            this.advanceStage('searching');
            return;
          }
          if (event.type === 'products.ready') {
            this.foundProductCount.set(event.data.block.items.length);
            this.advanceStage('found');
            return;
          }
          if (event.type === 'comparison.ready') {
            this.foundProductCount.set(event.data.block.products.length);
            this.advanceStage('found');
            return;
          }
          if (event.type === 'clarification.ready') {
            this.advanceStage('found');
            return;
          }
          if (event.type !== 'assistant.delta' || !event.data.delta) {
            return;
          }
          streamedText += event.data.delta;
          if (streamedMessage === null) {
            streamedMessage = {
              ...this.createMessage('assistant', streamedText),
              html: this.markdown.renderStreaming(streamedText),
            };
            this.messages.update((messages) => [...messages, streamedMessage!]);
            this.cancelSearchLoading();
            this.isStreamingReply.set(true);
            return;
          }
          const streamedId = streamedMessage.id;
          const streamedHtml = this.markdown.renderStreaming(streamedText);
          this.messages.update((messages) =>
            messages.map((item) =>
              item.id === streamedId ? { ...item, text: streamedText, html: streamedHtml } : item,
            ),
          );
        },
        cartCommand,
      )
      .then((response) => {
        if (this.isStaleTurn(epoch)) {
          return;
        }
        const durationMs = performance.now() - startedAt;
        const products = this.copilot.productsFromBlocks(response.blocks);
        const comparison = this.copilot.comparisonFromBlocks(response.blocks);
        const suggestions = this.copilot.suggestionsFromBlocks(response.blocks);
        const categories = this.copilot.categoriesFromBlocks(response.blocks);
        const text =
          this.copilot.textFromBlocks(response.blocks) ||
          (products.length ? "Here's what I found." : 'I had nothing to add there.');
        this.finishSearchLoading(() => {
          if (this.isStaleTurn(epoch)) {
            return;
          }
          this.isTyping.set(false);
          this.isStreamingReply.set(false);
          this.messages.update((messages) => {
            const answer = this.createMessage('assistant', text, {
              products: products.length ? products : undefined,
              comparison: comparison?.products.length ? comparison : undefined,
              suggestions: suggestions.length ? suggestions : undefined,
              categories: categories.length ? categories : undefined,
              cartOffer: response.blocks.find((block) => block.type === 'cart_offer'),
              cartAction: response.blocks.find((block) => block.type === 'cart_action'),
              durationMs,
              serverId: response.messageId,
              creditsUsed: response.creditsUsed,
            });
            if (streamedMessage === null) {
              return [...messages, answer];
            }
            const streamedId = streamedMessage.id;
            return messages.map((item) => (item.id === streamedId ? answer : item));
          });
          const command = response.blocks.find((block) => block.type === 'cart_action');
          if (command) void this.executeCart(command, response.messageId, epoch);
          this.activeProducts.set(products.length ? products : null);
          this.activeComparison.set(comparison?.products.length ? comparison : null);
          if (comparison?.products.length) {
            this.selectedProducts.set([]);
          }
        });
      })
      .catch((error: unknown) => {
        if (this.isStaleTurn(epoch)) {
          return;
        }
        this.cancelSearchLoading();
        this.isTyping.set(false);
        this.isStreamingReply.set(false);
        if (error instanceof HttpErrorResponse && error.status === 402) {
          void this.recheckReadiness();
        }
        const answer = this.createMessage('assistant', this.embedded ? 'This stores assistant is temporarily unavailable. Please try again later.' : apiErrorMessage(error), {
          isSearchError: true,
        });
        this.messages.update((messages) => {
          if (streamedMessage === null) {
            return [...messages, answer];
          }
          const streamedId = streamedMessage.id;
          return messages.map((item) => (item.id === streamedId ? answer : item));
        });
        this.activeProducts.set(null);
        this.activeComparison.set(null);
      });
  }

  private startSearchLoading(): void {
    this.foundProductCount.set(0);
    this.progressSteps.set([]);
    this.turnStage.set('sent');
    this.flowStepIndex.set(0);
    this.flowStepShown.set(false);
    this.clearFlowTimer();
    this.flowTimer = setTimeout(() => this.scheduleFlowEnter(), 20);
  }

  private scheduleFlowEnter(): void {
    this.flowStepShown.set(true);
    this.flowTimer = setTimeout(() => this.scheduleFlowExit(), FLOW_ENTER_MS + FLOW_HOLD_MS);
  }

  private scheduleFlowExit(): void {
    this.flowStepShown.set(false);
    this.flowTimer = setTimeout(() => {
      this.flowStepIndex.update((index) => (index + 1) % FLOW_FINAL_STEP_INDEX);
      this.scheduleFlowEnter();
    }, FLOW_EXIT_MS);
  }

  private showFoundFlowStep(): void {
    this.clearFlowTimer();
    if (this.flowStepShown()) {
      this.flowStepShown.set(false);
      this.flowTimer = setTimeout(() => {
        this.flowStepIndex.set(FLOW_FINAL_STEP_INDEX);
        this.flowStepShown.set(true);
      }, FLOW_EXIT_MS);
      return;
    }
    this.flowStepIndex.set(FLOW_FINAL_STEP_INDEX);
    this.flowStepShown.set(true);
  }

  private clearFlowTimer(): void {
    if (this.flowTimer !== null) {
      clearTimeout(this.flowTimer);
      this.flowTimer = null;
    }
  }

  private finishSearchLoading(onDone: () => void): void {
    this.turnStage.set('idle');
    this.progressSteps.set([]);
    this.clearFlowTimer();
    onDone();
  }

  private cancelSearchLoading(): void {
    this.turnStage.set('idle');
    this.progressSteps.set([]);
    this.foundProductCount.set(0);
    this.clearFlowTimer();
  }

  private advanceStage(stage: ChatTurnStage): void {
    if (STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(this.turnStage())) {
      this.turnStage.set(stage);
      if (stage === 'found') {
        this.showFoundFlowStep();
      }
    }
  }

  protected toggleProductSelection(product: Product): void {
    const alreadySelected = this.selectedProducts().some((p) => p.productId === product.productId);
    if (alreadySelected) {
      this.selectedProducts.update((current) =>
        current.filter((p) => p.productId !== product.productId),
      );
      return;
    }
    this.addSelectedProduct(product);
  }

  private addSelectedProduct(product: Product): void {
    this.selectedProducts.update((current) => {
      if (
        current.some((p) => p.productId === product.productId) ||
        current.length >= MAX_COMPARE_PRODUCTS
      ) {
        return current;
      }
      return [...current, product];
    });
  }

  protected clearProductSelection(): void {
    this.selectedProducts.set([]);
  }

  protected removeSelectedProduct(productId: string): void {
    this.selectedProducts.update((current) => current.filter((p) => p.productId !== productId));
  }

  protected onComposerDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes(PRODUCT_DRAG_MIME_TYPE)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    this.isDraggingOverComposer.set(true);
  }

  protected onComposerDragLeave(): void {
    this.isDraggingOverComposer.set(false);
  }

  protected onComposerDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingOverComposer.set(false);
    const payload = event.dataTransfer?.getData(PRODUCT_DRAG_MIME_TYPE);
    if (!payload) {
      return;
    }
    try {
      this.addSelectedProduct(JSON.parse(payload) as Product);
    } catch {}
  }

  protected async copyAnswer(message: ChatMessage): Promise<void> {
    try {
      await navigator.clipboard.writeText(message.text);
    } catch {
      return;
    }
    this.copiedMessageId.set(message.id);
    if (this.copiedTimer) {
      clearTimeout(this.copiedTimer);
    }
    this.copiedTimer = setTimeout(() => this.copiedMessageId.set(null), 1600);
  }

  protected onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  protected autoGrow(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }

  protected requestClear(): void {
    this.showDeleteConfirm.set(true);
  }

  protected cancelClear(): void {
    this.showDeleteConfirm.set(false);
  }

  private isStaleTurn(epoch: number): boolean {
    return epoch !== this.sessionEpoch;
  }

  protected confirmClear(): void {
    this.showDeleteConfirm.set(false);
    this.resetSession('Conversation cleared. What can I help you find or compare?');
    void this.copilot.endConversation();
  }

  private resetSession(greeting: string): void {
    this.sessionEpoch += 1;
    this.cancelScrollSync();
    this.cancelSearchLoading();
    this.isTyping.set(false);
    this.isStreamingReply.set(false);
    this.lastCopilotQuery = '';
    this.selectedProducts.set([]);
    this.activeProducts.set(null);
    this.activeComparison.set(null);
    this.showScrollToBottom.set(false);
    this.sidePanelDismissed.set(false);
    this.sidePanelRequested.set(false);
    this.feedbackPromptFor.set(null);
    this.feedbackComment.set('');
    this.messages.set([this.createMessage('assistant', greeting)]);
  }

  protected trackProduct(
    message: ChatMessage,
    product: Product,
    kind: 'card_open' | 'add_to_cart',
  ): void {
    if (!message.serverId) {
      return;
    }
    const position = (message.products ?? []).findIndex((p) => p.productId === product.productId);
    void this.copilot.recordInteraction(
      message.serverId,
      kind,
      product.productId,
      position >= 0 ? position + 1 : undefined,
    );
  }

  protected async submitThumbsUp(message: ChatMessage): Promise<void> {
    if (!message.serverId || message.feedback || this.pendingFeedback.has(message.id)) {
      return;
    }
    this.pendingFeedback.add(message.id);
    try {
      await this.copilot.submitFeedback(1, message.serverId);
      this.setMessageFeedback(message.id, 'up');
    } catch {
    } finally {
      this.pendingFeedback.delete(message.id);
    }
  }

  protected openThumbsDownPrompt(message: ChatMessage): void {
    if (!message.serverId || message.feedback) {
      return;
    }
    this.feedbackComment.set('');
    this.feedbackReason.set(null);
    this.feedbackError.set(false);
    this.feedbackPromptFor.set(message.id);
  }

  protected cancelFeedbackPrompt(): void {
    if (this.feedbackSubmitting()) {
      return;
    }
    this.feedbackPromptFor.set(null);
    this.feedbackComment.set('');
    this.feedbackReason.set(null);
    this.feedbackError.set(false);
  }

  protected async submitThumbsDownFeedback(): Promise<void> {
    const messageId = this.feedbackPromptFor();
    const message = this.messages().find((item) => item.id === messageId);
    if (!message?.serverId || this.feedbackSubmitting()) {
      return;
    }
    this.feedbackSubmitting.set(true);
    this.feedbackError.set(false);
    try {
      await this.copilot.submitFeedback(
        -1,
        message.serverId,
        this.feedbackComment().trim() || undefined,
        this.feedbackReason() || undefined,
      );
    } catch {
      this.feedbackError.set(true);
      return;
    } finally {
      this.feedbackSubmitting.set(false);
    }
    this.setMessageFeedback(message.id, 'down');
    this.feedbackPromptFor.set(null);
    this.feedbackComment.set('');
    this.feedbackReason.set(null);
  }

  private setMessageFeedback(id: string, feedback: 'up' | 'down'): void {
    this.messages.update((messages) =>
      messages.map((item) => (item.id === id ? { ...item, feedback } : item)),
    );
  }

  protected openChat(): void {
    this.isOpen.set(true);
  }

  protected closeChat(): void {
    this.cancelScrollSync();
    this.isOpen.set(false);
    this.isExpanded.set(false);
    this.showDeleteConfirm.set(false);
    this.feedbackPromptFor.set(null);
    this.dragState = null;
    this.dragOffset.set({ x: 0, y: 0 });
  }

  protected panelClasses(): string {
    if (this.isExpanded()) {
      return 'fixed inset-0 z-[100001] rounded-none border-0';
    }
    if (this.floating()) {
      return (
        'fixed inset-x-3 bottom-3 z-[100001] h-[min(56.25rem,calc(100dvh-2rem))] rounded-2xl border ' +
        'sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-fit sm:max-w-[calc(100vw-3rem)]'
      );
    }
    return 'relative mx-auto my-6 h-[min(72dvh,50rem)] min-h-[26rem] w-[calc(100%-2rem)] sm:w-fit sm:max-w-[calc(100%-2rem)] rounded-2xl border';
  }

  protected chatColumnClasses(): string {
    return this.isExpanded()
      ? 'aa-chat-column w-full min-w-0 flex-1'
      : 'aa-chat-column w-full min-w-0 flex-1 sm:w-[40rem] sm:max-w-[calc(100vw-3rem)] sm:flex-none';
  }

  protected sidePanelWrapperClasses(): string {
    return (
      'aa-side-panel' +
      (this.sidePanelVisible() ? ' aa-side-panel--visible' : '') +
      (this.showComparisonPanel() ? ' aa-side-panel--comparison' : '')
    );
  }
  protected readonly expandedTop = 'var(--wp-admin--admin-bar--height, 0px)';

  protected toggleExpand(): void {
    this.isExpanded.update((expanded) => !expanded);
    if (this.morphTimer) {
      clearTimeout(this.morphTimer);
    }
    this.morphing.set(true);
    this.morphTimer = setTimeout(() => this.morphing.set(false), ChatComponent.MORPH_MS);
    this.dragState = null;
    this.dragOffset.set({ x: 0, y: 0 });
  }

  protected scrollToBottom(): void {
    this.cancelScrollSync();
    this.showMessageProducts(this.messages().length - 1);
    this.scrollAnchor()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
    this.showScrollToBottom.set(false);
  }

  protected toggleSidePanel(): void {
    if (this.sidePanelVisible()) {
      this.sidePanelDismissed.set(true);
      return;
    }
    this.sidePanelDismissed.set(false);
    this.sidePanelRequested.set(true);
  }

  protected showSearchProducts(message: ChatMessage): boolean {
    if (!message.products?.length) return false;
    const comparedIds = new Set(message.comparison?.products.map((product) => product.productId));
    return message.products.some((product) => !comparedIds.has(product.productId));
  }

  protected openComparison(message: ChatMessage): void {
    if (!message.comparison?.products.length) {
      return;
    }
    this.activeComparison.set(message.comparison);
    this.sidePanelDismissed.set(false);
    this.sidePanelRequested.set(true);
  }

  protected answerTooltip(message: ChatMessage): string {
    const parts = [message.time];
    if (message.durationMs !== undefined) {
      parts.push(`answered in ${this.formatDuration(message.durationMs)}`);
    }
    if (!this.embedded && message.creditsUsed) {
      parts.push(`${message.creditsUsed.toLocaleString()} credits used`);
    }
    return parts.join(' · ');
  }

  protected checkedLive(message: ChatMessage): boolean {
    const products = message.comparison?.products.length
      ? message.comparison.products
      : (message.products ?? []);
    const priced = products.filter((product) => product.price.current !== null);
    return priced.length > 0 && priced.every((product) => product.price.verified);
  }

  protected closeSidePanel(): void {
    this.sidePanelDismissed.set(true);
    this.sidePanelToggle()?.nativeElement.focus({ preventScroll: true });
  }

  protected onMessagesScrollIntent(event: Event): void {
    if (this.isTyping()) {
      return;
    }
    if (
      event instanceof KeyboardEvent &&
      !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
    ) {
      return;
    }
    this.userScrollPending = true;
  }

  private cancelScrollSync(): void {
    this.userScrollPending = false;
    if (this.scrollSyncTimer !== null) {
      clearTimeout(this.scrollSyncTimer);
      this.scrollSyncTimer = null;
    }
  }

  protected onMessagesScroll(): void {
    const container = this.scrollContainer()?.nativeElement;
    const els = this.messageEls();
    if (!container || els.length === 0) {
      this.showScrollToBottom.set(false);
      return;
    }
    const containerBottom = container.getBoundingClientRect().bottom;
    let lastVisibleIndex = -1;
    els.forEach((el, index) => {
      if (el.nativeElement.getBoundingClientRect().top < containerBottom) {
        lastVisibleIndex = index;
      }
    });
    const hiddenBelow = els.length - 1 - lastVisibleIndex;
    this.showScrollToBottom.set(hiddenBelow >= HIDDEN_MESSAGES_BEFORE_SCROLL_BUTTON);
    if (this.isTyping()) {
      this.cancelScrollSync();
      return;
    }
    if (!this.userScrollPending) {
      return;
    }
    if (this.scrollSyncTimer !== null) {
      clearTimeout(this.scrollSyncTimer);
    }
    this.scrollSyncTimer = setTimeout(() => {
      this.cancelScrollSync();
      this.updateActiveProducts();
    }, 120);
  }

  private computeActiveMessageIndex(): number {
    const container = this.scrollContainer()?.nativeElement;
    const els = this.messageEls();
    if (!container || els.length === 0) {
      return -1;
    }
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 24;
    if (atBottom) {
      return els.length - 1;
    }
    const containerRect = container.getBoundingClientRect();
    const referenceY = containerRect.top + containerRect.height * 0.3;
    let activeIndex = 0;
    for (let i = 0; i < els.length; i++) {
      if (els[i].nativeElement.getBoundingClientRect().top <= referenceY) {
        activeIndex = i;
      } else {
        break;
      }
    }
    return activeIndex;
  }

  private updateActiveProducts(): void {
    this.showMessageProducts(this.computeActiveMessageIndex());
  }

  private showMessageProducts(index: number): void {
    if (this.isTyping()) {
      return;
    }
    const messages = this.messages();
    if (index < 0 || index >= messages.length) {
      return;
    }
    const relevant = this.findRelevantProductMessage(messages, index);
    if (!relevant) {
      return;
    }
    const isRelevantAssistantMessage = relevant?.role === 'assistant';
    this.activeProducts.set(
      isRelevantAssistantMessage && relevant.products?.length ? relevant.products : null,
    );
    this.activeComparison.set(
      isRelevantAssistantMessage && relevant.comparison?.products.length
        ? relevant.comparison
        : null,
    );
  }

  private findRelevantProductMessage(
    messages: ChatMessage[],
    index: number,
  ): ChatMessage | undefined {
    const current = messages[index];
    if (current.role === 'assistant') {
      return current;
    }
    for (let i = index + 1; i < messages.length; i++) {
      const candidate = messages[i];
      if (candidate.role === 'user') {
        break;
      }
      if (candidate.role === 'assistant') {
        return candidate;
      }
    }
    return undefined;
  }

  protected onDragPointerDown(event: PointerEvent): void {
    if (!this.canDrag()) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('button')) {
      return;
    }
    const panel = this.panel()?.nativeElement;
    if (!panel) {
      return;
    }
    const rect = panel.getBoundingClientRect();
    const offset = this.dragOffset();
    this.dragState = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      originX: offset.x,
      originY: offset.y,
      minDx: this.embedded ? -Infinity : -rect.left,
      maxDx: this.embedded ? Infinity : window.innerWidth - rect.right,
      minDy: this.embedded ? -Infinity : -rect.top,
      maxDy: this.embedded ? Infinity : window.innerHeight - rect.bottom,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    if (this.embedded) {
      this.postToHost({ drag: 'start' });
    }
  }

  protected onDragPointerMove(event: PointerEvent): void {
    const drag = this.dragState;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    if (this.embedded) {
      this.postToHost({
        drag: { dx: event.screenX - drag.screenX, dy: event.screenY - drag.screenY },
      });
      return;
    }
    const dx = Math.min(Math.max(event.clientX - drag.pointerX, drag.minDx), drag.maxDx);
    const dy = Math.min(Math.max(event.clientY - drag.pointerY, drag.minDy), drag.maxDy);
    this.dragOffset.set({ x: drag.originX + dx, y: drag.originY + dy });
  }

  protected onDragPointerUp(event: PointerEvent): void {
    if (this.dragState?.pointerId === event.pointerId) {
      this.dragState = null;
      this.postToHost({ drag: 'end' });
    }
  }

  protected onViewportResize(): void {
    if (this.embedded || !this.canDrag()) {
      this.dragOffset.set({ x: 0, y: 0 });
      return;
    }
    const panel = this.panel()?.nativeElement;
    if (!panel) {
      return;
    }
    const rect = panel.getBoundingClientRect();
    const offset = this.dragOffset();
    let { x, y } = offset;
    if (rect.right > window.innerWidth) {
      x -= rect.right - window.innerWidth;
    }
    if (rect.left < 0) {
      x -= rect.left;
    }
    if (rect.bottom > window.innerHeight) {
      y -= rect.bottom - window.innerHeight;
    }
    if (rect.top < 0) {
      y -= rect.top;
    }
    if (x !== offset.x || y !== offset.y) {
      this.dragOffset.set({ x, y });
    }
  }

  protected formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) {
      return '0 ms';
    }
    if (ms < 1000) {
      return `${Math.round(ms)} ms`;
    }
    const totalSeconds = ms / 1000;
    if (totalSeconds < 60) {
      return `${totalSeconds.toFixed(1)} s`;
    }
    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds % 60);
    if (totalMinutes < 60) {
      return `${totalMinutes} ${totalMinutes === 1 ? 'min' : 'mins'} ${seconds} ${seconds === 1 ? 'sec' : 'secs'}`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ${minutes} ${minutes === 1 ? 'min' : 'mins'}`;
  }

  private announcePageProduct(name: string | null): void {
    const next = name?.trim();
    if (!next) {
      return;
    }
    const text = `Conversation switched to ${next}`;
    if (this.messages().some((message) => message.role === 'system' && message.text === text)) {
      return;
    }
    this.messages.update((messages) => [...messages, this.createMessage('system', text)]);
  }

  private createMessage(
    role: ChatMessage['role'],
    text: string,
    extra?: Pick<
      ChatMessage,
      | 'products'
      | 'isSearchError'
      | 'comparison'
      | 'durationMs'
      | 'serverId'
      | 'feedback'
      | 'suggestions'
      | 'categories'
      | 'cartOffer'
      | 'cartAction'
      | 'cartResult'
      | 'creditsUsed'
    >,
  ): ChatMessage {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      text,
      html:
        role === 'assistant'
          ? this.markdown.render(text, [
              ...(extra?.products ?? []),
              ...(extra?.comparison?.products ?? []),
            ])
          : undefined,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      ...extra,
    };
  }
}

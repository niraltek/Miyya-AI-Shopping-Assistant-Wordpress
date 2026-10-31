import { Service, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { CartService } from '../cart-service/cart-service';
import { environment } from '../../../../../environments/environment.development';
import { ChatCategoryTile, ChatSuggestion } from '../../models/chat';
import {
  CopilotBlock,
  CartCommand,
  CopilotCatalogCapabilities,
  CopilotConversationDetail,
  CopilotConversationResponse,
  CopilotMessageResponse,
  CopilotProductCard,
  CopilotReadinessResponse,
  CopilotStreamEvent,
  PageProduct,
  StoredCopilotSession,
  CachedShopperToken,
  ShopperTokenResponse,
} from '../../models/copilot';
import { ComparisonTable, Product } from '../../models/product';
import { isNgrokUrl } from '../../../../core/interceptors/ngrok/ngrok-interceptor';
import {
  productPrice,
  productStockStatus,
  setActivePriceFormat,
} from '../../utils/product-display';

class StreamInterruptedError extends Error {
  constructor(readonly reason: string) {
    super('The connection was interrupted before the answer arrived. Please try again.');
    this.name = 'StreamInterruptedError';
  }
}

@Service()
export class CopilotService {
  private readonly http = inject(HttpClient);
  private readonly cart = inject(CartService);
  private readonly baseUrl = (
    window.AIAssistantConfig?.apiBaseUrl?.trim() || environment.apiBaseUrl
  ).replace(/\/+$/, '');
  private readonly storeUrl = window.AIAssistantConfig?.storeUrl ?? '';
  private readonly viewingProductSourceId = window.AIAssistantConfig?.viewingProductSourceId;
  private static readonly STORAGE_KEY = 'aiAssistantCopilotSession';
  private readonly storageKey = `${CopilotService.STORAGE_KEY}:${encodeURIComponent(this.baseUrl)}:${encodeURIComponent(this.storeUrl)}`;
  private conversationId: string | null = null;
  private sessionSecret: string | null = null;
  private starting: Promise<string> | null = null;

  get isConfigured(): boolean {
    return !!this.storeUrl && (window.AIAssistantConfig?.embedded !== true || window.AIAssistantConfig.hasSiteToken === true);
  }

  get activeConversationId(): string | null {
    return this.conversationId;
  }

  getReadiness(): Promise<CopilotReadinessResponse> {
    if (!this.isConfigured) {
      return Promise.resolve({ ready: false, status: 'store_not_connected', message: 'Miyya is not connected to this store yet.' });
    }
    return firstValueFrom(
      this.http.get<CopilotReadinessResponse>(`${this.baseUrl}/api/v1/copilot/readiness`, {
        params: { storeUrl: this.storeUrl },
      }),
    ).then((readiness) => {
      setActivePriceFormat(readiness.priceFormat);
      return readiness;
    });
  }

  resumeStoredSession(): boolean {
    if (this.conversationId) {
      return false;
    }
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) {
        return false;
      }
      const stored = JSON.parse(raw) as StoredCopilotSession;
      if (
        typeof stored.conversationId !== 'string' ||
        !stored.conversationId ||
        typeof stored.sessionSecret !== 'string' ||
        !stored.sessionSecret ||
        stored.storeUrl !== this.storeUrl ||
        stored.apiBaseUrl !== this.baseUrl
      ) {
        return false;
      }
      this.conversationId = stored.conversationId;
      this.sessionSecret = stored.sessionSecret;
      return true;
    } catch {
      return false;
    }
  }

  forgetStoredSession(): void {
    this.conversationId = null;
    this.sessionSecret = null;
    try {
      window.localStorage.removeItem(this.storageKey);
    } catch {}
  }

  private persistSession(): void {
    if (!this.conversationId || !this.sessionSecret) {
      return;
    }
    try {
      window.localStorage.setItem(
        this.storageKey,
        JSON.stringify({
          conversationId: this.conversationId,
          sessionSecret: this.sessionSecret,
          apiBaseUrl: this.baseUrl,
          storeUrl: this.storeUrl,
        }),
      );
    } catch {}
  }
  private readonly shopperTokenUrl = window.AIAssistantConfig?.shopperTokenUrl ?? '';
  private shopperToken: CachedShopperToken | null = null;
  private shopperCheckedAt = 0;

  private async shopperHeaders(): Promise<Record<string, string>> {
    if (!this.shopperTokenUrl) {
      return {};
    }
    const now = Date.now();
    const usable = this.shopperToken && this.shopperToken.expiresAt * 1000 - 60000 > now;
    if (!usable && now - this.shopperCheckedAt > 60000) {
      this.shopperCheckedAt = now;
      this.shopperToken = null;
      try {
        const reply = await firstValueFrom(
          this.http.get<ShopperTokenResponse>(this.shopperTokenUrl, {
            withCredentials: true,
          }),
        );
        if (reply.token && reply.expiresAt) {
          this.shopperToken = { value: reply.token, expiresAt: reply.expiresAt };
        }
      } catch {}
    }
    return this.shopperToken ? { 'X-Shopper-Token': this.shopperToken.value } : {};
  }

  private async messageHeaders(): Promise<HttpHeaders> {
    return new HttpHeaders({
      ...(this.sessionSecret ? { 'X-Conversation-Secret': this.sessionSecret } : {}),
      ...(await this.shopperHeaders()),
      ...(await this.cart.contextHeaders()),
    });
  }

  private secretHeaders(): HttpHeaders {
    return new HttpHeaders(
      this.sessionSecret ? { 'X-Conversation-Secret': this.sessionSecret } : {},
    );
  }

  async ensureConversation(): Promise<string> {
    if (!this.isConfigured) throw new Error('Miyya is not connected to this store yet.');
    if (this.conversationId) {
      return this.conversationId;
    }
    if (this.starting) {
      return this.starting;
    }
    this.starting = (async () => {
      const response = await firstValueFrom(
        this.http.post<CopilotConversationResponse>(
          `${this.baseUrl}/api/v1/copilot/conversations`,
          { storeUrl: this.storeUrl },
        ),
      );
      this.conversationId = response.conversationId;
      this.sessionSecret = response.sessionSecret ?? null;
      this.persistSession();
      return response.conversationId;
    })();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async sendMessage(
    message: string,
    pageContext?: Record<string, unknown>,
    cartCommand?: CartCommand,
  ): Promise<CopilotMessageResponse> {
    const conversationId = await this.ensureConversation();
    return firstValueFrom(
      this.http.post<CopilotMessageResponse>(
        `${this.baseUrl}/api/v1/copilot/conversations/${conversationId}/messages`,
        {
          message,
          clientMessageId: this.newClientMessageId(),
          pageContext: this.withViewingProductContext(pageContext),
          ...(cartCommand ? { cartCommand } : {}),
        },
        { headers: await this.messageHeaders() },
      ),
    );
  }

  async streamMessage(
    message: string,
    pageContext?: Record<string, unknown>,
    onEvent?: (event: CopilotStreamEvent) => void,
    cartCommand?: CartCommand,
  ): Promise<CopilotMessageResponse> {
    const conversationId = await this.ensureConversation();
    const clientMessageId = this.newClientMessageId();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(await this.shopperHeaders()),
      ...(await this.cart.contextHeaders()),
    };
    if (this.sessionSecret) {
      headers['X-Conversation-Secret'] = this.sessionSecret;
    }
    // fetch does not pass through Angular's HTTP interceptors.
    if (isNgrokUrl(this.baseUrl)) headers['ngrok-skip-browser-warning'] = 'true';
    try {
      let response: Response;
      try {
        response = await fetch(
          `${this.baseUrl}/api/v1/copilot/conversations/${conversationId}/messages/stream`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              message,
              clientMessageId,
              pageContext: this.withViewingProductContext(pageContext),
              ...(cartCommand ? { cartCommand } : {}),
            }),
          },
        );
      } catch {
        throw new StreamInterruptedError('network');
      }
      if (!response.ok) {
        throw new HttpErrorResponse({
          error: await response.json().catch(() => null),
          status: response.status,
          statusText: response.statusText,
          url: response.url,
        });
      }
      return await this.readMessageStream(response, onEvent);
    } catch (error) {
      // An HTTP/domain failure or a UI callback exception must stay a failure.
      if (!(error instanceof StreamInterruptedError)) throw error;
      console.warn('Copilot stream interrupted', {
        conversationId,
        clientMessageId,
        reason: error.reason,
      });
      const recovered = await this.recoverMessage(conversationId, clientMessageId, headers);
      if (recovered) return recovered;
      throw error;
    }
  }

  private async recoverMessage(
    conversationId: string,
    clientMessageId: string,
    headers: Record<string, string>,
  ): Promise<CopilotMessageResponse | null> {
    // The original transaction may still be committing. Never POST a second turn
    // or infer a response from the latest transcript entry (it may be another tab).
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 250));
      try {
        const result = await firstValueFrom(
          this.http
            .get<CopilotMessageResponse | null>(
              `${this.baseUrl}/api/v1/copilot/conversations/${conversationId}/messages/result`,
              { headers, params: { clientMessageId } },
            )
            .pipe(timeout(3000)),
        );
        if (result) return result;
      } catch {
        return null;
      }
    }
    return null;
  }

  private async readMessageStream(
    response: Response,
    onEvent?: (event: CopilotStreamEvent) => void,
  ): Promise<CopilotMessageResponse> {
    if (!response.body) throw new StreamInterruptedError('missing_body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completed: CopilotMessageResponse | null = null;
    const processRecord = (record: string): void => {
      const data = record
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) {
        return;
      }
      let event: CopilotStreamEvent;
      try {
        event = JSON.parse(data) as CopilotStreamEvent;
        if (!event || typeof event.type !== 'string' || !event.data) throw new Error();
        if (
          event.type === 'turn.completed' &&
          (!Array.isArray(event.data.blocks) ||
            !event.data.messageId ||
            !event.data.conversationId ||
            !event.turnId)
        )
          throw new Error();
      } catch {
        throw new StreamInterruptedError('invalid_event');
      }
      onEvent?.(event);
      if (event.type === 'turn.failed') {
        throw new Error(event.data.message);
      }
      if (event.type === 'turn.completed') {
        completed = {
          messageId: event.data.messageId,
          turnId: event.turnId,
          conversationId: event.data.conversationId,
          traceId: event.data.traceId,
          stateVersion: event.data.stateVersion,
          blocks: event.data.blocks,
          creditsUsed: event.data.creditsUsed,
          creditsRemaining: event.data.creditsRemaining,
        };
      }
    };
    try {
      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch {
          throw new StreamInterruptedError('read_failed');
        }
        const { value, done } = chunk;
        buffer += decoder.decode(value, { stream: !done });
        buffer = buffer.replaceAll('\r\n', '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          processRecord(buffer.slice(0, boundary));
          // Completion is terminal. Proxy trailers and an eventual socket error
          // cannot invalidate an answer we have already received in full.
          if (completed) return completed;
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');
        }
        if (done) {
          if (buffer.trim()) {
            processRecord(buffer);
          }
          break;
        }
      }
      if (!completed) throw new StreamInterruptedError('missing_completion');
      return completed;
    } finally {
      // Some transports never finish closing. Cleanup must not delay the answer.
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  private withViewingProductContext(
    pageContext?: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const sourceId = this.viewingProductSourceId;
    if (typeof sourceId !== 'number' || !Number.isSafeInteger(sourceId) || sourceId <= 0) {
      return pageContext ?? null;
    }
    return { ...pageContext, viewingProductSourceId: sourceId };
  }

  getConversation(): Promise<CopilotConversationDetail> {
    if (!this.conversationId) {
      return Promise.reject(new Error('No conversation has been started.'));
    }
    return firstValueFrom(
      this.http.get<CopilotConversationDetail>(
        `${this.baseUrl}/api/v1/copilot/conversations/${this.conversationId}`,
        { headers: this.secretHeaders() },
      ),
    );
  }

  submitFeedback(
    rating: number,
    messageId?: string,
    comment?: string,
    reasonCode?: string,
  ): Promise<unknown> {
    if (!this.conversationId) {
      return Promise.resolve(null);
    }
    return firstValueFrom(
      this.http.post(
        `${this.baseUrl}/api/v1/copilot/conversations/${this.conversationId}/feedback`,
        { rating, messageId, comment, reasonCode },
        { headers: this.secretHeaders() },
      ),
    );
  }

  async recordInteraction(
    messageId: string,
    kind: 'card_open' | 'link_click' | 'add_to_cart',
    productId?: string,
    position?: number,
  ): Promise<void> {
    if (!this.conversationId) {
      return;
    }
    try {
      await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/api/v1/copilot/conversations/${this.conversationId}/interactions`,
          { messageId, kind, productId, position },
          { headers: this.secretHeaders() },
        ),
      );
    } catch {}
  }

  async endConversation(): Promise<void> {
    const conversationId = this.conversationId;
    const headers = this.secretHeaders();
    this.forgetStoredSession();
    if (!conversationId) {
      return;
    }
    try {
      await firstValueFrom(
        this.http.delete(`${this.baseUrl}/api/v1/copilot/conversations/${conversationId}`, {
          headers,
        }),
      );
    } catch {}
  }

  async getPageProduct(): Promise<PageProduct | null> {
    const sourceId = this.viewingProductSourceId;
    if (
      !this.storeUrl ||
      typeof sourceId !== 'number' ||
      !Number.isSafeInteger(sourceId) ||
      sourceId <= 0
    ) {
      return null;
    }
    try {
      return await firstValueFrom(
        this.http.get<PageProduct>(`${this.baseUrl}/api/v1/copilot/catalog/page-product`, {
          params: { storeUrl: this.storeUrl, sourceProductId: sourceId },
        }),
      );
    } catch {
      return null;
    }
  }

  getCatalogCapabilities(): Promise<CopilotCatalogCapabilities> {
    return firstValueFrom(
      this.http.get<CopilotCatalogCapabilities>(
        `${this.baseUrl}/api/v1/copilot/catalog/capabilities`,
        { params: { storeUrl: this.storeUrl } },
      ),
    );
  }

  productsFromBlocks(blocks: CopilotBlock[]): Product[] {
    const seen = new Set<string>();
    const products: Product[] = [];
    for (const block of blocks) {
      const cards =
        block.type === 'product_carousel' || block.type === 'product_grid'
          ? block.items
          : block.type === 'comparison'
            ? block.products
            : [];
      for (const card of cards) {
        if (seen.has(card.productId)) {
          continue;
        }
        seen.add(card.productId);
        products.push(this.toProduct(card));
      }
    }
    return products;
  }

  comparisonFromBlocks(blocks: CopilotBlock[]): ComparisonTable | null {
    const comparison = blocks.find((block) => block.type === 'comparison');
    if (!comparison) {
      return null;
    }
    const products = comparison.products.map((card) => this.toProduct(card));
    const rows = comparison.rows
      .filter((row) => row.values.length === products.length)
      .map((row) => ({
        field: row.field,
        label: row.label,
        values: [...row.values],
        isLive: row.isLive,
      }));
    return { products, rows };
  }

  categoriesFromBlocks(blocks: CopilotBlock[]): ChatCategoryTile[] {
    const grid = blocks.find((block) => block.type === 'category_grid');
    if (!grid) {
      return [];
    }
    return grid.items.map((tile) => ({
      id: tile.sourceCategoryId,
      name: tile.name,
      productCount: tile.productCount,
      priceFrom: productPrice(tile.priceFrom),
      currency: tile.currency ?? '',
      imageUrl: tile.imageSrc ?? '',
      subcategories: [...tile.subcategories],
      message: tile.message,
    }));
  }

  suggestionsFromBlocks(blocks: CopilotBlock[]): ChatSuggestion[] {
    const suggestions: ChatSuggestion[] = [];
    const seen = new Set<string>();
    const add = (label: string, message: string) => {
      const text = message.trim();
      if (!label.trim() || !text || seen.has(text)) {
        return;
      }
      seen.add(text);
      suggestions.push({ label: label.trim(), message: text });
    };
    for (const block of blocks) {
      if (block.type === 'refinement_chips') {
        for (const chip of block.items) {
          add(chip.label, chip.message ?? chip.label);
        }
      } else if (block.type === 'clarification') {
        for (const option of block.options) {
          add(option.label, option.value || option.label);
        }
      }
    }
    return suggestions;
  }

  textFromBlocks(blocks: CopilotBlock[]): string {
    const parts: string[] = [];
    for (const block of blocks) {
      if (block.type === 'text') {
        parts.push(block.text);
      } else if (block.type === 'notice') {
        parts.push(block.text);
      } else if (block.type === 'clarification') {
        parts.push(block.question);
      } else if (block.type === 'refinement_chips' && block.prompt) {
        parts.push(block.prompt);
      }
    }
    return parts.join('\n\n');
  }

  private toProduct(card: CopilotProductCard): Product {
    const price = productPrice(card.price);
    const stockStatus = productStockStatus(card.stockStatus);
    return {
      productId: card.productId,
      name: card.name,
      brand: card.brand ?? '',
      category: '',
      description: '',
      price: {
        current: price,
        currency: card.currency ?? '',
        verified: price !== null && card.priceIsLive === true,
      },
      stock: {
        status: stockStatus,
        verified: stockStatus !== 'unknown' && card.stockIsLive === true,
      },
      imageUrl: card.imageSrc ?? '',
      productUrl: card.permalink ?? '',
      attributes: {},
      reason: card.rationale?.trim() || card.badges.join(' · '),
      match: { score: 0 },
      averageRating: card.averageRating != null ? Number(card.averageRating) : null,
      regularPrice: productPrice(card.regularPrice),
      cart: card.cart,
      productType: card.productType,
      cartProductId:
        ['simple', 'variable'].includes(card.productType ?? '') && card.sourceProductId
          ? card.sourceProductId
          : null,
    };
  }

  private newClientMessageId(): string {
    return (
      globalThis.crypto?.randomUUID?.() ?? `m-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
  }
}

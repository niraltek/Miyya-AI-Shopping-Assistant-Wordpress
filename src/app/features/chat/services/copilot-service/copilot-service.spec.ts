import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpErrorResponse, HttpRequest, provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { CopilotService } from './copilot-service';
import { CartService } from '../cart-service/cart-service';
import { CopilotBlock } from '../../models/copilot';

const STORE_URL = 'https://shop.example';
const API = 'https://api.example';

/**
 * The service reads window.AIAssistantConfig once, at construction, so the config has to be
 * in place before TestBed instantiates it — exactly as it is in WordPress, where the plugin
 * writes it in an inline script that runs before the bundle.
 */
function configureWindow(): void {
  window.AIAssistantConfig = {
    route: '/widget',
    apiBaseUrl: API,
    storeUrl: STORE_URL,
  };
}

describe('CopilotService', () => {
  let service: CopilotService;
  let http: HttpTestingController;

  beforeEach(() => {
    window.localStorage.clear();
    configureWindow();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CopilotService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    window.localStorage.clear();
    http.verify();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (window as { AIAssistantConfig?: unknown }).AIAssistantConfig;
  });

  /** Lets the promise continuations inside the service run. `sendMessage` awaits the
   * conversation start before issuing the message POST, so that second request does not
   * exist yet at the moment the first one is flushed. */
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** Answers the conversation-start request every send has to make first. */
  async function expectStart(secret = 'sekrit'): Promise<void> {
    const request = http.expectOne(`${API}/api/v1/copilot/conversations`);
    expect(request.request.body).toEqual({ storeUrl: STORE_URL });
    request.flush({ conversationId: 'conv-1', sessionSecret: secret, stateVersion: 0 });
    await tick();
  }

  it.each([false, undefined])('makes no service request before embedded consent is confirmed (%s)', async (hasSiteToken) => {
    TestBed.resetTestingModule();
    window.AIAssistantConfig = { route: '/widget', embedded: true, storeUrl: STORE_URL, apiBaseUrl: API, hasSiteToken };
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(CopilotService);
    http = TestBed.inject(HttpTestingController);
    expect(service.isConfigured).toBe(false);
    const result = await service.getReadiness();
    expect(result.ready).toBe(false);
    await expect(service.ensureConversation()).rejects.toThrow('not connected');
    http.expectNone(() => true);
  });

  it('permits hosted readiness after merchant connection, independently of billing', async () => {
    TestBed.resetTestingModule();
    window.AIAssistantConfig = { route: '/widget', embedded: true, storeUrl: STORE_URL, apiBaseUrl: API, hasSiteToken: true };
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(CopilotService);
    http = TestBed.inject(HttpTestingController);
    expect(service.isConfigured).toBe(true);
    const pending = service.getReadiness();
    http.expectOne((r) => r.url === `${API}/api/v1/copilot/readiness`).flush({ ready: false, status: 'credits_exhausted', message: 'Unavailable' });
    expect((await pending).status).toBe('credits_exhausted');
  });

  it('starts a conversation before the first message and reuses it after', async () => {
    const first = service.sendMessage('hello');
    await expectStart();
    http.expectOne(`${API}/api/v1/copilot/conversations/conv-1/messages`).flush({
      messageId: 'm1',
      turnId: 't1',
      conversationId: 'conv-1',
      stateVersion: 1,
      blocks: [],
    });
    await first;

    const second = service.sendMessage('again');
    await tick();
    // No second POST /conversations: the conversation is the unit of state, and starting a
    // fresh one per message would discard everything that makes a follow-up resolvable.
    http.expectOne(`${API}/api/v1/copilot/conversations/conv-1/messages`).flush({
      messageId: 'm2',
      turnId: 't2',
      conversationId: 'conv-1',
      stateVersion: 2,
      blocks: [],
    });
    await second;
  });

  it('sends the session secret as a header, never the conversation id alone', async () => {
    const pending = service.sendMessage('hello');
    await expectStart('top-secret');

    const request = http.expectOne(`${API}/api/v1/copilot/conversations/conv-1/messages`);
    expect(request.request.headers.get('X-Conversation-Secret')).toBe('top-secret');
    request.flush({
      messageId: 'm1',
      turnId: 't1',
      conversationId: 'conv-1',
      stateVersion: 1,
      blocks: [],
    });
    await pending;
  });

  it('sends a client message id so a retry is idempotent', async () => {
    const pending = service.sendMessage('hello');
    await expectStart();

    const request = http.expectOne(`${API}/api/v1/copilot/conversations/conv-1/messages`);
    expect(request.request.body.clientMessageId).toBeTruthy();
    request.flush({
      messageId: 'm1',
      turnId: 't1',
      conversationId: 'conv-1',
      stateVersion: 1,
      blocks: [],
    });
    await pending;
  });

  it('forwards the transient cart credential as a header, never message content', async () => {
    vi.spyOn(TestBed.inject(CartService), 'contextHeaders').mockResolvedValue({
      'X-Woo-Cart-Token': 'private-cart-token',
    });
    const pending = service.sendMessage('remove the black one');
    await expectStart();
    const request = http.expectOne(`${API}/api/v1/copilot/conversations/conv-1/messages`);
    expect(request.request.headers.get('X-Woo-Cart-Token')).toBe('private-cart-token');
    expect(JSON.stringify(request.request.body)).not.toContain('private-cart-token');
    request.flush({
      messageId: 'm1',
      turnId: 't1',
      conversationId: 'conv-1',
      stateVersion: 1,
      blocks: [],
    });
    await pending;
    expect(JSON.stringify(localStorage)).not.toContain('private-cart-token');
  });

  it('reports a card interaction with the secret header and survives a server error', async () => {
    const pending = service.sendMessage('hello');
    await expectStart('top-secret');
    http.expectOne(`${API}/api/v1/copilot/conversations/conv-1/messages`).flush({
      messageId: 'm1',
      turnId: 't1',
      conversationId: 'conv-1',
      stateVersion: 1,
      blocks: [],
    });
    await pending;

    const reported = service.recordInteraction('m1', 'card_open', 'p1', 2);
    await tick();
    const request = http.expectOne(`${API}/api/v1/copilot/conversations/conv-1/interactions`);
    expect(request.request.headers.get('X-Conversation-Secret')).toBe('top-secret');
    expect(request.request.body).toEqual({
      messageId: 'm1',
      kind: 'card_open',
      productId: 'p1',
      position: 2,
    });
    request.flush('nope', { status: 500, statusText: 'Server Error' });
    // Analytics must never surface an error to the shopper.
    await expect(reported).resolves.toBeUndefined();
  });

  it('sends no interaction before a conversation exists', async () => {
    await service.recordInteraction('m1', 'link_click');
    http.expectNone(`${API}/api/v1/copilot/conversations/conv-1/interactions`);
  });

  it('shares one conversation between concurrent first messages', async () => {
    const a = service.sendMessage('one');
    const b = service.sendMessage('two');

    // One start, not two — otherwise two messages sent in quick succession would land in
    // separate conversations and neither could refer to the other's results.
    await expectStart();

    http.match(`${API}/api/v1/copilot/conversations/conv-1/messages`).forEach((request, index) =>
      request.flush({
        messageId: `m${index}`,
        turnId: `t${index}`,
        conversationId: 'conv-1',
        stateVersion: index + 1,
        blocks: [],
      }),
    );

    await Promise.all([a, b]);
  });

  it('keeps each store session when another store on the same origin starts or clears chat', async () => {
    const first = service.ensureConversation();
    await expectStart('store-a-secret');
    await first;

    const storeB = 'https://shop.example/second-store';
    window.AIAssistantConfig = { route: '/widget', apiBaseUrl: API, storeUrl: storeB };
    const other = TestBed.runInInjectionContext(() => new CopilotService());
    expect(other.resumeStoredSession()).toBe(false);
    const second = other.ensureConversation();
    http.expectOne(`${API}/api/v1/copilot/conversations`).flush({
      conversationId: 'conv-b',
      sessionSecret: 'store-b-secret',
      stateVersion: 0,
    });
    await second;

    configureWindow();
    const restored = TestBed.runInInjectionContext(() => new CopilotService());
    expect(restored.resumeStoredSession()).toBe(true);
    expect(restored.activeConversationId).toBe('conv-1');
    restored.forgetStoredSession();
    window.AIAssistantConfig = { route: '/widget', apiBaseUrl: API, storeUrl: storeB };
    const restoredB = TestBed.runInInjectionContext(() => new CopilotService());
    expect(restoredB.resumeStoredSession()).toBe(true);
    expect(restoredB.activeConversationId).toBe('conv-b');
  });

  it('does not send a stored conversation secret to a different backend', async () => {
    const pending = service.ensureConversation();
    await expectStart();
    await pending;
    window.AIAssistantConfig = {
      route: '/widget',
      apiBaseUrl: 'https://other-api.example',
      storeUrl: STORE_URL,
    };
    const other = TestBed.runInInjectionContext(() => new CopilotService());
    expect(other.resumeStoredSession()).toBe(false);
    expect(other.activeConversationId).toBeNull();
  });

  it('preserves a streamed HTTP refusal and its backend message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: { message: 'Recharge this store before sending another turn.' },
          }),
          { status: 402, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const pending = service.streamMessage('hello').catch((error: unknown) => error);
    await expectStart();
    const error = await pending;
    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect(error).toMatchObject({
      status: 402,
      error: { detail: { message: 'Recharge this store before sending another turn.' } },
    });
  });

  it('keeps an SSE failure message and cancels the unfinished stream', async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"type":"turn.failed","turnId":"t1","data":{"code":"STORE_PAUSED","message":"The store is temporarily paused."}}\n\n',
                ),
              );
            },
            cancel,
          }),
        ),
      ),
    );
    const pending = service.streamMessage('hello').catch((error: unknown) => error);
    await expectStart();
    expect(await pending).toMatchObject({ message: 'The store is temporarily paused.' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('parses streamed deltas and reconciles the completed typed blocks', async () => {
    const encoder = new TextEncoder();
    const wire = [
      'event: turn.started\ndata: {"type":"turn.started","sequence":1,"turnId":"t1","data":{"conversationId":"conv-1","clientMessageId":"c1"}}\n\n',
      'event: assistant.delta\ndata: {"type":"assistant.delta","sequence":2,"turnId":"t1","data":{"delta":"Hello "}}\n\n',
      'event: assistant.delta\ndata: {"type":"assistant.delta","sequence":3,"turnId":"t1","data":{"delta":"there"}}\n\n',
      'event: turn.completed\ndata: {"type":"turn.completed","sequence":4,"turnId":"t1","data":{"messageId":"m1","conversationId":"conv-1","stateVersion":1,"blocks":[{"type":"text","text":"Hello there"}]}}\n\n',
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            wire.forEach((record) => controller.enqueue(encoder.encode(record)));
            controller.close();
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const deltas: string[] = [];

    const pending = service.streamMessage('hello', undefined, (event) => {
      if (event.type === 'assistant.delta') {
        deltas.push(event.data.delta);
      }
    });
    await expectStart();
    const response = await pending;

    expect(deltas.join('')).toBe('Hello there');
    expect(response.blocks).toEqual([{ type: 'text', text: 'Hello there' }]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain('/messages/stream');
  });

  it('accepts turn.completed without waiting for the connection to close', async () => {
    let close!: () => void;
    const cancel = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"type":"turn.completed","sequence":1,"turnId":"t1","data":{"messageId":"m1","conversationId":"conv-1","stateVersion":1,"blocks":[]}}\n\n',
                ),
              );
              close = () => controller.close();
            },
            cancel,
          }),
        ),
      ),
    );
    const pending = service.streamMessage('Laptops under 60000');
    await expectStart();
    const outcome = await Promise.race([
      pending,
      new Promise((resolve) => setTimeout(() => resolve('still waiting for EOF'), 50)),
    ]);
    if (!cancel.mock.calls.length) close();
    await pending;
    expect(outcome).toMatchObject({ messageId: 'm1' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('ignores broken data after the terminal completion event', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            'data: {"type":"turn.completed","sequence":1,"turnId":"t1","data":{"messageId":"m1","conversationId":"conv-1","stateVersion":1,"blocks":[]}}\n\n' +
              'data: incomplete proxy trailer\n\n',
          ),
        ),
    );
    const pending = service.streamMessage('Laptops under 60000');
    await expectStart();
    await expect(pending).resolves.toMatchObject({ messageId: 'm1' });
  });

  it('does not read a socket error or await stalled cleanup after completion', async () => {
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            'data: {"type":"turn.completed","sequence":1,"turnId":"t1","data":{"messageId":"m1","conversationId":"conv-1","stateVersion":1,"blocks":[]}}\n\n',
          ),
        })
        .mockRejectedValue(new TypeError('connection reset')),
      cancel: vi.fn().mockReturnValue(new Promise(() => {})),
      releaseLock: vi.fn(),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: { getReader: () => reader },
      }),
    );
    const pending = service.streamMessage('Laptops under 60000');
    await expectStart();
    await expect(pending).resolves.toMatchObject({ messageId: 'm1' });
    expect(reader.read).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
  });

  it.each(['eof', 'network', 'invalid_event'])(
    'recovers the exact saved answer with a GET after %s, without another POST',
    async (failure) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const fetchMock =
        failure === 'network'
          ? vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
          : vi
              .fn()
              .mockResolvedValue(
                new Response(
                  failure === 'eof'
                    ? 'data: {"type":"assistant.delta","turnId":"t1","data":{"delta":"Partial answer"}}\n\n'
                    : 'data: {broken JSON\n\n',
                ),
              );
      vi.stubGlobal('fetch', fetchMock);
      const pending = service.streamMessage('Laptops under 60000');
      await expectStart('secret-for-original-conversation');
      const recovery = http.expectOne((request) => request.url.endsWith('/messages/result'));
      const sent = JSON.parse(fetchMock.mock.calls[0][1]?.body ?? '{}');
      expect(recovery.request.method).toBe('GET');
      expect(recovery.request.params.get('clientMessageId')).toBe(sent.clientMessageId);
      expect(recovery.request.headers.get('X-Conversation-Secret')).toBe(
        'secret-for-original-conversation',
      );
      recovery.flush({
        messageId: 'saved-answer',
        blocks: [{ type: 'text', text: 'Four laptops.' }],
      });
      await expect(pending).resolves.toMatchObject({ messageId: 'saved-answer' });
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it('waits briefly for an answer to commit and never substitutes a different message', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('')));
    const pending = service.streamMessage('Laptops under 60000');
    await expectStart();
    const first = http.expectOne((request) => request.url.endsWith('/messages/result'));
    const clientMessageId = first.request.params.get('clientMessageId');
    first.flush(null);
    await new Promise((resolve) => setTimeout(resolve, 270));
    const second = http.expectOne((request) => request.url.endsWith('/messages/result'));
    expect(second.request.params.get('clientMessageId')).toBe(clientMessageId);
    second.flush({ messageId: 'saved-answer', blocks: [] });
    await expect(pending).resolves.toMatchObject({ messageId: 'saved-answer' });
  });

  it('reports an interrupted connection if no saved answer exists after bounded recovery', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('')));
    const pending = service.streamMessage('Laptops under 60000').catch((error: unknown) => error);
    await expectStart();
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 270));
      http.expectOne((request) => request.url.endsWith('/messages/result')).flush(null);
    }
    expect(await pending).toMatchObject({
      message: 'The connection was interrupted before the answer arrived. Please try again.',
    });
  });

  it('preserves a UI callback exception instead of hiding it with a recovered answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            'data: {"type":"assistant.delta","turnId":"t1","data":{"delta":"Four laptops"}}\n\n',
          ),
        ),
    );
    const bug = new TypeError('renderer bug');
    const pending = service
      .streamMessage('hello', undefined, () => {
        throw bug;
      })
      .catch((error: unknown) => error);
    await expectStart();
    expect(await pending).toBe(bug);
  });

  it('frames CRLF and UTF-8 currency split across individual byte chunks', async () => {
    const wire = new TextEncoder().encode(
      'data: {"type":"assistant.delta","turnId":"t1","data":{"delta":"₹49,999"}}\r\n\r\n' +
        'data: {"type":"turn.completed","turnId":"t1","data":{"messageId":"m1","conversationId":"conv-1","stateVersion":1,"blocks":[{"type":"text","text":"₹49,999"}]}}',
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              for (const byte of wire) controller.enqueue(Uint8Array.of(byte));
              controller.close();
            },
          }),
        ),
      ),
    );
    const deltas: string[] = [];
    const pending = service.streamMessage('hello', undefined, (event) => {
      if (event.type === 'assistant.delta') deltas.push(event.data.delta);
    });
    await expectStart();
    await expect(pending).resolves.toMatchObject({ blocks: [{ type: 'text', text: '₹49,999' }] });
    expect(deltas).toEqual(['₹49,999']);
  });

  it.each([
    ['https://dev.ngrok-free.app', 'true'],
    ['https://dev.ngrok.io', 'true'],
    ['https://dev.ngrok.io.evil.test', undefined],
    [API, undefined],
  ])('uses the ngrok bypass header for fetch only on ngrok hosts: %s', async (baseUrl, bypass) => {
    window.AIAssistantConfig!.apiBaseUrl = baseUrl;
    service = TestBed.runInInjectionContext(() => new CopilotService());
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          'data: {"type":"turn.completed","turnId":"t1","data":{"messageId":"m1","conversationId":"conv-1","stateVersion":1,"blocks":[]}}\n\n',
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const pending = service.streamMessage('hello');
    http
      .expectOne(`${baseUrl}/api/v1/copilot/conversations`)
      .flush({ conversationId: 'conv-1', sessionSecret: 'secret', stateVersion: 0 });
    await pending;
    expect(fetchMock.mock.calls[0][1].headers['ngrok-skip-browser-warning']).toBe(bypass);
  });

  // -------------------------------------------------------------------------
  // Block mapping — the discriminated union onto the shapes the panels render
  // -------------------------------------------------------------------------

  const card = (id: string, priceIsLive = false) => ({
    productId: id,
    name: `Product ${id}`,
    price: '19.99',
    currency: 'USD',
    stockStatus: 'instock',
    imageSrc: 'https://img/1.png',
    permalink: 'https://shop/1',
    priceIsLive,
    badges: ['Top rated'],
  });

  it('collects products from carousel, grid and comparison blocks without duplicating', () => {
    const blocks: CopilotBlock[] = [
      { type: 'product_grid', items: [card('a'), card('b')] },
      // 'a' again: a product can legitimately appear in both a grid and a comparison, and
      // the panel shows a list of products rather than a list of mentions.
      { type: 'comparison', products: [card('a'), card('c')], rows: [] },
    ];

    expect(service.productsFromBlocks(blocks).map((p) => p.productId)).toEqual(['a', 'b', 'c']);
  });

  it('reads the comparison products separately for the comparison panel', () => {
    const blocks: CopilotBlock[] = [
      { type: 'product_grid', items: [card('a')] },
      { type: 'comparison', products: [card('b'), card('c')], rows: [] },
    ];

    expect(service.comparisonFromBlocks(blocks)?.products.map((p) => p.productId)).toEqual([
      'b',
      'c',
    ]);
  });

  it('keeps the comparison rows, which are what the table is actually made of', () => {
    // The rows are the merchant's own comparison axes, resolved server-side from their
    // catalog. Dropping them here is what forced the panel to invent a fixed row list.
    const blocks: CopilotBlock[] = [
      {
        type: 'comparison',
        products: [card('b'), card('c')],
        rows: [
          { field: 'price', label: 'Price', values: ['499', '899'], isLive: true },
          { field: 'ram', label: 'RAM', values: ['8 GB', null], isLive: false },
        ],
      },
    ];

    expect(service.comparisonFromBlocks(blocks)?.rows).toEqual([
      { field: 'price', label: 'Price', values: ['499', '899'], isLive: true },
      // null survives as null — it is "the store listed nothing", which the table renders
      // as such rather than as a blank cell.
      { field: 'ram', label: 'RAM', values: ['8 GB', null], isLive: false },
    ]);
  });

  it('drops a row whose values do not line up with the columns', () => {
    // Rows are positional. A mismatched row cannot be repaired by guessing which cell
    // belongs to which product, and rendering it one cell out of step would attach one
    // product's value to another.
    const blocks: CopilotBlock[] = [
      {
        type: 'comparison',
        products: [card('b'), card('c')],
        rows: [
          { field: 'price', label: 'Price', values: ['499'], isLive: false },
          { field: 'sku', label: 'SKU', values: ['B-1', 'C-1'], isLive: false },
        ],
      },
    ];

    expect(service.comparisonFromBlocks(blocks)?.rows.map((row) => row.field)).toEqual(['sku']);
  });

  it('carries the grounded rationale, brand and sale price onto the product', () => {
    const [product] = service.productsFromBlocks([
      {
        type: 'product_carousel',
        items: [
          {
            ...card('a'),
            price: '3916',
            regularPrice: '4895',
            brand: 'Nike',
            rationale: 'Breathable mesh upper, rated 4.4.',
          },
        ],
      },
    ]);

    expect(product.reason).toBe('Breathable mesh upper, rated 4.4.');
    expect(product.brand).toBe('Nike');
    expect(product.regularPrice).toBe(4895);
  });

  it('reads chips and clarification options as sendable suggestions, without repeats', () => {
    const suggestions = service.suggestionsFromBlocks([
      {
        type: 'refinement_chips',
        items: [
          {
            label: 'Under 3,000',
            field: 'price',
            operator: 'lte',
            value: 3000,
            message: 'shoes under 3000',
          },
          { label: 'Compare the top two', field: 'compare', operator: 'first', value: 2 },
          {
            label: 'Same again',
            field: 'price',
            operator: 'lte',
            value: 3000,
            message: 'shoes under 3000',
          },
        ],
      },
      {
        type: 'clarification',
        question: 'For whom?',
        options: [{ label: 'Men', value: 'for men' }],
      },
    ]);

    expect(suggestions).toEqual([
      { label: 'Under 3,000', message: 'shoes under 3000' },
      // No message: the label is itself a readable request.
      { label: 'Compare the top two', message: 'Compare the top two' },
      { label: 'Men', message: 'for men' },
    ]);
  });

  it('reads a store overview grid into category tiles', () => {
    const [laptops] = service.categoriesFromBlocks([
      { type: 'text', text: 'This store has 93 products across 18 categories.' },
      {
        type: 'category_grid',
        totalCategories: 18,
        items: [
          {
            sourceCategoryId: 32,
            name: 'Laptops',
            productCount: 10,
            priceFrom: '49999.0000',
            currency: '₹',
            imageSrc: 'https://img/laptop.jpg',
            subcategories: [],
            message: 'Show me Laptops',
          },
        ],
      },
    ]);

    expect(laptops).toEqual({
      id: 32,
      name: 'Laptops',
      productCount: 10,
      priceFrom: 49999,
      currency: '₹',
      imageUrl: 'https://img/laptop.jpg',
      subcategories: [],
      message: 'Show me Laptops',
    });
    expect(service.categoriesFromBlocks([{ type: 'text', text: 'hi' }])).toEqual([]);
  });

  it('has no comparison when the answer had no comparison block', () => {
    expect(service.comparisonFromBlocks([{ type: 'text', text: 'hi' }])).toBeNull();
  });

  it('keeps notices and clarifications in the visible text so a warning is never dropped', () => {
    const blocks: CopilotBlock[] = [
      { type: 'text', text: 'Here are three options.' },
      { type: 'notice', level: 'warning', text: "I couldn't verify live pricing." },
      { type: 'clarification', question: 'Which size?', options: [] },
    ];

    const text = service.textFromBlocks(blocks);
    expect(text).toContain('Here are three options.');
    expect(text).toContain("I couldn't verify live pricing.");
    expect(text).toContain('Which size?');
  });

  it('marks a catalog price unverified and a live-checked one verified', () => {
    const [catalogPriced] = service.productsFromBlocks([
      { type: 'product_grid', items: [card('a', false)] },
    ]);
    const [livePriced] = service.productsFromBlocks([
      { type: 'product_grid', items: [card('b', true)] },
    ]);

    // The panel renders a "verified" badge off this. Claiming a catalog price was checked
    // against the store is the exact misstatement priceIsLive exists to prevent.
    expect(catalogPriced.price.verified).toBe(false);
    expect(catalogPriced.stock.verified).toBe(false);
    expect(livePriced.price.verified).toBe(true);
  });

  it('parses the price string the backend sends without losing the value', () => {
    const [product] = service.productsFromBlocks([{ type: 'product_grid', items: [card('a')] }]);
    expect(product.price.current).toBe(19.99);
    expect(product.price.currency).toBe('USD');
  });

  it.each([null, undefined, '', '   ', 'not a price', 'NaN', 'Infinity', '-1'])(
    'preserves a missing or invalid price (%s) as unknown even after a live lookup',
    (price) => {
      const [product] = service.productsFromBlocks([
        { type: 'product_grid', items: [{ ...card('a', true), price }] },
      ]);

      expect(product.price.current).toBeNull();
      expect(product.price.verified).toBe(false);
    },
  );

  it('preserves a genuinely listed zero price', () => {
    const [product] = service.productsFromBlocks([
      { type: 'product_grid', items: [{ ...card('a', true), price: '0.00' }] },
    ]);

    expect(product.price.current).toBe(0);
    expect(product.price.verified).toBe(true);
  });

  it.each([null, undefined, '', 'discontinued'])(
    'preserves unknown availability (%s) rather than advertising stock',
    (stockStatus) => {
      const [product] = service.productsFromBlocks([
        { type: 'product_grid', items: [{ ...card('a', true), stockStatus, stockIsLive: true }] },
      ]);

      expect(product.stock).toEqual({ status: 'unknown', verified: false });
    },
  );

  it.each(['instock', 'outofstock', 'onbackorder'])(
    'preserves the distinct store availability %s',
    (stockStatus) => {
      const [product] = service.productsFromBlocks([
        { type: 'product_grid', items: [{ ...card('a'), stockStatus, stockIsLive: true }] },
      ]);

      expect(product.stock).toEqual({ status: stockStatus, verified: true });
      expect(product.price.verified).toBe(false);
    },
  );

  it.each([false, undefined])(
    'does not infer verified availability from a live price (%s)',
    (stockIsLive) => {
      const [product] = service.productsFromBlocks([
        { type: 'product_grid', items: [{ ...card('a', true), stockIsLive }] },
      ]);

      expect(product.price.verified).toBe(true);
      expect(product.stock.verified).toBe(false);
    },
  );

  it('uses the same unknown-value rules for comparison product cards', () => {
    const result = service.comparisonFromBlocks([
      {
        type: 'comparison',
        products: [{ ...card('a', true), price: null, stockStatus: null }],
        rows: [],
      },
    ]);

    expect(result?.products[0].price.current).toBeNull();
    expect(result?.products[0].stock.status).toBe('unknown');
  });
});

/**
 * Its own suite because it needs a TestBed built with no AIAssistantConfig at all —
 * resetting the module mid-suite would leave every later test without the HTTP mock it
 * had already injected.
 */
describe('CopilotService shopper proof', () => {
  const TOKEN_URL =
    'https://shop.example/wp-admin/admin-ajax.php?action=ai_assistant_shopper_token';
  let service: CopilotService;
  let http: HttpTestingController;
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    window.localStorage.clear();
    window.AIAssistantConfig = {
      route: '/widget',
      apiBaseUrl: API,
      storeUrl: STORE_URL,
      shopperTokenUrl: TOKEN_URL,
    };
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CopilotService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    window.localStorage.clear();
    http.verify();
    delete (window as { AIAssistantConfig?: unknown }).AIAssistantConfig;
  });

  async function startAndAnswer(
    token: { token: string | null; expiresAt?: number } | 'error',
  ): Promise<void> {
    const pending = service.sendMessage('where is my order');
    await tick();
    http
      .expectOne(`${API}/api/v1/copilot/conversations`)
      .flush({ conversationId: 'conv-1', sessionSecret: 's3', stateVersion: 0 });
    await tick();
    const probe = http.expectOne(TOKEN_URL);
    expect(probe.request.withCredentials).toBe(true);
    if (token === 'error') {
      probe.flush('nope', { status: 500, statusText: 'Server Error' });
    } else {
      probe.flush(token);
    }
    await tick();
    const message = http.expectOne(`${API}/api/v1/copilot/conversations/conv-1/messages`);
    startAndAnswer.lastRequest = message.request;
    message.flush({
      messageId: 'm1',
      turnId: 't1',
      conversationId: 'conv-1',
      stateVersion: 1,
      blocks: [],
    });
    await pending;
  }
  startAndAnswer.lastRequest = null as unknown as HttpRequest<unknown>;

  it('sends the store-issued proof with the shopper message', async () => {
    await startAndAnswer({ token: 'v1.abc.def', expiresAt: Math.floor(Date.now() / 1000) + 7200 });
    expect(startAndAnswer.lastRequest.headers.get('X-Shopper-Token')).toBe('v1.abc.def');
    expect(startAndAnswer.lastRequest.headers.get('X-Conversation-Secret')).toBe('s3');
  });

  it('chats as a guest when the visitor is not logged in', async () => {
    await startAndAnswer({ token: null });
    expect(startAndAnswer.lastRequest.headers.has('X-Shopper-Token')).toBe(false);
  });

  it('chats as a guest, never failing, when the store endpoint errors', async () => {
    await startAndAnswer('error');
    expect(startAndAnswer.lastRequest.headers.has('X-Shopper-Token')).toBe(false);
  });

  it('does not ask the store again for every message', async () => {
    await startAndAnswer({ token: 'v1.abc.def', expiresAt: Math.floor(Date.now() / 1000) + 7200 });
    const second = service.sendMessage('and the one before?');
    await tick();
    http.expectNone(TOKEN_URL);
    const request = http.expectOne(`${API}/api/v1/copilot/conversations/conv-1/messages`);
    expect(request.request.headers.get('X-Shopper-Token')).toBe('v1.abc.def');
    request.flush({
      messageId: 'm2',
      turnId: 't2',
      conversationId: 'conv-1',
      stateVersion: 2,
      blocks: [],
    });
    await second;
  });
});

describe('CopilotService without a store url', () => {
  beforeEach(() => {
    delete (window as { AIAssistantConfig?: unknown }).AIAssistantConfig;
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('reports itself unconfigured so the widget can fall back instead of failing on send', () => {
    expect(TestBed.inject(CopilotService).isConfigured).toBe(false);
  });
});

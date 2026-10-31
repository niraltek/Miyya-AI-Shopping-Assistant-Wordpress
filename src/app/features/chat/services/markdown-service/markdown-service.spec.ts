import { TestBed } from '@angular/core/testing';
import { MarkdownService } from './markdown-service';

describe('MarkdownService', () => {
  let service: MarkdownService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MarkdownService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('renders assistant markdown and sanitizes embedded executable HTML', () => {
    const html = service.render(
      '**Available** <script>alert(1)</script><img src=x onerror="alert(2)">',
    );

    expect(html).toContain('<strong>Available</strong>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert(1)');
  });

  it('renders an unfinished streaming code fence as a complete code block', () => {
    const html = service.renderStreaming('```js\nconst count = 1;');

    expect(html).toContain('<pre>');
    expect(html).toContain('<code');
    expect(html).toContain('count');
    expect(html).toContain('</code></pre>');
  });

  it('counts final and streaming renders through the same readonly signal', () => {
    expect(service.renderCount()).toBe(0);

    service.render('first');
    expect(service.renderCount()).toBe(1);
    service.renderStreaming('second');
    expect(service.renderCount()).toBe(2);
    expect(service.render('   ')).toBe('');
    expect(service.renderCount()).toBe(3);
  });
});

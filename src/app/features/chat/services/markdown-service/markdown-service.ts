import { Service, signal } from '@angular/core';
import { Product } from '../../models/product';
import { renderMarkdown, renderStreamingMarkdown } from '../../utils/markdown';

@Service()
export class MarkdownService {
  private readonly renders = signal(0);
  readonly renderCount = this.renders.asReadonly();

  render(text: string, products: readonly Product[] = []): string {
    this.renders.update((count) => count + 1);
    return renderMarkdown(text, products);
  }

  renderStreaming(text: string): string {
    this.renders.update((count) => count + 1);
    return renderStreamingMarkdown(text);
  }
}

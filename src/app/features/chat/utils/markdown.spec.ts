import { describe, expect, it } from 'vitest';

import { Product } from '../models/product';
import { renderMarkdown, renderStreamingMarkdown } from './markdown';

/**
 * The composer is told to name a product rather than print its address
 * (`prompts/composer/v6.txt`); the product-linking tests below are the half that makes a
 * name useful. Everything they assert is driven by the answer's own grounded products, so
 * no test here names a rule the code could not have reached from the catalog it was given.
 */

function product(overrides: Partial<Product>): Product {
  return {
    productId: 'p1',
    name: 'Running T-Shirt',
    brand: 'Nike',
    category: 'Clothing',
    description: '',
    price: { current: 1299, currency: 'INR', verified: true },
    stock: { status: 'instock', verified: true },
    imageUrl: '',
    productUrl: 'https://test.example/product/running-t-shirt/',
    attributes: {},
    reason: '',
    match: { score: 1 },
    averageRating: null,
    ...overrides,
  };
}

describe('renderMarkdown', () => {
  it('renders the formatting a composer answer actually contains', () => {
    // The bug this whole module exists for: the bubble rendered `**Nike Air Max**` verbatim,
    // so shoppers read the asterisks.
    const html = renderMarkdown('**Nike Air Max** is in stock.\n\n- Size 9\n- Size 10');

    expect(html).toContain('<strong>Nike Air Max</strong>');
    expect(html).toContain('<li>Size 9</li>');
    expect(html).not.toContain('**');
  });

  it('treats a single newline as a line break', () => {
    // Chat answers are typed the way people type, not authored the way documents are.
    expect(renderMarkdown('First line\nSecond line')).toContain('<br>');
  });

  it('strips a script tag rather than trusting the model', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> there');

    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('strips an event handler smuggled through inline HTML', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');

    expect(html).not.toContain('onerror');
  });

  it('strips a javascript: link', () => {
    const html = renderMarkdown('[click me](javascript:alert(1))');

    expect(html).not.toContain('javascript:');
  });

  it('opens links in a new tab, safely', () => {
    // The widget renders in an iframe ON the merchant's storefront, so a link that opened
    // in the frame would replace the chat with a product page.
    const html = renderMarkdown('[the shoe](https://store.example/product/1)');

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('returns an empty string for blank text, not an empty paragraph', () => {
    expect(renderMarkdown('   ')).toBe('');
  });

  it('drops a bullet that is nothing but a web address', () => {
    const html = renderMarkdown(
      [
        '- Running T-Shirt',
        '  - Price: 1299',
        '  - Link: https://test.example/product/running-t-shirt/',
      ].join('\n'),
      [product({})],
    );

    expect(html).not.toContain('https://test.example/product/running-t-shirt/</a>');
    expect(html).not.toContain('Link:');
    // The rest of the answer is untouched.
    expect(html).toContain('Price: 1299');
  });

  it('keeps an address that is part of something the shopper is being told', () => {
    const html = renderMarkdown(
      '- Read the size guide at https://test.example/size-guide/ first',
      [],
    );

    expect(html).toContain('https://test.example/size-guide/');
  });

  it('turns a product the answer names into a link to that product', () => {
    const html = renderMarkdown('The Running T-Shirt is the lighter of the two.', [product({})]);

    expect(html).toContain('href="https://test.example/product/running-t-shirt/"');
    expect(html).toContain('aa-product-link');
    expect(html).toContain('>Running T-Shirt</a>');
    // It leaves the frame it renders in, which sits on the merchant's own storefront.
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('links the more specific product when two names overlap', () => {
    const html = renderMarkdown('The Running T-Shirt is cheaper.', [
      product({}),
      product({
        productId: 'p2',
        name: 'T-Shirt',
        productUrl: 'https://test.example/product/t-shirt/',
      }),
    ]);

    expect(html).toContain('>Running T-Shirt</a>');
    expect(html).not.toContain('https://test.example/product/t-shirt/');
  });

  it('does not link a name that only appears inside a longer word', () => {
    const html = renderMarkdown('Batman merchandise is not in stock.', [
      product({ productId: 'p3', name: 'Bat', productUrl: 'https://test.example/product/bat/' }),
    ]);

    expect(html).not.toContain('aa-product-link');
    expect(html).toContain('Batman merchandise');
  });

  it('never links a product whose address is not http(s)', () => {
    const html = renderMarkdown('The Running T-Shirt is nice.', [
      // eslint-disable-next-line no-script-url
      product({ productUrl: 'javascript:alert(1)' }),
    ]);

    expect(html).not.toContain('aa-product-link');
    expect(html).not.toContain('javascript:');
  });

  it('leaves text alone when the answer grounded no products', () => {
    const html = renderMarkdown('I could not find anything matching that.', []);

    expect(html).toContain('I could not find anything matching that.');
    expect(html).not.toContain('aa-product-link');
  });

  it('does not link a name inside a code span, which is being shown verbatim', () => {
    const html = renderMarkdown('The SKU is `Running T-Shirt`.', [product({})]);

    expect(html).toContain('<code>Running T-Shirt</code>');
    expect(html).not.toContain('aa-product-link');
  });

  it('bolds and links a product name the composer emphasised', () => {
    // v7 asks the composer to bold the name; the link is added inside that emphasis, so the
    // shopper gets one word that is both the subject of the sentence and the way in.
    const html = renderMarkdown('**Running T-Shirt** is the lighter one.', [product({})]);

    expect(html).toContain('<strong>');
    expect(html).toContain('aa-product-link');
    expect(html).toContain('>Running T-Shirt</a>');
  });

  it('boxes a rating so it reads as a rating', () => {
    const html = renderMarkdown('The better reviewed one is at ★ 4.3.', []);

    expect(html).toContain('class="aa-rating"');
    // The value is shown exactly as written - never re-rounded in the presentation layer.
    expect(html).toContain('★ 4.3');
  });

  it('leaves a star inside a code span alone', () => {
    const html = renderMarkdown('The SKU is `★ 4.3`.', []);

    expect(html).not.toContain('aa-rating');
  });

  it('drops a Link line written inside a paragraph, not just as a bullet', () => {
    // The shape that survived the first pass: the address is on its own line without being
    // a list item, so there is no <li> to remove.
    const html = renderMarkdown(
      'The Running T-Shirt is lighter.\nLink: https://test.example/product/running-t-shirt/',
      [product({})],
    );

    expect(html).not.toContain('Link:');
    expect(html).toContain('is lighter');
  });

  it('drops a paragraph that is only an address', () => {
    const html = renderMarkdown('Have a look.\n\nhttps://test.example/product/running-t-shirt/', [
      product({}),
    ]);

    expect(html).toContain('Have a look.');
    expect(html).not.toContain('>https://test.example/product/running-t-shirt/</a>');
  });

  it('drops a politely named link that only repeats a card', () => {
    const html = renderMarkdown(
      'It is lighter.\n[View product](https://test.example/product/running-t-shirt/)',
      [product({})],
    );

    expect(html).not.toContain('View product');
    expect(html).toContain('It is lighter.');
  });

  it('keeps a named link to something the answer is not already showing', () => {
    const html = renderMarkdown('[Size guide](https://test.example/size-guide/) may help.', [
      product({}),
    ]);

    expect(html).toContain('Size guide');
    expect(html).toContain('https://test.example/size-guide/');
  });

  it('leaves no empty line where a removed address used to be', () => {
    const html = renderMarkdown(
      'First line\nLink: https://test.example/product/running-t-shirt/\nLast line',
      [product({})],
    );

    expect(html).not.toContain('<br><br>');
    expect(html).toContain('First line');
    expect(html).toContain('Last line');
  });
});

describe('markdown feature coverage', () => {
  it.each([
    ['heading', '## Picks', '<h2>Picks</h2>'],
    ['bold', 'a **bold** word', '<strong>bold</strong>'],
    ['italic', 'a *slanted* word', '<em>slanted</em>'],
    ['unordered list', '- one\n- two', '<li>one</li>'],
    ['ordered list', '1. first\n2. second', '<ol>'],
    ['blockquote', '> quoted', '<blockquote>'],
    ['inline code', 'run `npm ci` now', '<code>npm ci</code>'],
    ['horizontal rule', 'a\n\n---\n\nb', '<hr>'],
  ])('renders %s', (_label, source, expected) => {
    expect(renderMarkdown(source)).toContain(expected);
  });

  it('renders a GFM table', () => {
    const html = renderMarkdown('| Size | Fit |\n| --- | --- |\n| M | Regular |');

    expect(html).toContain('<table>');
    expect(html).toContain('<th>Size</th>');
    expect(html).toContain('<td>Regular</td>');
  });

  it('treats a single newline as a line break', () => {
    expect(renderMarkdown('first\nsecond')).toContain('<br>');
  });

  it('highlights a fenced code block with a known language', () => {
    const html = renderMarkdown('```js\nconst total = 1;\n```');

    expect(html).toContain('<pre>');
    expect(html).toContain('language-js');
    // highlight.js marks `const` as a keyword; the class surviving the sanitizer is the
    // whole point of allowing `class` at all.
    expect(html).toContain('hljs-keyword');
  });

  it('resolves a language alias to its grammar', () => {
    expect(renderMarkdown('```sh\nnpm ci\n```')).toContain('hljs');
  });

  it('still renders a code block whose language nothing registers', () => {
    const html = renderMarkdown('```brainfuck\n+++++\n```');

    expect(html).toContain('<pre>');
    expect(html).toContain('+++++');
  });

  it('escapes code content rather than executing it', () => {
    const html = renderMarkdown('```js\nconst x = "<img src=x onerror=alert(1)>";\n```');

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('never trusting model HTML', () => {
  it('strips raw HTML the model wrote', () => {
    const html = renderMarkdown('<script>alert(1)</script><b>bold</b>');

    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('drops an event handler smuggled onto an allowed tag', () => {
    expect(renderMarkdown('<a href="#" onclick="steal()">tap</a>')).not.toContain('onclick');
  });

  it('refuses a javascript: link', () => {
    expect(renderMarkdown('[tap](javascript:alert(1))')).not.toContain('javascript:');
  });

  it('keeps only classes highlight.js could have produced', () => {
    // `class` has to be allowed for highlighting to survive, which would otherwise hand a
    // model Tailwind utilities - `fixed inset-0 z-50` over a merchant's storefront.
    const html = renderMarkdown('<span class="fixed inset-0 z-50 bg-black">x</span>');

    expect(html).not.toContain('fixed');
    expect(html).not.toContain('inset-0');
  });

  it('opens every link in a new tab, unable to reach back', () => {
    const html = renderMarkdown('[shop](https://test.example/shop/)');

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe('streaming render', () => {
  it('renders complete markdown that has already arrived', () => {
    expect(renderStreamingMarkdown('## Picks\n\n- Nike')).toContain('<h2>Picks</h2>');
  });

  it('leaves an unclosed emphasis as the characters the shopper is watching', () => {
    const html = renderStreamingMarkdown('**Nike');

    expect(html).toContain('**Nike');
    expect(html).not.toContain('<strong>');
  });

  it('closes a fence the model has opened but not finished', () => {
    const html = renderStreamingMarkdown('Run:\n\n```bash\nnpm install');

    // Without the synthetic close, everything after ``` becomes one code block and the
    // paragraph above it disappears into the box.
    expect(html).toContain('<p>Run:</p>');
    expect(html).toContain('<pre>');
    expect(html).toContain('npm install');
  });

  it('does not close a fence that is already balanced', () => {
    const html = renderStreamingMarkdown('```js\nconst a = 1;\n```\n\nDone.');

    expect(html).toContain('<p>Done.</p>');
  });

  it('ignores backticks that are not at the start of a line', () => {
    expect(renderStreamingMarkdown('use ``` carefully')).toContain('use');
  });

  it('sanitizes mid-stream too', () => {
    expect(renderStreamingMarkdown('<script>alert(1)</script>hi')).not.toContain('<script');
  });

  it('is empty for an empty delta', () => {
    expect(renderStreamingMarkdown('   ')).toBe('');
  });
});

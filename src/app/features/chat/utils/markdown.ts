import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';

import { Product } from '../models/product';

/**
 * Languages are registered one by one against `highlight.js/lib/core`, NOT imported from
 * `highlight.js`, whose barrel pulls in all 190+ grammars - about a megabyte before
 * compression, shipped into a chat widget that is injected into every page of a merchant's
 * storefront. These twelve cover what a commerce assistant is ever asked to print; an
 * unregistered language is not an error, it renders as a plain code block (see
 * `HIGHLIGHT_LANGUAGE` below).
 */
const LANGUAGES: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash,
  css,
  javascript,
  json,
  markdown,
  php,
  python,
  sql,
  typescript,
  xml,
  yaml,
};

for (const [name, language] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, language);
}

/** `js` -> `javascript`, `sh` -> `bash`, `html` -> `xml`, and so on. */
const ALIASES: Record<string, string> = {
  html: 'xml',
  js: 'javascript',
  jsx: 'javascript',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  tsx: 'typescript',
  yml: 'yaml',
  md: 'markdown',
};

function resolveLanguage(info: string): string | null {
  // A fence's info string can carry more than a language (```ts twoslash). Only the first
  // word names the grammar.
  const first = (info || '').trim().split(/\s+/)[0].toLowerCase();
  const name = ALIASES[first] ?? first;
  return name && hljs.getLanguage(name) ? name : null;
}

/**
 * One configured parser for the whole app, built once at module load.
 *
 * A `Marked` INSTANCE rather than the global `marked` singleton: the global is shared
 * process-wide, so configuring it here would reach into anything else that imports marked
 * - including a future consumer that wants different options - and two callers setting
 * options would silently fight.
 *
 * `markedHighlight` runs highlight.js over every fenced block BEFORE the HTML reaches
 * DOMPurify, which is the required order: highlighting produces markup, and markup from
 * this pipeline is untrusted like everything else in it.
 */
const parser = new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code: string, info: string): string {
      const language = resolveLanguage(info);
      if (!language) {
        // No grammar for it. Returning the code unchanged lets marked escape it as usual -
        // highlighting is decoration, and a language nobody registered must not cost the
        // shopper the code block itself.
        return code;
      }
      try {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value;
      } catch {
        return code;
      }
    },
  }),
  {
    // A single newline is a line break. Chat answers are written the way people type, not
    // the way documents are authored, and CommonMark's "two spaces or it never happened"
    // rule turns a deliberately broken-up answer into one run-on paragraph.
    breaks: true,
    gfm: true,
    async: false,
  },
);

/**
 * Renders an assistant answer's markdown to sanitized HTML, with the products it mentions
 * turned into links.
 *
 * **Why this exists:** the composer writes markdown. Its prompt explicitly allows headings
 * and bullet lists when walking through a comparison (`prompts/composer/v1.txt`), and a
 * model emits `**bold**` for product names whatever the prompt says. The bubble used to
 * render that text verbatim, so a shopper read the asterisks.
 *
 * **Called once per finished message, never per change detection.** The result is stored on
 * the `ChatMessage`, because parsing markdown inside a template expression would re-parse
 * every answer in the transcript on every render.
 *
 * **Only completed text is passed here.** A half-streamed answer has unbalanced syntax — an
 * unclosed `**`, a list item that is still one dash — and re-parsing it per token flickers
 * as the tree reinterprets itself (markedjs/marked#3657). The stream renders as plain text
 * and this runs at `turn.completed`, which is exactly when the SSE contract hands over the
 * final reconciled blocks — and also the first moment the product list is known, which the
 * linking below needs.
 *
 * **Sanitized twice, deliberately.** DOMPurify runs here, and Angular's own sanitizer runs
 * again on `[innerHTML]` — this text originates from a language model quoting a merchant's
 * own catalog, so neither pass is the place to save a few microseconds. Nothing bypasses
 * Angular security; `bypassSecurityTrustHtml` is intentionally not used.
 */

/**
 * Product links point at the merchant's own storefront, and the widget renders inside an
 * iframe ON that storefront — a link opening in the frame would replace the chat with a
 * product page and lose the conversation. `rel` goes with it: `noopener` is what stops the
 * opened tab reaching back through `window.opener`.
 *
 * Registered once at module load rather than per call, because DOMPurify hooks are global
 * and adding one per render would stack them.
 */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }

  // `class` has to be allowed at all so highlight.js's spans survive sanitizing, and an
  // open `class` attribute is a real hole: the answer is written by a language model, and a
  // model that emitted `class="fixed inset-0 z-50"` would be handed Tailwind utilities that
  // cover the merchant's storefront. So every class is dropped unless highlight.js could
  // have produced it - `hljs`, `hljs-*`, or the `language-*` marker marked writes beside it.
  if (node.hasAttribute?.('class')) {
    const kept = (node.getAttribute('class') ?? '')
      .split(/\s+/)
      .filter(
        (name) => name === 'hljs' || name.startsWith('hljs-') || name.startsWith('language-'),
      );
    if (kept.length) {
      node.setAttribute('class', kept.join(' '));
    } else {
      node.removeAttribute('class');
    }
  }
});

/** Marks a link this file created from a grounded product, for `.aa-markdown` to style. */
const PRODUCT_LINK_CLASS = 'aa-product-link';

/** Marks a rating the composer wrote, so it reads as a rating rather than as punctuation. */
const RATING_CLASS = 'aa-rating';

/**
 * A star and the value beside it, as `prompts/composer/v7.txt` asks for it (`★ 4.3`).
 *
 * The number is optional so a bare star still gets picked up, and the value is NEVER read,
 * rewritten or rounded here - this only puts a box around what the model wrote. Reformatting
 * someone's review score in the presentation layer is how a 4.3 quietly becomes a 4.5.
 */
const RATING = /★\s*\d+(?:[.,]\d+)?|★/gu;

/** Text that is nothing but a web address — what an autolinked `Link: https://…` becomes. */
const URL_ONLY = /^\s*(?:https?:\/\/|www\.)\S+\s*$/i;

/**
 * What may be left in a bullet once its address is taken out for the bullet to count as
 * having said nothing else: empty, or a short label such as `Link:` or `Buy at`.
 *
 * Deliberately a shape rather than a list of words — "Link", "URL", "Buy here" and whatever
 * the next model version prefers are all the same thing, and none of them should be spelled
 * out in this file in one language.
 */
const LABEL_ONLY = /^[\p{L} ]{0,20}:?$/u;

/** Only ever `http(s)`. Everything below runs AFTER DOMPurify, so it re-checks its own hrefs. */
function isSafeHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url, document.baseURI);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function isUrlText(node: Element): boolean {
  return URL_ONLY.test(node.textContent ?? '');
}

/**
 * One visual line of a block: everything between two `<br>`s, or the whole block.
 *
 * A model writes "Link: …" as a bullet, as its own paragraph, and as a line inside a
 * paragraph, and only the first of those is a `<li>`. Splitting a block into the lines a
 * shopper actually sees is what makes one rule cover all three.
 *
 * A nested list ends a line rather than joining it, because it is its own set of lines and
 * gets its own turn.
 */
function linesOf(block: Element): ChildNode[][] {
  const lines: ChildNode[][] = [[]];
  for (const child of Array.from(block.childNodes)) {
    if (child.nodeName === 'BR' || child.nodeName === 'UL' || child.nodeName === 'OL') {
      lines.push([]);
      continue;
    }
    lines[lines.length - 1].push(child);
  }
  return lines;
}

function anchorsIn(nodes: readonly ChildNode[]): HTMLAnchorElement[] {
  return nodes.flatMap((node) => {
    if (!(node instanceof Element)) {
      return [];
    }
    const nested = Array.from(node.querySelectorAll('a'));
    return node.matches('a') ? [node as HTMLAnchorElement, ...nested] : nested;
  });
}

/**
 * Drops any line whose whole content is "here is a link".
 *
 * The composer is told not to write one (`prompts/composer/v7.txt`); this is what keeps the
 * bubble clean for answers written before that rule and for the times a model ignores it. A
 * `Link: https://…/product/casual-shirt/` line is pure noise beside the product card that
 * already links the same product, and in a phone-width panel it is the widest thing on
 * screen.
 *
 * TWO SHAPES COUNT AS THAT LINE, and both are about the line saying nothing of its own:
 *
 *   - the address written out, whatever short label introduces it;
 *   - a short label linking to a product THIS ANSWER already shows, which is the same
 *     duplication wearing nicer clothes ("View product", "Buy it here").
 *
 * A line that mentions an address inside a real sentence keeps it, because then the shopper
 * is being told something. So does a link whose text is the product's own name - that is
 * the form this file spends the rest of its length creating.
 */
function dropLinkOnlyLines(root: HTMLElement, byUrl: Map<string, Product>): void {
  for (const block of Array.from(root.querySelectorAll('p, li'))) {
    for (const line of linesOf(block)) {
      const links = anchorsIn(line);
      if (!links.length) {
        continue;
      }

      const shown = links.filter(
        (link) => isUrlText(link) || byUrl.has(normalizeUrl(link.getAttribute('href') ?? '')),
      );
      if (!shown.length) {
        continue;
      }

      const text = line.map((node) => node.textContent ?? '').join('');
      const remainder = shown.reduce(
        (rest, link) => rest.replace(link.textContent ?? '', ''),
        text,
      );
      if (!LABEL_ONLY.test(remainder.trim())) {
        continue;
      }

      line.forEach((node) => node.remove());
    }

    tidy(block);
  }
}

/**
 * Clears up after a removal: the separators around a line that is no longer there, and the
 * block itself once nothing is left in it. Without this the answer keeps the blank row the
 * address used to sit on, which looks like a rendering fault rather than a tidy answer.
 */
function tidy(block: Element): void {
  let child = block.firstChild;
  while (child) {
    const next: ChildNode | null = child.nextSibling;
    const isBreak = child.nodeName === 'BR';
    const leading = isBreak && child === block.firstChild;
    const trailing = isBreak && child === block.lastChild;
    const doubled = isBreak && next?.nodeName === 'BR';
    if (leading || trailing || doubled) {
      child.remove();
    }
    child = next;
  }

  if (!(block.textContent ?? '').trim() && !block.querySelector('img, ul, ol')) {
    block.remove();
  }
}

/**
 * Gives an address-shaped link the product's name to show instead.
 *
 * The destination is unchanged — only what the shopper reads. A link whose destination is
 * not one of this answer's products is left exactly as it is: it may be a size guide or a
 * returns page, and this file has no business deciding that a link nobody grounded is noise.
 */
function nameBareLinks(root: HTMLElement, byUrl: Map<string, Product>): void {
  for (const anchor of Array.from(root.querySelectorAll('a'))) {
    if (!isUrlText(anchor)) {
      continue;
    }
    const product = byUrl.get(normalizeUrl(anchor.getAttribute('href') ?? ''));
    if (product) {
      anchor.textContent = product.name;
      anchor.classList.add(PRODUCT_LINK_CLASS);
    }
  }
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

/** A match must be a word of its own, so "Bat" inside "Batman" is not a product mention. */
function isWholeWord(text: string, start: number, length: number): boolean {
  const before = text[start - 1];
  const after = text[start + length];
  return !(before && /[\p{L}\p{N}]/u.test(before)) && !(after && /[\p{L}\p{N}]/u.test(after));
}

/**
 * Turns each mention of a grounded product's name into a link to that product.
 *
 * **The names come from the answer's own grounding**, never from a list in this file, so a
 * store selling anything at all works the moment its catalog syncs. Longest name first, so a
 * store carrying both "T-Shirt" and "Running T-Shirt" links the specific one.
 *
 * Text already inside a link, a code span or a preformatted block is left alone: the first
 * is already a link, and the other two are being shown verbatim on purpose.
 */
function linkProductNames(root: HTMLElement, products: readonly Product[]): void {
  const named = products
    .filter((product) => product.name?.trim() && isSafeHttpUrl(product.productUrl))
    .sort((left, right) => right.name.length - left.name.length);
  if (!named.length) {
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement?.closest('a, code, pre')) {
      targets.push(node);
    }
  }

  targets.forEach((node) => linkWithin(node, named));
}

function linkWithin(node: Text, products: readonly Product[]): void {
  const text = node.textContent ?? '';
  if (!text.trim()) {
    return;
  }
  const haystack = text.toLowerCase();

  let match: { index: number; product: Product } | null = null;
  for (const product of products) {
    const index = haystack.indexOf(product.name.toLowerCase());
    if (index === -1 || !isWholeWord(text, index, product.name.length)) {
      continue;
    }
    // Earliest wins; on a tie the longer name does, because `products` is sorted by length
    // and only a strictly earlier index replaces an existing candidate.
    if (match === null || index < match.index) {
      match = { index, product };
    }
  }

  if (!match) {
    return;
  }

  const { index, product } = match;
  const matched = node.splitText(index);
  const rest = matched.splitText(product.name.length);

  const anchor = document.createElement('a');
  anchor.href = product.productUrl;
  anchor.className = PRODUCT_LINK_CLASS;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  // The model's own casing is kept — it wrote the sentence, and replacing the words inside
  // it with the catalog's capitalisation would read as a typo.
  anchor.textContent = matched.textContent;
  matched.replaceWith(anchor);

  linkWithin(rest, products);
}

/**
 * Wraps a written rating so it can be styled as one.
 *
 * Same mechanism as the product links below it, for the same reason: the node is built here
 * through the DOM API rather than by widening the sanitizer's tag allowlist, so nothing the
 * model writes can introduce an element of its own.
 */
function styleRatings(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement?.closest('code, pre') && (node.textContent ?? '').includes('★')) {
      targets.push(node);
    }
  }

  for (const node of targets) {
    let cursor: Text | null = node;
    RATING.lastIndex = 0;
    let match = RATING.exec(cursor.textContent ?? '');
    while (cursor && match) {
      const found = cursor.splitText(match.index);
      const rest = found.splitText(match[0].length);

      const badge = document.createElement('span');
      badge.className = RATING_CLASS;
      badge.textContent = found.textContent;
      found.replaceWith(badge);

      cursor = rest;
      RATING.lastIndex = 0;
      match = RATING.exec(cursor.textContent ?? '');
    }
  }
}

/**
 * An allowlist rather than a blocklist: anything not named here cannot appear, including
 * whatever the next model version decides to emit. `span` is here for highlight.js's
 * tokens and for nothing else - the hook above throws away any class it did not produce.
 */
const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'span',
  'ul',
  'ol',
  'li',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'hr',
];

const ALLOWED_ATTR = ['href', 'title', 'target', 'rel', 'class'];

/** markdown -> marked (+ highlight.js) -> DOMPurify. The only path text takes to HTML. */
function toSafeHtml(text: string): string {
  const html = parser.parse(text) as string;
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}

/**
 * Closes a fenced code block the model has opened but not yet finished writing.
 *
 * This is the one piece of markdown whose half-written form does not degrade gracefully.
 * An unclosed ``` makes marked treat EVERYTHING after it as code, so the moment a streaming
 * answer opens a fence the rest of the reply - headings, lists, the sentence in progress -
 * collapses into one grey box, and then springs back out when the closing fence lands. An
 * unclosed `**` or a half-typed `[link](` simply renders as the literal characters until it
 * completes, which is what a reader expects to see while someone is still typing.
 *
 * Appending the closing fence is not a guess about content: it renders exactly the code
 * written so far, as code, which is what the finished block will show.
 */
function closeOpenFence(text: string): string {
  // Fences count only at the start of a line, so ``` inside a sentence is not one.
  const fences = text.match(/^\s{0,3}(?:`{3,}|~{3,})/gm) ?? [];
  if (fences.length % 2 === 0) {
    return text;
  }
  const opener = fences[fences.length - 1].trim();
  const closer = opener.startsWith('~') ? '~~~' : '```';
  return `${text}\n${closer}`;
}

/**
 * Renders a PARTIAL answer, mid-stream.
 *
 * Same pipeline as {@link renderMarkdown} and the same sanitizing - what it leaves out is
 * the product enrichment, because the answer's grounded product list does not exist until
 * `turn.completed`. Running it here would link the products of the PREVIOUS turn into this
 * one's half-written sentence.
 *
 * Cheap enough to call per delta: one message's worth of markdown, not the transcript.
 */
export function renderStreamingMarkdown(text: string): string {
  if (!text.trim()) {
    return '';
  }
  return toSafeHtml(closeOpenFence(text));
}

/**
 * @param text     the completed answer, as the composer wrote it
 * @param products the products this answer is grounded in — their names become links
 */
export function renderMarkdown(text: string, products: readonly Product[] = []): string {
  if (!text.trim()) {
    return '';
  }

  const safe = toSafeHtml(text);

  // Everything past this point builds nodes through the DOM API — `createElement` and
  // `textContent`, never `innerHTML` — from data the backend already vouched for, so no
  // markup can be introduced after the sanitizer has run.
  const container = document.createElement('div');
  container.innerHTML = safe;

  const byUrl = new Map(
    products
      .filter((product) => isSafeHttpUrl(product.productUrl))
      .map((product) => [normalizeUrl(product.productUrl), product] as const),
  );

  dropLinkOnlyLines(container, byUrl);
  nameBareLinks(container, byUrl);
  linkProductNames(container, products);
  styleRatings(container);

  return container.innerHTML;
}

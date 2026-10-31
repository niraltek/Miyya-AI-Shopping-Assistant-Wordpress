/**
 * jsdom implements neither matchMedia nor the CSS custom-property side of
 * style, but ThemeService reads the OS colour-scheme preference the moment it
 * is constructed. Without this stub every spec that injects it dies on
 * "window.matchMedia is not a function" before reaching its assertions.
 */
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

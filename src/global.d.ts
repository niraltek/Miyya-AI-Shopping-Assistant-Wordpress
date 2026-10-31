import type { AIAssistantConfig } from './app/features/store/models/woocommerce';

/**
 * The WordPress plugin sets window.AIAssistantConfig in an inline script that
 * runs before the Angular bundle. Declared in a .d.ts (not a .ts) because
 * tsconfig.spec.json includes only *.d.ts and *.spec.ts — putting it in a
 * regular module left `window.AIAssistantConfig` untyped under `ng test`.
 */
declare global {
  interface Window {
    AIAssistantConfig?: AIAssistantConfig;
  }
}

export {};

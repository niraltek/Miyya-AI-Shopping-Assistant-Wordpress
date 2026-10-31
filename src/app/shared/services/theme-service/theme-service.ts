import { effect, Service, signal } from '@angular/core';
import { AccentName, AccentOption } from '../../models/theme';

@Service()
export class ThemeService {
  readonly isDarkMode = signal(false);
  readonly accent = signal<AccentName>('miyya');
  readonly customColor = signal('#6366f1');
  readonly accents: readonly AccentOption[] = [
    { name: 'miyya', swatch: 'bg-[#072D73]' },
    { name: 'red', swatch: 'bg-red-500' },
    { name: 'orange', swatch: 'bg-orange-500' },
    { name: 'amber', swatch: 'bg-amber-500' },
    { name: 'yellow', swatch: 'bg-yellow-500' },
    { name: 'lime', swatch: 'bg-lime-500' },
    { name: 'green', swatch: 'bg-green-500' },
    { name: 'emerald', swatch: 'bg-emerald-500' },
    { name: 'teal', swatch: 'bg-teal-500' },
    { name: 'cyan', swatch: 'bg-cyan-500' },
    { name: 'sky', swatch: 'bg-sky-500' },
    { name: 'blue', swatch: 'bg-blue-500' },
    { name: 'indigo', swatch: 'bg-indigo-500' },
    { name: 'violet', swatch: 'bg-violet-500' },
    { name: 'purple', swatch: 'bg-purple-500' },
    { name: 'fuchsia', swatch: 'bg-fuchsia-500' },
    { name: 'pink', swatch: 'bg-pink-500' },
    { name: 'rose', swatch: 'bg-rose-500' },
    { name: 'slate', swatch: 'bg-slate-500' },
    { name: 'gray', swatch: 'bg-gray-500' },
    { name: 'zinc', swatch: 'bg-zinc-500' },
    { name: 'neutral', swatch: 'bg-neutral-500' },
    { name: 'stone', swatch: 'bg-stone-500' },
    { name: 'taupe', swatch: 'bg-taupe-500' },
    { name: 'mauve', swatch: 'bg-mauve-500' },
    { name: 'mist', swatch: 'bg-mist-500' },
    { name: 'olive', swatch: 'bg-olive-500' },
  ];

  constructor() {
    this.getTheme();
    effect(() => {
      document.documentElement.classList.toggle('dark', this.isDarkMode());
    });
    effect(() => {
      const accent = this.accent();
      document.documentElement.setAttribute('data-accent', accent);
      if (accent === 'custom') {
        document.documentElement.style.setProperty('--accent-base', this.customColor());
      } else {
        document.documentElement.style.removeProperty('--accent-base');
      }
    });
  }

  private getTheme(): void {
    const storedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.isDarkMode.set(storedTheme === 'dark' || (!storedTheme && prefersDark));
    const storedCustomColor = localStorage.getItem('accentCustom');
    if (storedCustomColor) {
      this.customColor.set(storedCustomColor);
    }
    const storedAccent = localStorage.getItem('accent') as AccentName | null;
    if (
      storedAccent &&
      (storedAccent === 'custom' || this.accents.some((accent) => accent.name === storedAccent))
    ) {
      this.accent.set(storedAccent);
    }
  }

  toggleTheme(): void {
    const isDark = !this.isDarkMode();
    this.isDarkMode.set(isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }

  setTheme(isDark: boolean): void {
    this.isDarkMode.set(isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }

  setAccent(name: AccentName): void {
    this.accent.set(name);
    localStorage.setItem('accent', name);
  }

  setCustomColor(hex: string): void {
    this.customColor.set(hex);
    this.accent.set('custom');
    localStorage.setItem('accentCustom', hex);
    localStorage.setItem('accent', 'custom');
  }
}

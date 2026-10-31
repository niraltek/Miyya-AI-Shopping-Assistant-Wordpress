import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';
import { AIAssistantConfig } from './features/store/models/woocommerce';

@Component({ template: '<p>Page ready</p>' })
class ReadyPage {}

describe('App', () => {
  afterEach(() => {
    delete window.AIAssistantConfig;
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      // App injects Router and navigates in ngOnInit, so the outlet it renders
      // needs a real (empty) router configuration to resolve against.
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the router outlet', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });

  it('shows a loading state until the first lazy route is ready', async () => {
    let finishLoading!: (component: typeof ReadyPage) => void;
    const page = new Promise<typeof ReadyPage>((resolve) => (finishLoading = resolve));
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: 'slow-page', loadComponent: () => page }]);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const navigation = router.navigateByUrl('/slow-page');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const loadingText = element.querySelector('[role="status"]')?.textContent;

    finishLoading(ReadyPage);
    await navigation;
    await fixture.whenStable();
    expect(loadingText).toContain('Loading Miyya');
    expect(element.textContent).toContain('Page ready');
    expect(element.querySelector('[role="status"]')).toBeNull();
  });

  it('keeps the storefront widget transparent while its route loads', () => {
    window.AIAssistantConfig = { embedded: true } as AIAssistantConfig;
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
  });
});

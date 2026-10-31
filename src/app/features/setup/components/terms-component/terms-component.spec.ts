import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { TermsComponent } from './terms-component';

describe('TermsComponent', () => {
  let component: TermsComponent;
  let fixture: ComponentFixture<TermsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TermsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TermsComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('exposes a named modal dialog and focuses its Close button after rendering', () => {
    const element = fixture.nativeElement as HTMLElement;
    const dialog = element.querySelector<HTMLElement>('[role="dialog"]')!;
    const closeButton = element.querySelector<HTMLButtonElement>('[data-testid="terms-close"]')!;

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('terms-title');
    expect(element.querySelector('#terms-title')?.textContent).toContain(
      'Store connection and your data',
    );
    expect(document.activeElement).toBe(closeButton);
  });

  it('discloses AI processing and links the actual policies without claiming no sharing', () => {
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('OpenAI');
    expect(element.textContent).not.toContain('never sell, rent or share');
    expect(element.querySelector('a[href="https://niraltek.com/privacy-policy/"]')).not.toBeNull();
    expect(element.querySelector('a[href="https://openai.com/policies/privacy-policy/"]')).not.toBeNull();
  });

  it('emits closed when Escape is pressed', () => {
    const closed = vi.fn();
    component.closed.subscribe(closed);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('emits closed from both Close controls', () => {
    const closed = vi.fn();
    component.closed.subscribe(closed);
    const element = fixture.nativeElement as HTMLElement;

    element.querySelector<HTMLButtonElement>('[aria-label="Close terms"]')!.click();
    element.querySelector<HTMLButtonElement>('[data-testid="terms-close"]')!.click();

    expect(closed).toHaveBeenCalledTimes(2);
  });

  it('keeps the dialog open for content clicks and closes it for backdrop clicks', () => {
    const closed = vi.fn();
    component.closed.subscribe(closed);
    const element = fixture.nativeElement as HTMLElement;

    element.querySelector<HTMLElement>('[role="dialog"]')!.click();
    expect(closed).not.toHaveBeenCalled();

    element.querySelector<HTMLElement>('[role="presentation"]')!.click();
    expect(closed).toHaveBeenCalledTimes(1);
  });
});

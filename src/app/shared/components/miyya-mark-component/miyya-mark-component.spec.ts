import { TestBed } from '@angular/core/testing';
import { MiyyaMarkComponent } from './miyya-mark-component';

describe('MiyyaMarkComponent', () => {
  it('draws the brand mark in the text colour and hides it from assistive tech', () => {
    const fixture = TestBed.createComponent(MiyyaMarkComponent);
    fixture.detectChanges();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg');

    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('viewBox')).toBe('0 0 850 840');
    expect(svg!.getAttribute('fill')).toBe('currentColor');
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
    expect(svg!.querySelector('path')!.getAttribute('d')!.length).toBeGreaterThan(1000);
  });
});

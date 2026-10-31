import { afterNextRender, Component, ElementRef, output, viewChild } from '@angular/core';
import {
  LucideCheck,
  LucideLockKeyhole,
  LucideShieldCheck,
  LucideStore,
  LucideX,
} from '@lucide/angular';

@Component({
  imports: [LucideCheck, LucideLockKeyhole, LucideShieldCheck, LucideStore, LucideX],
  selector: 'app-terms-component',
  templateUrl: './terms-component.html',
  host: { '(document:keydown.escape)': 'close()' },
  styleUrl: './terms-component.scss',
})
export class TermsComponent {
  readonly closed = output<void>();
  private readonly closeButton = viewChild.required<ElementRef<HTMLButtonElement>>('closeButton');

  constructor() {
    afterNextRender(() => this.closeButton().nativeElement.focus());
  }

  protected close(): void {
    this.closed.emit();
  }
}

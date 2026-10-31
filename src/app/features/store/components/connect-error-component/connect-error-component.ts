import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { LucideTriangleAlert } from '@lucide/angular';
import { navigateTop } from '../../../../core/utils/navigation';

@Component({
  imports: [LucideTriangleAlert],
  selector: 'app-connect-error-component',
  styleUrl: './connect-error-component.scss',
  templateUrl: './connect-error-component.html',
})
export class ConnectErrorComponent {
  private readonly router = inject(Router);

  protected retry(): void {
    const setupUrl = window.AIAssistantConfig?.setupUrl;
    if (setupUrl) {
      navigateTop(setupUrl);
      return;
    }
    this.router.navigate(['/setup']);
  }

  protected backToDashboard(): void {
    this.router.navigateByUrl('/dashboard');
  }
}

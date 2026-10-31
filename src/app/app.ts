import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App implements OnInit {
  private readonly router = inject(Router);
  protected readonly embedded = window.AIAssistantConfig?.embedded === true;
  protected readonly pageReady = signal(false);

  ngOnInit(): void {
    const route = window.AIAssistantConfig?.route;
    const hasRequestedHashRoute = window.location.hash.startsWith('#/');
    if (route && !hasRequestedHashRoute) {
      this.router.navigateByUrl(route, { skipLocationChange: true });
    }
  }
}

import { TestBed } from '@angular/core/testing';
import { ChatLauncher } from './chat-launcher';

describe('ChatLauncher', () => {
  let service: ChatLauncher;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ChatLauncher);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts closed and keeps repeated open and close calls idempotent', () => {
    expect(service.isOpen()).toBe(false);

    service.open();
    service.open();
    expect(service.isOpen()).toBe(true);

    service.close();
    service.close();
    expect(service.isOpen()).toBe(false);
  });

  it('toggles the current state shared by all injected consumers', () => {
    const otherConsumer = TestBed.inject(ChatLauncher);

    service.toggle();
    expect(otherConsumer.isOpen()).toBe(true);
    otherConsumer.toggle();
    expect(service.isOpen()).toBe(false);
  });
});

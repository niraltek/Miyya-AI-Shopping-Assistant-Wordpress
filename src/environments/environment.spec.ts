import { environment as development } from './environment.development';
import { environment as production } from './environment.production';

describe('API environment configuration', () => {
  it('configures distinct, nonempty development and production API origins', () => {
    expect(new URL(development.apiBaseUrl).origin).toBe('http://localhost:8000');
    expect(new URL(production.apiBaseUrl).origin).toBe('https://app.heymiyya.com');
    expect(production.production).toBe(true);
    expect(Object.keys(development)).not.toContain('devEmail');
    expect(Object.keys(production)).not.toContain('devEmail');
  });
});

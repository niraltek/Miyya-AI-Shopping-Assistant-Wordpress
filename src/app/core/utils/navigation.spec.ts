import { connectDestination } from './navigation';

describe('connectDestination', () => {
  const authorize = 'https://shop.example.com/wc-auth/v1/authorize?x=1';
  const connected = 'https://shop.example.com/wp-admin/admin.php?page=ai-assistant-connected';

  it('goes straight to the connected page when the plugin approved it', () => {
    expect(
      connectDestination({
        authorizationUrl: authorize,
        autoApproved: true,
        redirectUrl: connected,
      }),
    ).toBe(connected);
  });

  it("falls back to WooCommerce's approve screen when the plugin could not approve", () => {
    expect(
      connectDestination({
        authorizationUrl: authorize,
        autoApproved: false,
        redirectUrl: connected,
      }),
    ).toBe(authorize);
    expect(connectDestination({ authorizationUrl: authorize })).toBe(authorize);
  });

  it('does not trust an approval that names no page to go to', () => {
    expect(connectDestination({ authorizationUrl: authorize, autoApproved: true })).toBe(authorize);
    expect(
      connectDestination({ authorizationUrl: authorize, autoApproved: true, redirectUrl: '' }),
    ).toBe(authorize);
  });
});

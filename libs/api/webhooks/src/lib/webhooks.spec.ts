import { isPrivateAddress, UnsafeWebhookUrlError, WebhookSender, webhooksConfigFromEnv } from './webhook-sender';
import { signWebhook, verifyWebhookSignature } from './webhook-signature';

describe('webhook signatures', () => {
  const secret = 'whsec_test-secret-with-enough-characters';
  const body = '{"id":"e1","type":"entry.published"}';

  it('signs the timestamp and body, and verifies them', () => {
    const header = signWebhook(secret, body, 1_760_000_000);
    expect(header).toMatch(/^t=1760000000,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(secret, body, header, 1_760_000_010)).toBe(true);
  });

  it('refuses another body, another secret, a malformed header and an old timestamp (replays)', () => {
    const header = signWebhook(secret, body, 1_760_000_000);
    expect(verifyWebhookSignature(secret, body.replace('e1', 'e2'), header, 1_760_000_000)).toBe(false);
    expect(verifyWebhookSignature('whsec_another-secret-with-enough-chars', body, header, 1_760_000_000)).toBe(false);
    expect(verifyWebhookSignature(secret, body, 'v1=abc', 1_760_000_000)).toBe(false);
    expect(verifyWebhookSignature(secret, body, null, 1_760_000_000)).toBe(false);
    expect(verifyWebhookSignature(secret, body, header, 1_760_000_000 + 301)).toBe(false);
  });
});

describe('webhook addresses', () => {
  it('knows private, loopback and link-local addresses', () => {
    for (const address of ['10.1.2.3', '127.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:1.1.1.1']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it('in production, calls only https addresses that are not private', async () => {
    const sender = new WebhookSender({ allowPrivateUrls: false, timeoutMs: 1000 });
    await expect(sender.checkUrl('http://example.com/hook')).rejects.toThrow(UnsafeWebhookUrlError);
    await expect(sender.checkUrl('https://127.0.0.1/hook')).rejects.toThrow('private or local');
    await expect(sender.checkUrl('https://[::1]/hook')).rejects.toThrow('private or local');
    await expect(sender.checkUrl('https://169.254.169.254/latest')).rejects.toThrow('private or local');
    await expect(sender.checkUrl('https://1.1.1.1/hook')).resolves.toBeUndefined();
  });

  it('allows private addresses outside production, unless told otherwise', () => {
    expect(webhooksConfigFromEnv({ NODE_ENV: 'development' }).allowPrivateUrls).toBe(true);
    expect(webhooksConfigFromEnv({ NODE_ENV: 'production' }).allowPrivateUrls).toBe(false);
    expect(webhooksConfigFromEnv({ NODE_ENV: 'production', WEBHOOKS_ALLOW_PRIVATE_URLS: 'true' }).allowPrivateUrls).toBe(true);
    expect(webhooksConfigFromEnv({ WEBHOOKS_ALLOW_PRIVATE_URLS: 'false' }).allowPrivateUrls).toBe(false);
  });
});

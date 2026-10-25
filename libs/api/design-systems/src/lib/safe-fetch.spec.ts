import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FetchProblem, isPublicAddress, safeFetch } from './safe-fetch';

describe('public addresses', () => {
  it.each(['104.16.0.1', '151.101.1.69', '2606:4700::6810:84e5', '::ffff:8.8.8.8'])('allows %s', (address) =>
    expect(isPublicAddress(address)).toBe(true),
  );

  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.5',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    'not-an-ip',
  ])('refuses %s', (address) => expect(isPublicAddress(address)).toBe(false));
});

describe('fetching', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((_, response) => response.end('.a{}'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  const refused = (address: string) => expect(safeFetch(address, { maxBytes: 1024 })).rejects.toBeInstanceOf(FetchProblem);

  it.each([
    ['http addresses', () => `http://127.0.0.1:${port}/a.css`],
    ['private IP addresses', () => `https://127.0.0.1:${port}/a.css`],
    ['the cloud metadata address', () => 'https://169.254.169.254/latest/meta-data'],
    ['IPv6 loopback', () => `https://[::1]:${port}/a.css`],
    ['localhost', () => `https://localhost:${port}/a.css`],
    ['addresses with credentials', () => 'https://user:secret@cdn.example.com/a.css'], // trufflehog:ignore
    ['things that are not addresses', () => 'not a url'],
  ])('refuses %s without connecting', async (_, address) => {
    await refused(address());
  });

  it('says why', async () => {
    await expect(safeFetch(`https://127.0.0.1:${port}/a.css`, { maxBytes: 1024 })).rejects.toThrow('127.0.0.1 is not a public address.');
    await expect(safeFetch('http://cdn.example.com/a.css', { maxBytes: 1024 })).rejects.toThrow('Use an https address.');
  });
});

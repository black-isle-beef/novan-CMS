// Tests the @black-isle-beef/cms-angular/bridge entry point; the unit-test runner only looks under src/.
import { blockLabel, type NovanBridgeHandle, type NovanBridgeHost, startNovanBridge } from '@black-isle-beef/cms-angular/bridge';

type Mock<T extends (...args: never[]) => unknown> = ReturnType<typeof vi.fn<T>>;

const ADMIN = 'https://admin.novan.test';

/** Lets the bridge's next frame run. */
const frame = () => new Promise((resolve) => setTimeout(resolve, 40));

function page(): void {
  document.body.innerHTML = `
    <div data-novan-uid="hero-1" data-novan-block="hero"><h1>Welcome</h1><a href="/about" id="link">About</a></div>
    <div data-novan-uid="text-1" data-novan-block="richText"><p id="text">Hello</p></div>
    <footer id="outside">Footer</footer>`;
}

describe('the bridge', () => {
  let parent: MessagePort;
  let sent: unknown[];
  let host: NovanBridgeHost & { update: Mock<(data: Record<string, unknown>) => void>; token: Mock<(token: string) => void> };
  let bridge: NovanBridgeHandle;

  /** A message as the admin's window would send it. */
  const fromAdmin = (data: unknown, { origin = ADMIN, source = parent as MessageEventSource | null } = {}) =>
    window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
  const admin = (type: string, payload: unknown) => ({ source: 'novan', v: 1, type, payload });
  const messages = (type: string) => sent.filter((m) => (m as { type: string }).type === type) as { payload: unknown }[];

  beforeEach(() => {
    page();
    sent = [];
    // The admin's window: a port stands in, as jsdom has no parent frame.
    parent = new MessageChannel().port1;
    vi.spyOn(parent, 'postMessage').mockImplementation(((message: unknown, origin: unknown) => {
      expect(origin).toBe(ADMIN);
      sent.push(message);
    }) as never);
    host = { adminOrigin: ADMIN, sdkVersion: '0.3.0', update: vi.fn<(data: Record<string, unknown>) => void>(), token: vi.fn<(token: string) => void>() };
    bridge = startNovanBridge(host, { window, parent: parent as unknown as Window });
  });

  afterEach(() => {
    bridge.stop();
    document.body.innerHTML = '';
  });

  it('says it is ready, with the page and SDK version, only to the admin', () => {
    expect(sent[0]).toEqual({ source: 'novan', v: 1, type: 'ready', payload: { path: '/', sdkVersion: '0.3.0' } });
  });

  it('reports where every block is', async () => {
    await frame();
    const [rects] = messages('rects');
    expect(Object.keys(rects.payload as object)).toEqual(['hero-1', 'text-1']);
    expect((rects.payload as Record<string, object>)['hero-1']).toEqual({ x: 0, y: 0, width: 0, height: 0 });

    // Nothing moved: nothing more is sent.
    window.dispatchEvent(new Event('resize'));
    await frame();
    expect(messages('rects')).toHaveLength(1);

    // A new block is reported.
    const added = document.createElement('div');
    added.setAttribute('data-novan-uid', 'cta-1');
    document.body.append(added);
    await frame();
    expect(Object.keys(messages('rects')[1].payload as object)).toEqual(['hero-1', 'text-1', 'cta-1']);
  });

  it('selects the block clicked, without following its links', async () => {
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('link')?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(messages('select')).toEqual([{ source: 'novan', v: 1, type: 'select', payload: { uid: 'hero-1' } }]);

    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('text')?.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(messages('select')[1].payload).toEqual({ uid: 'text-1' });

    // Clicks outside blocks are left alone.
    document.getElementById('outside')?.click();
    expect(messages('select')).toHaveLength(2);

    await frame();
    const label = document.querySelector('[data-novan-overlay]')?.lastElementChild;
    expect(label?.textContent).toBe('Rich text');
  });

  it('reports the block under the pointer once per change', () => {
    const over = (id: string) => document.getElementById(id)?.dispatchEvent(new Event('pointerover', { bubbles: true }));
    over('text');
    over('text');
    over('outside');
    expect(messages('hover').map((m) => m.payload)).toEqual([{ uid: 'text-1' }, { uid: null }]);
  });

  it('applies the admin’s updates and refreshed tokens', () => {
    fromAdmin(admin('update', { data: { title: 'Edited' } }));
    fromAdmin(admin('token', { token: 'fresh' }));
    expect(host.update).toHaveBeenCalledWith({ title: 'Edited' });
    expect(host.token).toHaveBeenCalledWith('fresh');
  });

  it('ignores messages from other origins, other windows and anything malformed', () => {
    const update = admin('update', { data: { title: 'Hacked' } });
    fromAdmin(update, { origin: 'https://evil.example' });
    fromAdmin(update, { origin: 'null' });
    fromAdmin(update, { source: null });
    fromAdmin(update, { source: new MessageChannel().port1 });
    fromAdmin({ ...update, source: 'other' });
    fromAdmin(admin('update', { data: 'not an object' }));
    fromAdmin(admin('eval', { code: 'alert(1)' }));
    expect(host.update).not.toHaveBeenCalled();
  });

  it('outlines and scrolls to the blocks the admin points at', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    fromAdmin(admin('select', { uid: 'hero-1' }));
    fromAdmin(admin('scrollTo', { uid: 'text-1' }));
    await frame();
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
    const overlay = document.querySelector<HTMLElement>('[data-novan-overlay]');
    expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    expect(overlay?.parentElement).toBe(document.documentElement);
    expect(overlay?.lastElementChild?.textContent).toBe('Hero');
  });

  it('says it is ready again after the site navigates', () => {
    bridge.navigated();
    expect(messages('ready')).toHaveLength(2);
  });

  it('stops listening and removes its overlay', () => {
    bridge.stop();
    fromAdmin(admin('update', { data: {} }));
    document.getElementById('text')?.click();
    expect(host.update).not.toHaveBeenCalled();
    expect(messages('select')).toHaveLength(0);
    expect(document.querySelector('[data-novan-overlay]')).toBeNull();
  });
});

describe('blockLabel', () => {
  it.each([
    ['hero', 'Hero'],
    ['richText', 'Rich text'],
    ['featureGrid2', 'Feature grid2'],
  ])('%s reads %s', (apiId, label) => {
    expect(blockLabel(apiId)).toBe(label);
  });
});

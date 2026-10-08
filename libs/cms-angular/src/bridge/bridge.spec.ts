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
  const last = (type: string) => messages(type)[messages(type).length - 1];

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

  it('reports the page’s headings and the blocks they are in, when they change', async () => {
    await frame();
    expect(messages('headings').map((m) => m.payload)).toEqual([{ headings: [{ level: 1, text: 'Welcome', uid: 'hero-1' }] }]);
    const footer = document.getElementById('outside') as HTMLElement;
    footer.innerHTML = '<h4>  Site   map </h4>';
    await frame();
    expect(messages('headings')[1].payload).toEqual({
      headings: [
        { level: 1, text: 'Welcome', uid: 'hero-1' },
        { level: 4, text: 'Site map', uid: null },
      ],
    });
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

  describe('once the admin says what can change', () => {
    const editable = (uid: string | null, fields = [{ field: 'heading', value: 'Welcome', multiline: false }], insert = true) =>
      fromAdmin(admin('editable', { uid, fields, insert }));
    const insertButton = (position: string) => document.querySelector<HTMLElement>(`[data-novan-insert="${position}"]`);
    const dblclick = (el: Element | null | undefined) => el?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    const heading = () => document.querySelector<HTMLElement>('[data-novan-uid="hero-1"] h1');

    it('draws "+" buttons on the selected block that ask the admin to add a block there', async () => {
      fromAdmin(admin('select', { uid: 'hero-1' }));
      await frame();
      expect(insertButton('before')?.style.display).toBe('none');

      editable('hero-1', [], false);
      await frame();
      expect(insertButton('before')?.style.display).toBe('none');
      editable('hero-1');
      await frame();
      expect(insertButton('before')?.style.display).toBe('block');
      // Taking a click must not select anything behind it.
      insertButton('after')?.click();
      insertButton('before')?.click();
      expect(messages('insert').map((m) => m.payload)).toEqual([
        { uid: 'hero-1', position: 'after' },
        { uid: 'hero-1', position: 'before' },
      ]);
      expect(messages('select')).toHaveLength(0);
    });

    it('edits a text field of the selected block in place on double-click', () => {
      editable('hero-1');
      dblclick(heading());
      expect(heading()?.getAttribute('contenteditable')).toMatch(/plaintext-only|true/);
      expect(document.activeElement).toBe(heading());

      (heading() as HTMLElement).textContent = 'Hello there';
      heading()?.dispatchEvent(new Event('input'));
      expect(last('text')?.payload).toEqual({ uid: 'hero-1', field: 'heading', value: 'Hello there', done: false });

      // Enter ends a one-line field.
      heading()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
      expect(last('text')?.payload).toEqual({ uid: 'hero-1', field: 'heading', value: 'Hello there', done: true });
      expect(heading()?.hasAttribute('contenteditable')).toBe(false);
    });

    it('puts the text back on Escape', () => {
      editable('hero-1');
      dblclick(heading());
      (heading() as HTMLElement).textContent = 'Oops';
      heading()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
      expect(heading()?.textContent).toBe('Welcome');
      expect(last('text')?.payload).toMatchObject({ value: 'Welcome', done: true });
    });

    it('prefers the element a component marks with data-novan-field', () => {
      document.body.innerHTML = `<div data-novan-uid="cta-1" data-novan-block="cta"><p data-novan-field="text"><span id="inner">Same</span></p><p>Same</p></div>`;
      editable('cta-1', [{ field: 'text', value: 'Different', multiline: true }]);
      dblclick(document.getElementById('inner'));
      expect(document.querySelector('[data-novan-field]')?.getAttribute('contenteditable')).not.toBeNull();
    });

    it('leaves text alone in other blocks, for fields it was not given, and for read-only editors', () => {
      editable('text-1');
      dblclick(heading());
      editable('hero-1', []);
      dblclick(heading());
      expect(heading()?.hasAttribute('contenteditable')).toBe(false);
      expect(messages('text')).toHaveLength(0);
    });
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

import { TestBed } from '@angular/core/testing';
import { findBlock } from './find-block';
import { PreviewBridge } from './preview-bridge';

const SITE = 'https://www.example.com';
const wrap = (type: string, payload: unknown) => ({ source: 'novan', v: 1, type, payload });

describe('PreviewBridge', () => {
  let bridge: PreviewBridge;
  let frame: MessagePort;
  let posted: [unknown, unknown][];

  /** A message as a window would send it to the admin. */
  const receive = (data: unknown, { origin = SITE, source = frame as MessageEventSource | null } = {}) =>
    window.dispatchEvent(new MessageEvent('message', { data, origin, source }));

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [PreviewBridge] });
    bridge = TestBed.inject(PreviewBridge);
    // The frame's window: a port stands in, as jsdom does not run the site.
    frame = new MessageChannel().port1;
    posted = [];
    vi.spyOn(frame, 'postMessage').mockImplementation(((message: unknown, origin: unknown) => posted.push([message, origin])) as never);
    bridge.connect(frame as unknown as Window, `${SITE}/some/page`);
  });

  it('follows the site: ready, hover, selection and block positions', () => {
    receive(wrap('ready', { path: '/about', sdkVersion: '0.3.0' }));
    receive(wrap('hover', { uid: 'a' }));
    receive(wrap('select', { uid: 'b' }));
    receive(wrap('rects', { b: { x: 1, y: 2, width: 3, height: 4 } }));
    expect(bridge.ready()).toEqual({ path: '/about', sdkVersion: '0.3.0' });
    expect(bridge.hovered()).toBe('a');
    expect(bridge.selected()).toBe('b');
    expect(bridge.rects()).toEqual({ b: { x: 1, y: 2, width: 3, height: 4 } });
  });

  it('ignores messages from other origins, other windows and anything malformed', () => {
    const select = wrap('select', { uid: 'x' });
    receive(select, { origin: 'https://evil.example' });
    receive(select, { origin: 'http://www.example.com' });
    receive(select, { source: null });
    receive(select, { source: new MessageChannel().port1 });
    receive({ ...select, v: 2 });
    receive(wrap('select', { uid: 42 }));
    receive(wrap('update', { data: {} }));
    expect(bridge.selected()).toBeNull();
  });

  it('sends only once the site is ready, and only to its origin', () => {
    expect(bridge.send({ type: 'scrollTo', payload: { uid: 'a' } })).toBe(false);
    receive(wrap('ready', { path: '/', sdkVersion: '0.3.0' }));
    expect(bridge.send({ type: 'token', payload: { token: 't' } })).toBe(true);
    expect(posted).toEqual([[{ source: 'novan', v: 1, type: 'token', payload: { token: 't' } }, SITE]]);
  });

  it('forgets the site when it disconnects', () => {
    receive(wrap('ready', { path: '/', sdkVersion: '0.3.0' }));
    bridge.disconnect();
    receive(wrap('select', { uid: 'late' }));
    expect(bridge.ready()).toBeNull();
    expect(bridge.selected()).toBeNull();
    expect(bridge.send({ type: 'select', payload: { uid: null } })).toBe(false);
  });
});

describe('findBlock', () => {
  const data = {
    title: 'Home',
    body: [
      { _uid: 'a', _block: 'hero' },
      { _uid: 'b', _block: 'columns', children: [{ _uid: 'c', _block: 'text' }] },
    ],
    group: { inner: [{ _uid: 'd', _block: 'cta' }] },
    lookalike: { _uid: 'e' },
  };

  it.each([
    ['a', 'hero'],
    ['c', 'text'],
    ['d', 'cta'],
  ])('finds %s anywhere in the page', (uid, block) => {
    expect(findBlock(data, uid)?._block).toBe(block);
  });

  it('finds nothing for an unknown id, a node that is not a block, or no id', () => {
    expect(findBlock(data, 'zz')).toBeNull();
    expect(findBlock(data, 'e')).toBeNull();
    expect(findBlock(data, null)).toBeNull();
  });
});

import { type BridgeRect, bridgeEnvelope, parseAdminMessage, type SiteMessage } from './protocol';

/** What the bridge needs from the app (`NovanPreview` provides it). */
export interface NovanBridgeHost {
  /** The only origin messages are sent to and taken from. */
  adminOrigin: string;
  sdkVersion: string;
  /** Shows the admin's unsaved data for the page being edited. */
  update(data: Record<string, unknown>): void;
  /** Takes a fresh signed token from the admin. */
  token(token: string): void;
}

/** A running bridge. */
export interface NovanBridgeHandle {
  /** Tells the admin the page in the frame changed. */
  navigated(): void;
  stop(): void;
}

const UID = 'data-novan-uid';
const BLOCK = 'data-novan-block';
/** The editor's outline colour: 4.6:1 against white, for the label's white text. */
const ACCENT = '#0b5ed7';

/** Where the bridge runs; tests pass their own. */
export interface NovanBridgeEnvironment {
  window: Window;
  /** The admin's window; messages from anything else are ignored. */
  parent: Pick<Window, 'postMessage'>;
}

/**
 * Starts the visual editor bridge in a preview page inside the admin's frame. It outlines the block under
 * the pointer and the selected block (with the block's name) in an overlay above the page, tells the admin
 * which block was clicked or hovered and where every block is, and applies the admin's updates through the
 * host. It talks only to `host.adminOrigin`, and only to the frame's parent window.
 */
export function startNovanBridge(
  host: NovanBridgeHost,
  env: NovanBridgeEnvironment = { window, parent: window.parent },
): NovanBridgeHandle {
  const win = env.window;
  const doc = win.document;
  const overlay = new Overlay(doc);
  let hovered: string | null = null;
  let selected: string | null = null;
  let lastRects = '';
  let frame: number | null = null;

  const post = (message: SiteMessage) => env.parent.postMessage(bridgeEnvelope(message), host.adminOrigin);
  const blockOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>(`[${UID}]`) : null;
  const element = (uid: string | null): HTMLElement | null =>
    uid === null ? null : (Array.from(doc.querySelectorAll<HTMLElement>(`[${UID}]`)).find((el) => el.getAttribute(UID) === uid) ?? null);

  const measure = () => {
    frame = null;
    const rects: Record<string, BridgeRect> = {};
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>(`[${UID}]`))) {
      const uid = el.getAttribute(UID);
      if (!uid) continue;
      const { x, y, width, height } = el.getBoundingClientRect();
      rects[uid] = { x, y, width, height };
    }
    const hoverEl = hovered !== selected ? element(hovered) : null;
    const selectedEl = element(selected);
    overlay.draw(
      hoverEl && hovered ? { rect: rects[hovered], label: labelOf(hoverEl) } : null,
      selectedEl && selected ? { rect: rects[selected], label: labelOf(selectedEl) } : null,
    );
    const json = JSON.stringify(rects);
    if (json !== lastRects) {
      lastRects = json;
      post({ type: 'rects', payload: rects });
    }
  };
  const schedule = () => {
    frame ??= (win.requestAnimationFrame ?? ((callback: () => void) => win.setTimeout(callback, 16)))(measure);
  };

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== host.adminOrigin || event.source !== env.parent) return;
    const message = parseAdminMessage(event.data);
    if (!message) return;
    switch (message.type) {
      case 'update':
        host.update(message.payload.data);
        break;
      case 'select':
        selected = message.payload.uid;
        break;
      case 'hover':
        hovered = message.payload.uid;
        break;
      case 'scrollTo': {
        const reduce = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        element(message.payload.uid)?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
        break;
      }
      case 'token':
        host.token(message.payload.token);
        break;
    }
    schedule();
  };

  const onClick = (event: MouseEvent) => {
    const block = blockOf(event.target);
    const uid = block?.getAttribute(UID);
    if (!uid) return;
    // A click in the editor picks the block; it must not leave the page or submit a form.
    if (event.target instanceof Element && event.target.closest('a[href], button[type="submit"], input[type="submit"]')) {
      event.preventDefault();
    }
    selected = uid;
    post({ type: 'select', payload: { uid } });
    schedule();
  };

  const setHovered = (uid: string | null) => {
    if (uid === hovered) return;
    hovered = uid;
    post({ type: 'hover', payload: { uid } });
    schedule();
  };
  const onPointerOver = (event: PointerEvent) => setHovered(blockOf(event.target)?.getAttribute(UID) ?? null);
  const onPointerLeave = () => setHovered(null);

  const mutations = new MutationObserver(schedule);
  mutations.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: [UID] });
  // Images loading and fonts arriving move blocks without changing the DOM.
  const resizes = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  resizes?.observe(doc.body);

  win.addEventListener('message', onMessage);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('pointerover', onPointerOver);
  doc.documentElement.addEventListener('pointerleave', onPointerLeave);
  win.addEventListener('scroll', schedule, { capture: true, passive: true });
  win.addEventListener('resize', schedule);

  const ready = () => post({ type: 'ready', payload: { path: win.location.pathname, sdkVersion: host.sdkVersion } });
  ready();
  schedule();

  return {
    navigated: () => {
      hovered = null;
      lastRects = '';
      ready();
      schedule();
    },
    stop: () => {
      win.removeEventListener('message', onMessage);
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('pointerover', onPointerOver);
      doc.documentElement.removeEventListener('pointerleave', onPointerLeave);
      win.removeEventListener('scroll', schedule, { capture: true });
      win.removeEventListener('resize', schedule);
      mutations.disconnect();
      resizes?.disconnect();
      if (frame !== null) (win.cancelAnimationFrame ?? win.clearTimeout)(frame);
      overlay.remove();
    },
  };
}

/** `richText` → `Rich text`. */
export function blockLabel(apiId: string): string {
  const words = apiId.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function labelOf(el: HTMLElement): string {
  return blockLabel(el.getAttribute(BLOCK) ?? 'Block');
}

interface Outline {
  rect: BridgeRect | undefined;
  label: string;
}

/**
 * The outlines, in a layer above the page that the pointer and assistive technology pass through. It sits
 * outside `<body>`, so drawing does not wake the bridge's own mutation observer.
 */
class Overlay {
  private readonly layer: HTMLElement;
  private readonly hover: HTMLElement;
  private readonly selected: HTMLElement;
  private readonly label: HTMLElement;

  constructor(doc: Document) {
    this.layer = doc.createElement('div');
    this.layer.setAttribute('aria-hidden', 'true');
    this.layer.setAttribute('data-novan-overlay', '');
    style(this.layer, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483647', overflow: 'hidden' });

    this.hover = doc.createElement('div');
    style(this.hover, { position: 'absolute', boxSizing: 'border-box', border: `2px dashed ${ACCENT}`, display: 'none' });
    this.selected = doc.createElement('div');
    style(this.selected, { position: 'absolute', boxSizing: 'border-box', border: `2px solid ${ACCENT}`, display: 'none' });
    this.label = doc.createElement('div');
    style(this.label, {
      position: 'absolute',
      display: 'none',
      padding: '0 6px',
      background: ACCENT,
      color: '#fff',
      font: '600 12px/20px system-ui, sans-serif',
      whiteSpace: 'nowrap',
      borderRadius: '3px',
    });
    this.layer.append(this.hover, this.selected, this.label);
    doc.documentElement.append(this.layer);
  }

  draw(hover: Outline | null, selected: Outline | null): void {
    place(this.hover, hover?.rect);
    place(this.selected, selected?.rect);
    const target = selected?.rect ? selected : hover;
    if (!target?.rect) {
      this.label.style.display = 'none';
      return;
    }
    this.label.textContent = target.label;
    // Above the block, or just inside it when the block starts at the top of the frame.
    const top = target.rect.y >= 22 ? target.rect.y - 22 : target.rect.y + 2;
    style(this.label, { display: 'block', left: `${Math.max(0, target.rect.x)}px`, top: `${top}px` });
  }

  remove(): void {
    this.layer.remove();
  }
}

function place(el: HTMLElement, rect: BridgeRect | undefined): void {
  if (!rect) {
    el.style.display = 'none';
    return;
  }
  style(el, { display: 'block', left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
}

function style(el: HTMLElement, values: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, values);
}

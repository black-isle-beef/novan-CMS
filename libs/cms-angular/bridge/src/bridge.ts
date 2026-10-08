import { type BridgeRect, bridgeEnvelope, type EditableText, type InsertPosition, parseAdminMessage, type SiteMessage } from './protocol';

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
/** Set by a block component on the element that shows a text field, e.g. `data-novan-field="heading"`. */
const FIELD = 'data-novan-field';
/** The editor's outline colour: 4.6:1 against white, for the label's white text. */
const ACCENT = '#0b5ed7';

/** Where the bridge runs; tests pass their own. */
export interface NovanBridgeEnvironment {
  window: Window;
  /** The admin's window; messages from anything else are ignored. */
  parent: Pick<Window, 'postMessage'>;
}

/** A text field being changed on the page. */
interface Editing {
  uid: string;
  field: EditableText;
  element: HTMLElement;
  /** The text before editing, put back on Escape. */
  original: string;
  stop(): void;
}

/**
 * Starts the visual editor bridge in a preview page inside the admin's frame. It outlines the block under
 * the pointer and the selected block (with the block's name) in an overlay above the page, tells the admin
 * which block was clicked or hovered and where every block is, and applies the admin's updates through the
 * host. It talks only to `host.adminOrigin`, and only to the frame's parent window.
 *
 * Once the admin says which text fields of the selected block may change (`editable`), the bridge also draws
 * "+" buttons above and below the block under the pointer (or the selected one) to add a block there, and a
 * double-click on one of those texts edits it in place.
 */
export function startNovanBridge(
  host: NovanBridgeHost,
  env: NovanBridgeEnvironment = { window, parent: window.parent },
): NovanBridgeHandle {
  const win = env.window;
  const doc = win.document;
  let hovered: string | null = null;
  let selected: string | null = null;
  /** What the admin lets the editor change; null until it says (read-only editors never get "+" buttons). */
  let editable: { uid: string | null; fields: EditableText[] } | null = null;
  let editing: Editing | null = null;
  let lastRects = '';
  let frame: number | null = null;

  const post = (message: SiteMessage) => env.parent.postMessage(bridgeEnvelope(message), host.adminOrigin);
  const blockOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>(`[${UID}]`) : null;
  const element = (uid: string | null): HTMLElement | null =>
    uid === null ? null : (Array.from(doc.querySelectorAll<HTMLElement>(`[${UID}]`)).find((el) => el.getAttribute(UID) === uid) ?? null);

  const overlay = new Overlay(doc, (position) => {
    const uid = overlay.insertTarget;
    if (uid) post({ type: 'insert', payload: { uid, position } });
  });

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
    // "+" buttons on the block under the pointer, else the selected one; none while text is being edited.
    const target = editable && !editing ? ((hovered && rects[hovered] ? hovered : null) ?? (selected && rects[selected] ? selected : null)) : null;
    overlay.drawInsert(target, target ? rects[target] : undefined);
    const json = JSON.stringify(rects);
    if (json !== lastRects) {
      lastRects = json;
      post({ type: 'rects', payload: rects });
    }
  };
  const schedule = () => {
    frame ??= (win.requestAnimationFrame ?? ((callback: () => void) => win.setTimeout(callback, 16)))(measure);
  };

  const finishEditing = (cancel: boolean) => {
    const current = editing;
    if (!current) return;
    editing = null;
    if (cancel) current.element.textContent = current.original;
    current.stop();
    post({ type: 'text', payload: { uid: current.uid, field: current.field.field, value: textOf(current), done: true } });
    schedule();
  };

  /** Starts editing the text field shown at `target` in the selected block, if there is one. */
  const startEditing = (target: EventTarget | null): boolean => {
    const block = blockOf(target);
    const uid = block?.getAttribute(UID);
    if (!block || !uid || !editable || editable.uid !== uid || !(target instanceof Element)) return false;
    const found = findTextField(block, target, editable.fields);
    if (!found) return false;
    finishEditing(false);
    const { element: el, field } = found;
    const before = el.getAttribute('contenteditable');
    el.setAttribute('contenteditable', 'plaintext-only');
    // Browsers without plaintext-only: typing still produces text, and only text is read back.
    if (el.isContentEditable === false) el.setAttribute('contenteditable', 'true');
    const onInput = () => {
      if (editing?.element === el) post({ type: 'text', payload: { uid, field: field.field, value: textOf(editing), done: false } });
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finishEditing(true);
      } else if (event.key === 'Enter' && !field.multiline) {
        event.preventDefault();
        finishEditing(false);
      }
    };
    const onBlur = () => finishEditing(false);
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKeydown);
    el.addEventListener('blur', onBlur);
    editing = {
      uid,
      field,
      element: el,
      original: el.textContent ?? '',
      stop: () => {
        el.removeEventListener('input', onInput);
        el.removeEventListener('keydown', onKeydown);
        el.removeEventListener('blur', onBlur);
        if (before === null) el.removeAttribute('contenteditable');
        else el.setAttribute('contenteditable', before);
      },
    };
    el.focus();
    schedule();
    return true;
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
      case 'editable':
        editable = message.payload;
        if (editing && editing.uid !== editable.uid) finishEditing(false);
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
    // Clicks inside the text being edited place the caret.
    if (editing && event.target instanceof Node && editing.element.contains(event.target)) return;
    selected = uid;
    post({ type: 'select', payload: { uid } });
    schedule();
  };

  const onDoubleClick = (event: MouseEvent) => {
    if (startEditing(event.target)) event.preventDefault();
  };

  const setHovered = (uid: string | null) => {
    if (uid === hovered) return;
    hovered = uid;
    post({ type: 'hover', payload: { uid } });
    schedule();
  };
  const onPointerOver = (event: PointerEvent) => {
    // Moving onto a "+" button keeps the block it belongs to.
    if (overlay.contains(event.target)) return;
    setHovered(blockOf(event.target)?.getAttribute(UID) ?? null);
  };
  const onPointerLeave = () => setHovered(null);

  const mutations = new MutationObserver(schedule);
  mutations.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: [UID] });
  // Images loading and fonts arriving move blocks without changing the DOM.
  const resizes = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  resizes?.observe(doc.body);

  win.addEventListener('message', onMessage);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('dblclick', onDoubleClick, true);
  doc.addEventListener('pointerover', onPointerOver);
  doc.documentElement.addEventListener('pointerleave', onPointerLeave);
  win.addEventListener('scroll', schedule, { capture: true, passive: true });
  win.addEventListener('resize', schedule);

  const ready = () => post({ type: 'ready', payload: { path: win.location.pathname, sdkVersion: host.sdkVersion } });
  ready();
  schedule();

  return {
    navigated: () => {
      finishEditing(false);
      hovered = null;
      lastRects = '';
      ready();
      schedule();
    },
    stop: () => {
      finishEditing(false);
      win.removeEventListener('message', onMessage);
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('dblclick', onDoubleClick, true);
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

const normalise = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

/**
 * The element showing one of `fields` at or above `target`, inside `block`: one the component marked with
 * `data-novan-field`, or else the nearest element whose whole text is the field's value. Text that appears
 * nowhere on its own (inside a sentence, or changed by the component) is edited in the admin's panel instead.
 */
function findTextField(
  block: Element,
  target: Element,
  fields: readonly EditableText[],
): { element: HTMLElement; field: EditableText } | null {
  const marked = target.closest<HTMLElement>(`[${FIELD}]`);
  if (marked && block.contains(marked) && blockOfElement(marked) === block) {
    const field = fields.find((f) => f.field === marked.getAttribute(FIELD));
    return field ? { element: marked, field } : null;
  }
  for (let el: Element | null = target; el && el !== block.parentElement; el = el.parentElement) {
    if (!(el instanceof HTMLElement) || blockOfElement(el) !== block) continue;
    const text = normalise(el.textContent);
    const field = text ? fields.find((f) => normalise(f.value) === text) : undefined;
    if (field) return { element: el, field };
  }
  return null;
}

function blockOfElement(el: Element): Element | null {
  return el.closest(`[${UID}]`);
}

/** The edited text as the field stores it: one line unless the field is multiline. */
function textOf(editing: Editing): string {
  const text = editing.element.innerText ?? editing.element.textContent ?? '';
  return editing.field.multiline ? text.replace(/\r\n?/g, '\n') : text.replace(/\s*[\r\n]+\s*/g, ' ');
}

interface Outline {
  rect: BridgeRect | undefined;
  label: string;
}

/**
 * The outlines, in a layer above the page that the pointer and assistive technology pass through (except the
 * "+" buttons, which take clicks). It sits outside `<body>`, so drawing does not wake the bridge's own mutation
 * observer. The buttons are for pointers; keyboard users add blocks from the admin's outline.
 */
class Overlay {
  private readonly layer: HTMLElement;
  private readonly hover: HTMLElement;
  private readonly selected: HTMLElement;
  private readonly label: HTMLElement;
  private readonly before: HTMLElement;
  private readonly after: HTMLElement;
  /** The block the "+" buttons are drawn for. */
  insertTarget: string | null = null;

  constructor(doc: Document, onInsert: (position: InsertPosition) => void) {
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
    this.before = insertButton(doc, 'before', onInsert);
    this.after = insertButton(doc, 'after', onInsert);
    this.layer.append(this.hover, this.selected, this.before, this.after, this.label);
    doc.documentElement.append(this.layer);
  }

  contains(target: EventTarget | null): boolean {
    return target instanceof Node && this.layer.contains(target);
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

  /** "+" buttons centred on the block's top and bottom edges. */
  drawInsert(uid: string | null, rect: BridgeRect | undefined): void {
    this.insertTarget = rect ? uid : null;
    for (const [button, y] of [
      [this.before, rect?.y],
      [this.after, rect ? rect.y + rect.height : undefined],
    ] as const) {
      if (!rect || y === undefined) {
        button.style.display = 'none';
        continue;
      }
      style(button, { display: 'block', left: `${rect.x + rect.width / 2 - 12}px`, top: `${y - 12}px` });
    }
  }

  remove(): void {
    this.layer.remove();
  }
}

function insertButton(doc: Document, position: InsertPosition, onInsert: (position: InsertPosition) => void): HTMLElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.tabIndex = -1;
  button.textContent = '+';
  button.title = position === 'before' ? 'Add a block above' : 'Add a block below';
  button.setAttribute('data-novan-insert', position);
  style(button, {
    position: 'absolute',
    display: 'none',
    width: '24px',
    height: '24px',
    padding: '0',
    border: '2px solid #fff',
    borderRadius: '50%',
    background: ACCENT,
    color: '#fff',
    font: '700 16px/18px system-ui, sans-serif',
    cursor: 'pointer',
    pointerEvents: 'auto',
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onInsert(position);
  });
  return button;
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

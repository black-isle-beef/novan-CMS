import { DestroyRef, DOCUMENT, inject, Injectable, signal } from '@angular/core';
import { type AdminMessage, bridgeEnvelope, type BridgeRect, type InsertPosition, parseSiteMessage } from '@novan/shared-types';

/** What the site said when its bridge started, or after it navigated. */
/** What the editor page does when the editor acts on the page. */
export interface BridgeListener {
  /** A block was clicked, even the one already selected. */
  select(uid: string): void;
  /** A "+" button next to a block was clicked. */
  insert(uid: string, position: InsertPosition): void;
  /** Text was typed on the page; `done` once the editor left it. */
  text(change: { uid: string; field: string; value: string; done: boolean }): void;
}

export interface BridgeReady {
  path: string;
  sdkVersion: string;
}

/**
 * The admin's end of the visual editor bridge (docs/build/12-visual-editor.md): talks to the client site in
 * the preview frame. Only messages from the frame's own window and the space's site origin are read; every
 * message is sent to that origin only. Provide it in the editor page.
 */
@Injectable()
export class PreviewBridge {
  private target: { frame: Window; origin: string } | null = null;

  /** Set when the site's bridge says it is ready; null until then and after {@link disconnect}. */
  readonly ready = signal<BridgeReady | null>(null);
  readonly hovered = signal<string | null>(null);
  /** The block the editor last clicked in the frame. */
  readonly selected = signal<string | null>(null);
  readonly rects = signal<Readonly<Record<string, BridgeRect>>>({});
  /** Told about clicks, inserts and typing on the page; set by the editor page. */
  listener: BridgeListener | null = null;

  constructor() {
    const window = inject(DOCUMENT).defaultView;
    const listener = (event: MessageEvent) => this.receive(event);
    window?.addEventListener('message', listener);
    inject(DestroyRef).onDestroy(() => window?.removeEventListener('message', listener));
  }

  /** Starts listening to the site in `frame`, at `siteUrl`'s origin. */
  connect(frame: Window, siteUrl: string): void {
    this.disconnect();
    this.target = { frame, origin: new URL(siteUrl).origin };
  }

  disconnect(): void {
    this.target = null;
    this.ready.set(null);
    this.hovered.set(null);
    this.rects.set({});
  }

  /** Sends a message to the site, once it is ready; false when there is nobody to send it to. */
  send(message: AdminMessage): boolean {
    if (!this.target || !this.ready()) return false;
    this.target.frame.postMessage(bridgeEnvelope(message), this.target.origin);
    return true;
  }

  private receive(event: MessageEvent): void {
    const target = this.target;
    if (!target || event.source !== target.frame || event.origin !== target.origin) return;
    const message = parseSiteMessage(event.data);
    if (!message) return;
    switch (message.type) {
      case 'ready':
        this.ready.set(message.payload);
        break;
      case 'select':
        this.selected.set(message.payload.uid);
        this.listener?.select(message.payload.uid);
        break;
      case 'hover':
        this.hovered.set(message.payload.uid);
        break;
      case 'rects':
        this.rects.set(message.payload);
        break;
      case 'insert':
        this.listener?.insert(message.payload.uid, message.payload.position);
        break;
      case 'text':
        this.listener?.text(message.payload);
        break;
    }
  }
}

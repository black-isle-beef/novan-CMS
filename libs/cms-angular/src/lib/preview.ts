import { isPlatformServer } from '@angular/common';
import {
  DestroyRef,
  DOCUMENT,
  effect,
  inject,
  Injectable,
  Injector,
  makeStateKey,
  PLATFORM_ID,
  REQUEST,
  RESPONSE_INIT,
  signal,
  TransferState,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { NOVAN_BRIDGE_LOADER, NOVAN_CMS_SERVER, type NovanBridgeHandle, type NovanPreviewVerdict } from './config';
import { CMS_ANGULAR_VERSION } from './package-info';
import type { NovanEntry } from './types';

/** The query parameter the admin opens preview links with. */
export const PREVIEW_PARAM = 'novan_preview';

/** What the visual editor's bridge needs to know about the session; no secrets. */
interface EditorSession {
  entryId: string;
  adminOrigin: string;
}

/** The server's verdict, so the browser agrees with the page it hydrates. */
interface Verdict {
  active: boolean;
  session: EditorSession | null;
}

const PREVIEW_STATE = makeStateKey<Verdict | boolean>('novan:preview');

/**
 * Preview mode: on when the page was opened with `?novan_preview=<signed token>` and the server's
 * `verifyPreview` accepts the token. Content then comes from the Preview API (drafts), nothing is cached,
 * unknown blocks are flagged and, when the page is open in the admin's visual editor, the bridge is loaded.
 * The token is kept for the rest of the visit, so preview stays on as the editor follows links; the admin
 * sends a fresh one before it expires.
 */
@Injectable({ providedIn: 'root' })
export class NovanPreview {
  private readonly injector = inject(Injector);
  private readonly server = isPlatformServer(inject(PLATFORM_ID));
  private readonly transferState = inject(TransferState);
  private readonly activeState = signal(false);
  private readonly sessionState = signal<EditorSession | null>(null);
  private readonly tokenState = signal<string | null>(this.readSignedToken());
  private readonly liveState = signal<Record<string, unknown> | null>(null);
  private verdict: Promise<boolean> | null = null;
  private bridge: NovanBridgeHandle | null = null;
  private bridgeStarted = false;

  /** Whether preview mode is on. Settled once {@link resolve} has finished. */
  readonly active = this.activeState.asReadonly();

  /** The visual editor's session, when the page is open in it. */
  readonly session = this.sessionState.asReadonly();

  /** The signed token preview requests carry: from the address the visit started at, or the admin's refresh. */
  get signedToken(): string | null {
    return this.tokenState();
  }

  /** Called once at start-up by `provideNovanCms`. */
  start(): void {
    void this.resolve().then((active) => {
      if (active && !this.server) void this.startBridge();
    });
  }

  /** Whether preview mode is on, checking the signed token once per visit. */
  resolve(): Promise<boolean> {
    this.verdict ??= this.decide().then(({ active, session }) => {
      this.activeState.set(active);
      this.sessionState.set(active ? session : null);
      return active;
    });
    return this.verdict;
  }

  /**
   * The page as the visual editor has it, unsaved changes included, when it is the page being edited;
   * otherwise the page itself. Read it in a `computed` so the page follows the editor's changes:
   *
   * ```ts
   * protected readonly shown = computed(() => this.preview.withLiveData(this.page()));
   * ```
   */
  withLiveData<T extends NovanEntry<unknown> | null>(page: T): T {
    const live = this.liveState();
    if (!page || !live || page.id !== this.sessionState()?.entryId) return page;
    return { ...page, data: live };
  }

  private async decide(): Promise<Verdict> {
    const token = this.signedToken;
    if (!this.server) {
      // The server checked the token when it rendered the page; the proxy checks it again on every request.
      const state = this.transferState.get(PREVIEW_STATE, token !== null);
      return typeof state === 'boolean' ? { active: state, session: null } : state;
    }
    let verdict: Verdict = { active: false, session: null };
    const options = this.injector.get(NOVAN_CMS_SERVER, null);
    if (token !== null && options?.previewToken && options.verifyPreview) {
      try {
        verdict = toVerdict(await options.verifyPreview(token));
      } catch {
        verdict = { active: false, session: null };
      }
    }
    this.transferState.set(PREVIEW_STATE, verdict);
    if (verdict.active) this.protectResponse(verdict.session);
    return verdict;
  }

  /** Drafts must never be stored by the CDN or the browser, and only the admin may frame them. */
  private protectResponse(session: EditorSession | null): void {
    const init = this.injector.get(RESPONSE_INIT, null);
    if (!init) return;
    const headers = new Headers(init.headers);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('Content-Security-Policy', `frame-ancestors 'self'${session ? ` ${session.adminOrigin}` : ''}`);
    init.headers = headers;
  }

  private async startBridge(): Promise<void> {
    const session = this.sessionState();
    const window = this.injector.get(DOCUMENT).defaultView;
    // Only inside the admin's frame: elsewhere there is nobody to talk to.
    if (this.bridgeStarted || !session || !window || window.parent === window) return;
    this.bridgeStarted = true;
    try {
      const { startNovanBridge } = await this.injector.get(NOVAN_BRIDGE_LOADER)();
      this.bridge = startNovanBridge({
        adminOrigin: session.adminOrigin,
        sdkVersion: CMS_ANGULAR_VERSION,
        update: (data) => this.liveState.set(data),
        token: (token) => this.tokenState.set(token),
      });
    } catch (error) {
      console.error('Novan CMS: the preview bridge could not be loaded.', error);
      return;
    }
    // Each navigation in the frame: the bridge tells the admin which page is showing now.
    const router = this.injector.get(Router, null);
    if (router) {
      const navigated = toSignal(router.events.pipe(filter((event) => event instanceof NavigationEnd)), {
        injector: this.injector,
        initialValue: null,
      });
      effect(
        () => {
          if (navigated()) untracked(() => this.bridge?.navigated());
        },
        { injector: this.injector },
      );
    }
    this.injector.get(DestroyRef).onDestroy(() => this.bridge?.stop());
  }

  private readSignedToken(): string | null {
    const href = this.injector.get(REQUEST, null)?.url ?? this.injector.get(DOCUMENT).location?.href;
    if (!href) return null;
    try {
      const value = new URL(href, 'http://relative.invalid').searchParams.get(PREVIEW_PARAM);
      return value && value.length <= 4096 ? value : null;
    } catch {
      return null;
    }
  }
}

function toVerdict(answer: NovanPreviewVerdict): Verdict {
  if (answer === true) return { active: true, session: null };
  if (typeof answer !== 'object' || answer === null) return { active: false, session: null };
  const { entryId, adminOrigin } = answer;
  if (typeof entryId !== 'string' || typeof adminOrigin !== 'string') return { active: false, session: null };
  let origin: string;
  try {
    origin = new URL(adminOrigin).origin;
  } catch {
    return { active: false, session: null };
  }
  // An origin goes into a response header and is the bridge's only trusted sender: http(s) only.
  return /^https?:\/\//.test(origin) ? { active: true, session: { entryId, adminOrigin: origin } } : { active: false, session: null };
}

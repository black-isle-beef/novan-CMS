import { isPlatformServer } from '@angular/common';
import {
  DOCUMENT,
  inject,
  Injectable,
  Injector,
  makeStateKey,
  PLATFORM_ID,
  REQUEST,
  RESPONSE_INIT,
  signal,
  TransferState,
} from '@angular/core';
import { NOVAN_BRIDGE_LOADER, NOVAN_CMS_SERVER } from './config';

/** The query parameter the admin opens preview links with. */
export const PREVIEW_PARAM = 'novan_preview';

/** The server's verdict, so the browser agrees with the page it hydrates. */
const PREVIEW_STATE = makeStateKey<boolean>('novan:preview');

/**
 * Preview mode: on when the page was opened with `?novan_preview=<signed token>` and the server's
 * `verifyPreview` accepts the token. Content then comes from the Preview API (drafts), nothing is cached,
 * unknown blocks are flagged and the visual editor bridge is loaded. The token is kept for the rest of the
 * visit, so preview stays on as the editor follows links.
 */
@Injectable({ providedIn: 'root' })
export class NovanPreview {
  private readonly injector = inject(Injector);
  private readonly server = isPlatformServer(inject(PLATFORM_ID));
  private readonly transferState = inject(TransferState);
  private readonly activeState = signal(false);
  private verdict: Promise<boolean> | null = null;
  private bridgeStarted = false;

  /** The signed token from the address the visit started at, or null. */
  readonly signedToken: string | null = this.readSignedToken();

  /** Whether preview mode is on. Settled once {@link resolve} has finished. */
  readonly active = this.activeState.asReadonly();

  /** Called once at start-up by `provideNovanCms`. */
  start(): void {
    void this.resolve().then((active) => {
      if (active && !this.server) void this.startBridge();
    });
  }

  /** Whether preview mode is on, checking the signed token once per visit. */
  resolve(): Promise<boolean> {
    this.verdict ??= this.decide().then((active) => {
      this.activeState.set(active);
      return active;
    });
    return this.verdict;
  }

  private async decide(): Promise<boolean> {
    const token = this.signedToken;
    if (!this.server) {
      // The server checked the token when it rendered the page; the proxy checks it again on every request.
      return this.transferState.get(PREVIEW_STATE, token !== null);
    }
    let active = false;
    const options = this.injector.get(NOVAN_CMS_SERVER, null);
    if (token !== null && options?.previewToken && options.verifyPreview) {
      try {
        active = (await options.verifyPreview(token)) === true;
      } catch {
        active = false;
      }
    }
    this.transferState.set(PREVIEW_STATE, active);
    if (active) this.disableResponseCaching();
    return active;
  }

  /** Drafts must never be stored by the CDN or the browser. */
  private disableResponseCaching(): void {
    const init = this.injector.get(RESPONSE_INIT, null);
    if (!init) return;
    const headers = new Headers(init.headers);
    headers.set('Cache-Control', 'private, no-store');
    init.headers = headers;
  }

  private async startBridge(): Promise<void> {
    if (this.bridgeStarted) return;
    this.bridgeStarted = true;
    try {
      const bridge = await this.injector.get(NOVAN_BRIDGE_LOADER)();
      bridge.startNovanBridge();
    } catch (error) {
      console.error('Novan CMS: the preview bridge could not be loaded.', error);
    }
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

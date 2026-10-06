import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  type ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsAlertComponent } from '@black-isle-beef/novan-design-system';
import { ContentApi } from '@novan/admin-content';
import { copy, Skeleton } from '@novan/admin-shell';
import { problemMessage, SpaceContext } from '@novan/admin-spaces';
import { type BlockType, type Entry, entryTitle, type SignedPreviewToken, sitePath } from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { EditorApi } from '../editor-api';
import { findBlock } from '../find-block';
import { PreviewBridge } from '../preview-bridge';

export type Device = 'mobile' | 'tablet' | 'desktop';
export type View = 'draft' | 'live';

/** The screen sizes the preview can take, in CSS pixels. */
export const DEVICES: readonly { id: Device; label: string; width: number; icon: string }[] = [
  { id: 'mobile', label: 'Mobile', width: 375, icon: 'phone' },
  { id: 'tablet', label: 'Tablet', width: 768, icon: 'tablet' },
  { id: 'desktop', label: 'Desktop', width: 1280, icon: 'display' },
];

/** A new preview token is fetched this long before the current one expires. */
export const REFRESH_BEFORE_MS = 2 * 60_000;
/** After a failed refresh, the next try. */
const RETRY_MS = 30_000;

/**
 * The visual editor (docs/build/12-visual-editor.md): the page on the space's real site, in a frame, opened in
 * preview mode with a signed token. The editor picks a screen size and switches between the draft and the
 * live page; clicking a block on the page selects it. The token is renewed before it expires and handed to
 * the site through the bridge, so the frame never reloads for it.
 */
@Component({
  selector: 'nv-visual-editor-page',
  imports: [DsAlertComponent, RouterLink, Skeleton],
  providers: [PreviewBridge],
  templateUrl: './visual-editor-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisualEditorPage {
  private readonly content = inject(ContentApi);
  private readonly api = inject(EditorApi);
  protected readonly context = inject(SpaceContext);
  protected readonly bridge = inject(PreviewBridge);
  protected readonly copy = copy;
  protected readonly devices = DEVICES;

  /** Route parameters (component input binding). */
  readonly spaceId = input.required<string>();
  readonly entryId = input.required<string>();

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly entry = signal<Entry | null>(null);
  private readonly blockTypes = signal<BlockType[]>([]);

  protected readonly device = signal<Device>('desktop');
  protected readonly view = signal<View>('draft');
  private readonly token = signal<SignedPreviewToken | null>(null);
  /** The token the frame was opened with; a refresh goes through the bridge and leaves the address alone. */
  private readonly openedWith = signal<string | null>(null);

  private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');

  protected readonly title = computed(() => {
    const entry = this.entry();
    return entry ? entryTitle(entry.data, entry.slug) : '';
  });
  protected readonly deviceWidth = computed(() => DEVICES.find((d) => d.id === this.device())?.width ?? 1280);
  protected readonly published = computed(() => Boolean(this.entry()?.publishedPath));

  /** The space's site, when it has a usable address. */
  protected readonly siteUrl = computed(() => {
    const url = this.context.currentSpace()?.previewUrl?.replace(/\/+$/, '');
    return url && /^https?:\/\/[^/]/i.test(url) ? url : null;
  });

  /**
   * The frame's address: the draft in preview mode, or the live page. Built only from the space's own http(s)
   * address, a stored page path and an encoded token, so it is set on the frame directly (see the constructor)
   * rather than through Angular's resource-URL sanitizer, which would add its code to every admin page.
   */
  protected readonly frameUrl = computed(() => {
    const site = this.siteUrl();
    const entry = this.entry();
    if (!site || !entry) return null;
    if (this.view() === 'live') return entry.publishedPath ? `${site}${sitePath(entry.publishedPath)}` : null;
    const token = this.openedWith();
    return token ? `${site}${sitePath(entry.path)}?novan_preview=${encodeURIComponent(token)}` : null;
  });

  /** The block clicked on the page, with its type's name. */
  protected readonly selection = computed(() => {
    const block = findBlock(this.entry()?.data, this.bridge.selected());
    if (!block) return null;
    return { block, name: this.blockTypes().find((t) => t.apiId === block._block)?.name ?? block._block };
  });

  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      const entryId = this.entryId();
      untracked(() => {
        this.context.currentSpaceId.set(spaceId);
        void this.load(spaceId, entryId);
      });
    });
    // A new address: load it, and listen to the frame's new page (it says when it is ready).
    effect(() => {
      const url = this.frameUrl();
      const frame = this.frame()?.nativeElement;
      const site = this.siteUrl();
      untracked(() => {
        if (!url || !frame || !site) {
          this.bridge.disconnect();
          return;
        }
        if (frame.getAttribute('src') !== url) frame.src = url;
        if (this.view() === 'draft' && frame.contentWindow) this.bridge.connect(frame.contentWindow, site);
        else this.bridge.disconnect();
      });
    });
    inject(DestroyRef).onDestroy(() => this.cancelRefresh());
  }

  protected setDevice(device: Device): void {
    this.device.set(device);
  }

  protected setView(view: View): void {
    if (view === 'live' && !this.published()) return;
    // Back to the draft: open it with the current token.
    if (view === 'draft') this.openedWith.set(this.token()?.token ?? null);
    this.view.set(view);
  }

  private async load(spaceId: string, entryId: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    this.cancelRefresh();
    try {
      const [entry, blockTypes, token] = await Promise.all([
        firstValueFrom(this.content.getEntry(spaceId, entryId)),
        firstValueFrom(this.content.listBlockTypes(spaceId)),
        firstValueFrom(this.api.previewToken(spaceId, entryId)),
      ]);
      this.entry.set(entry);
      this.blockTypes.set(blockTypes);
      this.useToken(token);
      this.openedWith.set(token.token);
    } catch (error) {
      this.loadError.set(problemMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private useToken(token: SignedPreviewToken): void {
    this.token.set(token);
    const due = Date.parse(token.expiresAt) - REFRESH_BEFORE_MS - Date.now();
    this.scheduleRefresh(Math.max(due, 0));
  }

  /** Renews the token and hands it to the site, which uses it for everything it loads from then on. */
  private async refresh(): Promise<void> {
    this.refreshTimer = null;
    try {
      const token = await firstValueFrom(this.api.previewToken(this.spaceId(), this.entryId()));
      this.useToken(token);
      this.bridge.send({ type: 'token', payload: { token: token.token } });
      this.problem.set(null);
    } catch (error) {
      this.problem.set(`The preview could not be renewed: ${problemMessage(error)} Trying again shortly.`);
      this.scheduleRefresh(RETRY_MS);
    }
  }

  private scheduleRefresh(ms: number): void {
    this.cancelRefresh();
    this.refreshTimer = setTimeout(() => void this.refresh(), ms);
  }

  private cancelRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }
}

import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  effect,
  type ElementRef,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsAlertComponent } from '@black-isle-beef/novan-design-system';
import { ContentApi } from '@novan/admin-content';
import { errorsFromIssues, FieldFormContext, newBlock } from '@novan/admin-fields';
import { MediaPicker, MediaPickerDialog } from '@novan/admin-media';
import { copy, type HasUnsavedChanges, Shortcuts, shortcutKeys, Skeleton, warnBeforeUnload } from '@novan/admin-shell';
import { problemMessage, SpaceContext } from '@novan/admin-spaces';
import {
  type BlockNode,
  type BlockType,
  buildEntrySchema,
  type ContentType,
  type Entry,
  type EntryData,
  entryTitle,
  sameJson,
  type SignedPreviewToken,
  sitePath,
} from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';
import { BlockOutline, type BlockMove, type BlockSlot } from '../block-outline/block-outline';
import { BlockPanel } from '../block-panel/block-panel';
import { BlockPicker } from '../block-picker/block-picker';
import {
  blocksAt,
  canHold,
  childList,
  copyBlock,
  dottedPath,
  insertBlock,
  isBlockNode,
  locate,
  moveBlock,
  outline,
  removeBlock,
  replaceBlock,
  rootLists,
  textFields,
} from '../block-tree';
import { EditorApi } from '../editor-api';
import { EditorStore } from '../editor-store';
import { getIn } from '../patches';
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
/** Changes reach the preview this long after the last one. */
export const PREVIEW_DEBOUNCE_MS = 150;
/** Unsaved changes are saved as a draft this often. */
export const AUTOSAVE_EVERY_MS = 5000;

const clock = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

/**
 * The visual editor (docs/build/12-visual-editor.md): the page on the space's real site, in a frame opened in
 * preview mode with a signed token. Editors select blocks on the page or in the outline, change their fields and
 * style in the side panel or their text on the page, add blocks from the picker, reorder, hide, duplicate and
 * delete them, and undo. Every change reaches the site within moments, without a reload; drafts are saved every
 * few seconds. The token is renewed before it expires and handed to the site through the bridge.
 */
@Component({
  selector: 'nv-visual-editor-page',
  imports: [BlockOutline, BlockPanel, BlockPicker, DsAlertComponent, MediaPickerDialog, RouterLink, Skeleton],
  providers: [PreviewBridge, EditorStore, FieldFormContext, MediaPicker],
  templateUrl: './visual-editor-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisualEditorPage implements HasUnsavedChanges {
  private readonly content = inject(ContentApi);
  private readonly api = inject(EditorApi);
  private readonly form = inject(FieldFormContext);
  private readonly media = inject(MediaPicker);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  protected readonly context = inject(SpaceContext);
  protected readonly bridge = inject(PreviewBridge);
  protected readonly store = inject(EditorStore);
  protected readonly copy = copy;
  protected readonly devices = DEVICES;
  protected readonly shortcutKeys = shortcutKeys;

  /** Route parameters (component input binding). */
  readonly spaceId = input.required<string>();
  readonly entryId = input.required<string>();

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly entry = signal<Entry | null>(null);
  private readonly contentType = signal<ContentType | null>(null);
  protected readonly blockTypes = signal<BlockType[]>([]);

  protected readonly device = signal<Device>('desktop');
  protected readonly view = signal<View>('draft');
  private readonly token = signal<SignedPreviewToken | null>(null);
  /** The token the frame was opened with; a refresh goes through the bridge and leaves the address alone. */
  private readonly openedWith = signal<string | null>(null);

  protected readonly busy = signal<'saving' | 'autosaving' | 'publishing' | null>(null);
  private readonly savedAt = signal<Date | null>(null);
  protected readonly status = signal<string | null>(null);
  /** Polite announcement of the last change, for screen reader users. */
  protected readonly announcement = signal('');
  /** Where the block picker adds a block, while it is open. */
  private readonly slot = signal<BlockSlot | null>(null);
  /** The block whose text is being typed on the page: the site already shows it, so no update is sent. */
  private readonly typingIn = signal<string | null>(null);
  /** A block just added: scrolled to once the site has drawn it. */
  private readonly scrollPending = signal<string | null>(null);

  private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');

  protected readonly title = computed(() => {
    const entry = this.entry();
    return entry ? entryTitle(this.store.data(), entry.slug) : '';
  });
  protected readonly deviceWidth = computed(() => DEVICES.find((d) => d.id === this.device())?.width ?? 1280);
  protected readonly published = computed(() => Boolean(this.entry()?.publishedPath));
  protected readonly canEdit = computed(() => this.context.canEditCurrent());
  protected readonly canPublish = computed(() => this.context.canPublishCurrent());

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

  // --- Blocks ---

  private readonly roots = computed(() => rootLists(this.contentType()?.fields ?? [], this.blockTypes()));
  protected readonly outline = computed(() => outline(this.store.data(), this.roots(), this.blockTypes()));
  protected readonly selection = computed(() => locate(this.store.data(), this.roots(), this.blockTypes(), this.store.selected()));
  protected readonly selectionType = computed(() => {
    const place = this.selection();
    return place ? this.typeOf(place.node._block) : undefined;
  });
  protected readonly selectionName = computed(() => this.nameOf(this.selection()?.node));
  protected readonly selectionPath = computed(() => {
    const place = this.selection();
    return place ? dottedPath(place) : '';
  });
  /** The block before the selected one, when it can hold it. */
  private readonly intoTarget = computed(() => {
    const place = this.selection();
    if (!place || place.index === 0) return null;
    const before = blocksAt(this.store.data(), place.list)[place.index - 1];
    const list = before ? childList([...place.list.path, place.index - 1], this.typeOf(before._block)) : null;
    return before && list && canHold(list, place.node._block) ? { node: before, list } : null;
  });
  /** The block the selected one is in, when its list can hold it. */
  private readonly outTarget = computed(() => {
    const place = this.selection();
    if (!place?.parent) return null;
    const parent = locate(this.store.data(), this.roots(), this.blockTypes(), place.parent._uid);
    return parent && canHold(parent.list, place.node._block) ? parent : null;
  });
  protected readonly intoName = computed(() => this.nameOf(this.intoTarget()?.node));
  protected readonly outOfName = computed(() => this.nameOf(this.outTarget()?.node));
  protected readonly picker = computed(() => {
    const slot = this.slot();
    if (!slot) return null;
    const types = slot.list.allowed.flatMap((apiId) => this.blockTypes().filter((type) => type.apiId === apiId));
    const parent = slot.list.path[slot.list.path.length - 1] === 'children' ? getIn(this.store.data(), slot.list.path.slice(0, -1)) : null;
    return { types, where: isBlockNode(parent) ? `inside ${this.nameOf(parent)}` : `to ${slot.list.label}` };
  });

  // --- Validation and saving ---

  /** Drafts may be incomplete but never malformed (a bad web address, say): those errors show at once. */
  private readonly draftSchema = computed(() => {
    const type = this.contentType();
    this.form.assets();
    return type ? buildEntrySchema(type.fields, { blockTypes: this.blockTypes(), draft: true, assets: (id) => this.form.assetInfo(id) }) : null;
  });
  private readonly draftErrors = computed<Record<string, string[]>>(() => {
    const result = this.draftSchema()?.safeParse(this.store.data());
    return result && !result.success ? errorsFromIssues(result.error.issues) : {};
  });

  protected readonly saveState = computed(() => {
    switch (this.busy()) {
      case 'saving':
      case 'autosaving':
        return 'Saving…';
      case 'publishing':
        return 'Publishing…';
    }
    if (Object.keys(this.draftErrors()).length) return 'Some fields need attention before the draft can be saved.';
    if (this.store.dirty()) return this.canEdit() ? 'Changes not saved yet.' : '';
    const at = this.savedAt();
    return at ? `All changes saved at ${clock.format(at)}.` : '';
  });

  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** What the site shows: the saved draft when it loads, then each update sent. */
  private shown: EntryData | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  /** Counts preview requests, so only the latest one reaches the site. */
  private previewRequest = 0;

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      const entryId = this.entryId();
      untracked(() => {
        this.context.currentSpaceId.set(spaceId);
        this.media.connect(this.form, spaceId);
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
    effect(() => this.form.errors.set(this.draftErrors()));
    effect(() => this.form.readonly.set(!this.canEdit()));

    // Changes go to the site, in the shape it reads, once the editor pauses.
    let readyFor: object | null = null;
    effect(() => {
      const data = this.store.data();
      const ready = this.bridge.ready();
      const entry = this.entry();
      if (!ready || !entry || this.typingIn()) return;
      // The site (re)loaded: it shows the saved draft.
      if (ready !== readyFor) {
        readyFor = ready;
        this.shown = untracked(() => entry.data);
      }
      if (!this.shown || !sameJson(this.shown, data)) untracked(() => this.queuePreview(data));
    });

    // What the editor may change on the page: the selected block's plain text fields.
    effect(() => {
      const ready = this.bridge.ready();
      const place = this.selection();
      const type = this.selectionType();
      if (!ready || !this.canEdit()) return;
      untracked(() =>
        this.bridge.send({ type: 'editable', payload: { uid: place?.node._uid ?? null, fields: place ? textFields(place.node, type) : [] } }),
      );
    });
    // A block just added is scrolled to once the site has drawn it.
    effect(() => {
      const uid = this.scrollPending();
      if (uid && this.bridge.rects()[uid]) {
        untracked(() => {
          this.scrollPending.set(null);
          this.bridge.send({ type: 'scrollTo', payload: { uid } });
        });
      }
    });

    this.bridge.listener = {
      select: (uid) => this.store.selected.set(uid),
      insert: (uid, position) => {
        const place = locate(this.store.data(), this.roots(), this.blockTypes(), uid);
        if (place && this.canEdit()) this.openPicker({ list: place.list, index: position === 'before' ? place.index : place.index + 1 });
      },
      text: (change) => this.typed(change),
    };

    const destroyRef = inject(DestroyRef);
    let autosave: ReturnType<typeof setTimeout> | undefined;
    let destroyed = false;
    const nextAutosave = () => {
      if (!destroyed) autosave = setTimeout(() => void this.autosave().finally(nextAutosave), AUTOSAVE_EVERY_MS);
    };
    nextAutosave();
    destroyRef.onDestroy(() => {
      destroyed = true;
      this.cancelRefresh();
      clearTimeout(autosave);
      clearTimeout(this.previewTimer);
    });
    const shortcuts = inject(Shortcuts);
    shortcuts.register('save', () => void this.save());
    shortcuts.register('publish', () => void this.publish());
    this.listenForUndo(destroyRef);
    warnBeforeUnload(() => this.hasUnsavedChanges());
  }

  /** Changes the person could still lose (autosave may be pending). */
  hasUnsavedChanges(): boolean {
    return this.canEdit() && this.store.dirty();
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

  // --- Blocks ---

  /** Selects a block from the outline: outlined and scrolled to on the page. */
  protected select(uid: string): void {
    this.store.selected.set(uid);
    this.bridge.send({ type: 'select', payload: { uid } });
    this.bridge.send({ type: 'scrollTo', payload: { uid } });
  }

  /** Applies the panel's changed keys to the block as it is now. */
  protected changeBlock(changes: Partial<BlockNode>): void {
    const place = this.selection();
    if (!place) return;
    const node = { ...place.node, ...changes, _uid: place.node._uid, _block: place.node._block };
    this.store.change(replaceBlock(this.store.data(), place, node), `${node._uid}.${Object.keys(changes).sort().join(',')}`);
  }

  protected openPicker(slot: BlockSlot): void {
    this.slot.set(slot);
  }

  protected closePicker(): void {
    this.slot.set(null);
  }

  protected addBlock(type: BlockType): void {
    const slot = this.slot();
    this.slot.set(null);
    if (!slot) return;
    const node = newBlock(type);
    this.store.change(insertBlock(this.store.data(), slot.list, slot.index, node));
    this.select(node._uid);
    this.scrollPending.set(node._uid);
    this.announcement.set(`Added a ${type.name} block. Its fields are in the panel.`);
    this.focusPanel();
  }

  protected moveTo(move: BlockMove): void {
    const moved = moveBlock(this.store.data(), move.from, move.to, move.index);
    const name = this.nameOf(move.from.node);
    if (!moved) {
      this.announcement.set(`A ${name} block cannot go there.`);
      return;
    }
    this.store.change(moved);
    const place = locate(moved, this.roots(), this.blockTypes(), move.from.node._uid);
    if (place) this.announcement.set(`${name} moved to position ${place.index + 1} of ${blocksAt(moved, place.list).length}.`);
  }

  protected moveInto(): void {
    const place = this.selection();
    const target = this.intoTarget();
    if (!place || !target) return;
    this.moveTo({ from: place, to: target.list, index: blocksAt(this.store.data(), target.list).length });
    // The button pressed may be gone now: carry on from the block in the outline.
    this.focus(`nv-outline-select-${place.node._uid}`);
  }

  protected moveOut(): void {
    const place = this.selection();
    const parent = this.outTarget();
    if (!place || !parent) return;
    this.moveTo({ from: place, to: parent.list, index: parent.index + 1 });
    this.focus(`nv-outline-select-${place.node._uid}`);
  }

  protected duplicate(): void {
    const place = this.selection();
    if (!place) return;
    const node = copyBlock(place.node);
    this.store.change(insertBlock(this.store.data(), place.list, place.index + 1, node));
    this.select(node._uid);
    this.announcement.set(`Duplicated the ${this.nameOf(place.node)} block. The copy is selected.`);
  }

  protected toggleHidden(): void {
    const place = this.selection();
    if (!place) return;
    const node = { ...place.node };
    if (node._hidden) delete node._hidden;
    else node._hidden = true;
    this.store.change(replaceBlock(this.store.data(), place, node));
    this.announcement.set(node._hidden ? `${this.nameOf(node)} is hidden on the site.` : `${this.nameOf(node)} is shown on the site again.`);
  }

  protected remove(): void {
    const place = this.selection();
    if (!place) return;
    this.store.change(removeBlock(this.store.data(), place));
    this.store.selected.set(null);
    this.announcement.set(`Deleted the ${this.nameOf(place.node)} block. Undo brings it back.`);
    this.focus(`nv-outline-heading`);
  }

  protected undo(): void {
    if (this.canEdit() && this.store.undo()) this.announcement.set('Undone.');
  }

  protected redo(): void {
    if (this.canEdit() && this.store.redo()) this.announcement.set('Redone.');
  }

  /** Text typed on the page: one undo step per field while typing; the site already shows it. */
  private typed({ uid, field, value, done }: { uid: string; field: string; value: string; done: boolean }): void {
    const place = locate(this.store.data(), this.roots(), this.blockTypes(), uid);
    const editable = place && this.canEdit() && textFields(place.node, this.typeOf(place.node._block)).some((f) => f.field === field);
    if (!place || !editable) return;
    this.typingIn.set(done ? null : uid);
    this.store.change(replaceBlock(this.store.data(), place, { ...place.node, [field]: value }), `${uid}.${field}`);
  }

  /** Sends the data to the site once the editor pauses, in the shape it reads; a newer change wins. */
  private queuePreview(data: EntryData): void {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => void this.sendPreview(data), PREVIEW_DEBOUNCE_MS);
  }

  private async sendPreview(data: EntryData): Promise<void> {
    const request = ++this.previewRequest;
    try {
      const page = await firstValueFrom(this.api.previewData(this.spaceId(), this.entryId(), data));
      if (request !== this.previewRequest) return;
      this.shown = data;
      this.bridge.send({ type: 'update', payload: { data: page.data } });
    } catch {
      // Malformed data (being typed) is not shown; the site keeps the last good version.
    }
  }

  // --- Saving ---

  protected async save(): Promise<void> {
    if (!this.canEdit() || this.busy() || !this.entry()) return;
    if (Object.keys(this.draftErrors()).length) {
      this.problem.set('Some fields need attention before the draft can be saved. They are marked in the block panel.');
      return;
    }
    const data = this.store.data();
    await this.run('saving', async () => {
      this.afterSave(await firstValueFrom(this.content.saveEntry(this.spaceId(), this.entryId(), data)), data);
      this.status.set('Draft saved.');
    });
  }

  protected async publish(): Promise<void> {
    if (!this.canPublish() || this.busy() || !this.entry()) return;
    const data = this.store.data();
    await this.run('publishing', async () => {
      if (this.store.dirty()) this.afterSave(await firstValueFrom(this.content.saveEntry(this.spaceId(), this.entryId(), data)), data);
      const entry = await firstValueFrom(this.content.publish(this.spaceId(), this.entryId()));
      this.entry.set(entry);
      this.status.set(`Published. It is live at ${sitePath(entry.publishedPath ?? entry.path)}.`);
    });
  }

  /** Saves quietly every few seconds; a draft with malformed values waits until they are fixed. */
  private async autosave(): Promise<void> {
    if (!this.canEdit() || this.busy() || !this.entry() || !this.store.dirty() || this.typingIn()) return;
    if (Object.keys(this.draftErrors()).length) return;
    const data = this.store.data();
    this.busy.set('autosaving');
    try {
      this.afterSave(await firstValueFrom(this.content.autosaveEntry(this.spaceId(), this.entryId(), data)), data);
    } catch (error) {
      this.problem.set(`Your changes could not be saved: ${problemMessage(error)}`);
    } finally {
      this.busy.set(null);
    }
  }

  private async run(busy: 'saving' | 'publishing', action: () => Promise<void>): Promise<void> {
    this.busy.set(busy);
    this.problem.set(null);
    this.status.set(null);
    try {
      await action();
    } catch (error) {
      this.problem.set(problemMessage(error));
    } finally {
      this.busy.set(null);
    }
  }

  private afterSave(entry: Entry, data: EntryData): void {
    this.entry.set(entry);
    this.store.markSaved(data);
    this.savedAt.set(new Date());
    this.problem.set(null);
  }

  // --- Loading ---

  private async load(spaceId: string, entryId: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    this.cancelRefresh();
    try {
      const [entry, types, blockTypes, entries, token] = await Promise.all([
        firstValueFrom(this.content.getEntry(spaceId, entryId)),
        firstValueFrom(this.content.listContentTypes(spaceId)),
        firstValueFrom(this.content.listBlockTypes(spaceId)),
        firstValueFrom(this.content.listEntries(spaceId)),
        firstValueFrom(this.api.previewToken(spaceId, entryId)),
      ]);
      const type = types.find((t) => t.apiId === entry.contentType) ?? null;
      if (!type) {
        this.loadError.set('The type of this page no longer exists.');
        return;
      }
      this.contentType.set(type);
      this.blockTypes.set(blockTypes);
      this.form.blockTypes.set(blockTypes);
      this.form.entries.set(entries.map(({ id, title, contentType, path }) => ({ id, title, contentType, path })));
      this.entry.set(entry);
      this.store.load(entry.data);
      this.store.selected.set(null);
      this.shown = entry.data;
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

  // --- Helpers ---

  /** Ctrl+Z undoes and Ctrl+Shift+Z or Ctrl+Y redoes (⌘ on a Mac), except while typing in a field. */
  private listenForUndo(destroyRef: DestroyRef): void {
    const listener = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        this.undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        this.redo();
      }
    };
    this.document.addEventListener('keydown', listener);
    destroyRef.onDestroy(() => this.document.removeEventListener('keydown', listener));
  }

  private typeOf(apiId: string): BlockType | undefined {
    return this.blockTypes().find((type) => type.apiId === apiId);
  }

  private nameOf(node: BlockNode | null | undefined): string | null {
    return node ? (this.typeOf(node._block)?.name ?? node._block) : null;
  }

  private focusPanel(): void {
    afterNextRender(
      () => this.document.getElementById('nv-editor-panel')?.querySelector<HTMLElement>('input, select, textarea, [contenteditable="true"]')?.focus(),
      { injector: this.injector },
    );
  }

  private focus(id: string): void {
    afterNextRender(() => this.document.getElementById(id)?.focus(), { injector: this.injector });
  }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName));
}

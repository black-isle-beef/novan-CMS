import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { type FieldDefOf, sameJson } from '@novan/shared-schemas';
import { Editor, type JSONContent } from '@tiptap/core';
import { FieldControl } from '../field-control';
import { FieldMessages } from '../field-messages/field-messages';
import { richTextExtensions, type RichTextTool, richTextTools, safeHref } from './rich-text-tools';

const linkTool: RichTextTool = {
  key: 'link',
  label: 'Link',
  icon: 'link-45deg',
  toggle: true,
  isActive: (e) => e.isActive('link'),
  // Opens the link form instead; see RichTextField.apply.
  run: () => undefined,
};

/**
 * Formatted text edited with Tiptap and stored as ProseMirror JSON. Only the marks and nodes the field
 * allows are available, in the toolbar and when pasting. An empty editor stores nothing.
 */
@Component({
  selector: 'nv-rich-text-field',
  imports: [FieldMessages],
  templateUrl: './rich-text-field.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RichTextField extends FieldControl<FieldDefOf<'richText'>> {
  private readonly editorHost = viewChild.required<ElementRef<HTMLElement>>('editorHost');
  private readonly toolbar = viewChild<ElementRef<HTMLElement>>('toolbar');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private editor: Editor | null = null;

  /** Bumped on every editor transaction, so the toolbar's pressed states recompute. */
  private readonly revision = signal(0);

  protected readonly labelId = computed(() => `${this.id()}-label`);
  protected readonly tools = computed(() => {
    const tools = richTextTools(this.field());
    return this.field().marks.includes('link') ? [...tools, linkTool] : tools;
  });
  /** The one toolbar button in the tab order (roving tabindex). */
  protected readonly focusIndex = signal(0);

  protected readonly linkEditing = signal(false);
  protected readonly linkHref = signal('');
  protected readonly linkError = signal<string | null>(null);
  protected readonly linkErrors = computed(() => {
    const error = this.linkError();
    return error ? [error] : [];
  });

  private readonly attributes = computed<Record<string, string>>(() => {
    const describedBy = this.describedBy();
    return {
      id: this.id(),
      class: `form-control nv-rich-text${this.invalid() ? ' is-invalid' : ''}`,
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-labelledby': this.labelId(),
      ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      ...(this.invalid() ? { 'aria-invalid': 'true' } : {}),
      ...(this.field().required ? { 'aria-required': 'true' } : {}),
    };
  });

  constructor() {
    super();
    afterNextRender(() => this.createEditor());
    // A value changed elsewhere (a restored version) replaces the editor's content.
    effect(() => {
      const value = this.value();
      untracked(() => {
        const editor = this.editor;
        if (!editor || sameJson(currentValue(editor), value ?? null)) return;
        editor.commands.setContent(isDoc(value) ? value : '', { emitUpdate: false });
      });
    });
    effect(() => {
      const attributes = this.attributes();
      untracked(() => this.editor?.setOptions({ editorProps: { attributes } }));
    });
    effect(() => {
      const editable = !this.disabled();
      untracked(() => this.editor?.setEditable(editable, false));
    });
    inject(DestroyRef).onDestroy(() => this.editor?.destroy());
  }

  protected isActive(tool: RichTextTool): boolean {
    this.revision();
    return this.editor ? tool.isActive(this.editor) : false;
  }

  protected apply(tool: RichTextTool): void {
    const editor = this.editor;
    if (!editor) return;
    if (tool === linkTool) {
      this.linkHref.set(String(editor.getAttributes('link')['href'] ?? ''));
      this.linkError.set(null);
      this.linkEditing.set(true);
      this.focus(`${this.id()}-link-href`);
      return;
    }
    tool.run(editor);
  }

  protected setLinkHref(event: Event): void {
    this.linkHref.set((event.target as HTMLInputElement).value.trim());
  }

  protected saveLink(): void {
    const editor = this.editor;
    if (!editor) return;
    const href = this.linkHref();
    if (!href) {
      this.removeLink();
      return;
    }
    if (!safeHref.test(href)) {
      this.linkError.set('Links must start with https://, http://, mailto:, tel:, / or #.');
      this.focus(`${this.id()}-link-href`);
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    this.linkEditing.set(false);
  }

  protected removeLink(): void {
    this.editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    this.linkEditing.set(false);
  }

  protected cancelLink(): void {
    this.linkEditing.set(false);
    this.editor?.commands.focus();
  }

  /** Arrow keys, Home and End move between toolbar buttons (the WAI-ARIA toolbar pattern). */
  protected onToolbarKey(event: KeyboardEvent): void {
    const count = this.tools().length;
    const moves: Record<string, number> = {
      ArrowRight: (this.focusIndex() + 1) % count,
      ArrowLeft: (this.focusIndex() - 1 + count) % count,
      Home: 0,
      End: count - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    this.focusIndex.set(next);
    this.toolbar()?.nativeElement.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  }

  private createEditor(): void {
    const value = this.value();
    this.editor = new Editor({
      element: this.editorHost().nativeElement,
      extensions: richTextExtensions(this.field()),
      content: isDoc(value) ? value : '',
      editable: !this.disabled(),
      editorProps: { attributes: this.attributes() },
      onUpdate: ({ editor }) => this.value.set(currentValue(editor)),
      onTransaction: () => this.revision.update((n) => n + 1),
    });
  }

  private focus(elementId: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(`#${elementId}`)?.focus(), {
      injector: this.injector,
    });
  }
}

function isDoc(value: unknown): value is JSONContent {
  return typeof value === 'object' && value !== null && (value as JSONContent).type === 'doc';
}

function currentValue(editor: Editor): JSONContent | null {
  return editor.isEmpty ? null : editor.getJSON();
}

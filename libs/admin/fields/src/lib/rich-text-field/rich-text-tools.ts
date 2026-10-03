import type { Editor, Extensions } from '@tiptap/core';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import StarterKit from '@tiptap/starter-kit';
import type { FieldDefOf } from '@novan/shared-schemas';

/** A toolbar button. `toggle` buttons report whether they are on (`aria-pressed`). */
export interface RichTextTool {
  key: string;
  label: string;
  /** Bootstrap Icons name. */
  icon: string;
  toggle: boolean;
  isActive(editor: Editor): boolean;
  run(editor: Editor): void;
}

/** Link addresses the schema accepts (as `buildEntrySchema`): never `javascript:` or `data:`. */
export const safeHref = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;

/** Tiptap extensions for exactly the marks and nodes the field allows, so nothing else can be typed or pasted. */
export function richTextExtensions(field: FieldDefOf<'richText'>): Extensions {
  const marks = new Set<string>(field.marks);
  const nodes = new Set<string>(field.nodes);
  const lists = nodes.has('bulletList') || nodes.has('orderedList');
  const on = (allowed: boolean): Record<string, never> | false => (allowed ? {} : false);

  return [
    StarterKit.configure({
      bold: on(marks.has('bold')),
      italic: on(marks.has('italic')),
      underline: on(marks.has('underline')),
      strike: on(marks.has('strike')),
      code: on(marks.has('code')),
      link: marks.has('link')
        ? { openOnClick: false, autolink: true, defaultProtocol: 'https', isAllowedUri: (url: string) => safeHref.test(url) }
        : false,
      // The page title is the only H1.
      heading: nodes.has('heading') ? { levels: [2, 3, 4] } : false,
      bulletList: on(nodes.has('bulletList')),
      orderedList: on(nodes.has('orderedList')),
      listItem: on(lists),
      listKeymap: on(lists),
      blockquote: on(nodes.has('blockquote')),
      codeBlock: on(nodes.has('codeBlock')),
      horizontalRule: on(nodes.has('horizontalRule')),
      hardBreak: on(nodes.has('hardBreak')),
    }),
    ...(marks.has('subscript') ? [Subscript] : []),
    ...(marks.has('superscript') ? [Superscript] : []),
  ];
}

const markTools: Record<string, Omit<RichTextTool, 'key' | 'toggle'>> = {
  bold: { label: 'Bold', icon: 'type-bold', isActive: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
  italic: { label: 'Italic', icon: 'type-italic', isActive: (e) => e.isActive('italic'), run: (e) => e.chain().focus().toggleItalic().run() },
  underline: {
    label: 'Underline',
    icon: 'type-underline',
    isActive: (e) => e.isActive('underline'),
    run: (e) => e.chain().focus().toggleUnderline().run(),
  },
  strike: {
    label: 'Strikethrough',
    icon: 'type-strikethrough',
    isActive: (e) => e.isActive('strike'),
    run: (e) => e.chain().focus().toggleStrike().run(),
  },
  code: { label: 'Code', icon: 'code', isActive: (e) => e.isActive('code'), run: (e) => e.chain().focus().toggleCode().run() },
  subscript: {
    label: 'Subscript',
    icon: 'subscript',
    isActive: (e) => e.isActive('subscript'),
    run: (e) => e.chain().focus().toggleSubscript().run(),
  },
  superscript: {
    label: 'Superscript',
    icon: 'superscript',
    isActive: (e) => e.isActive('superscript'),
    run: (e) => e.chain().focus().toggleSuperscript().run(),
  },
};

const nodeTools: Record<string, Omit<RichTextTool, 'key'>[]> = {
  heading: [
    {
      label: 'Heading',
      icon: 'type-h2',
      toggle: true,
      isActive: (e) => e.isActive('heading', { level: 2 }),
      run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: 'Subheading',
      icon: 'type-h3',
      toggle: true,
      isActive: (e) => e.isActive('heading', { level: 3 }),
      run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    },
  ],
  bulletList: [
    {
      label: 'Bulleted list',
      icon: 'list-ul',
      toggle: true,
      isActive: (e) => e.isActive('bulletList'),
      run: (e) => e.chain().focus().toggleBulletList().run(),
    },
  ],
  orderedList: [
    {
      label: 'Numbered list',
      icon: 'list-ol',
      toggle: true,
      isActive: (e) => e.isActive('orderedList'),
      run: (e) => e.chain().focus().toggleOrderedList().run(),
    },
  ],
  blockquote: [
    {
      label: 'Quote',
      icon: 'quote',
      toggle: true,
      isActive: (e) => e.isActive('blockquote'),
      run: (e) => e.chain().focus().toggleBlockquote().run(),
    },
  ],
  codeBlock: [
    {
      label: 'Code block',
      icon: 'code-square',
      toggle: true,
      isActive: (e) => e.isActive('codeBlock'),
      run: (e) => e.chain().focus().toggleCodeBlock().run(),
    },
  ],
  horizontalRule: [
    {
      label: 'Divider',
      icon: 'hr',
      toggle: false,
      isActive: () => false,
      run: (e) => e.chain().focus().setHorizontalRule().run(),
    },
  ],
};

/** Toolbar buttons for the field's marks and nodes, in the order the field lists them. The link button is separate. */
export function richTextTools(field: FieldDefOf<'richText'>): RichTextTool[] {
  return [
    ...field.marks.flatMap((mark) => (markTools[mark] ? [{ key: mark, toggle: true, ...markTools[mark] }] : [])),
    ...field.nodes.flatMap((node) => (nodeTools[node] ?? []).map((tool, i) => ({ key: `${node}-${i}`, ...tool }))),
  ];
}

import { isSafeImageSrc, type NovanResolvedLink, resolveHref } from '../links';
import type { NovanAsset, ProseMirrorNode } from '../types';

// Rich text is turned into this model before rendering: only known elements, only checked attributes.
// Anything else in the document (unknown nodes such as `script`, event handler attributes, unsafe link or
// image addresses) never reaches the template, which renders the model with Angular bindings only.

export type RichMark =
  | { kind: 'strong' | 'em' | 'u' | 's' | 'code' | 'sub' | 'sup' }
  | { kind: 'link'; link: NovanResolvedLink };

export type RichNode =
  | { kind: 'p' | 'ul' | 'li' | 'blockquote' | 'fragment'; children: RichNode[] }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: RichNode[] }
  | { kind: 'ol'; start: number | null; children: RichNode[] }
  | { kind: 'pre'; text: string }
  | { kind: 'hr' | 'br' }
  | { kind: 'img'; src: string; alt: string; width: number | null; height: number | null }
  | { kind: 'text'; text: string; marks: RichMark[] };

const MARKS: Readonly<Record<string, RichMark['kind']>> = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  strike: 's',
  code: 'code',
  subscript: 'sub',
  superscript: 'sup',
  link: 'link',
};

/** Deeper documents are cut off rather than risk the call stack. */
const MAX_DEPTH = 50;

/** The safe model of a rich text document; empty for anything that is not one. */
export function richTextModel(doc: unknown): RichNode[] {
  if (!isNode(doc)) return [];
  return doc.type === 'doc' ? children(doc, 0) : node(doc, 0);
}

function children(parent: ProseMirrorNode, depth: number): RichNode[] {
  if (depth > MAX_DEPTH || !Array.isArray(parent.content)) return [];
  return parent.content.flatMap((child) => (isNode(child) ? node(child, depth + 1) : []));
}

function node(source: ProseMirrorNode, depth: number): RichNode[] {
  const attrs = source.attrs ?? {};
  switch (source.type) {
    case 'text':
      return typeof source.text === 'string' && source.text ? [{ kind: 'text', text: source.text, marks: marks(source) }] : [];
    case 'paragraph':
      return [{ kind: 'p', children: children(source, depth) }];
    case 'heading':
      return [{ kind: 'heading', level: headingLevel(attrs['level']), children: children(source, depth) }];
    case 'bulletList':
      return [{ kind: 'ul', children: listItems(source, depth) }];
    case 'orderedList': {
      const start = attrs['start'];
      return [
        {
          kind: 'ol',
          start: typeof start === 'number' && Number.isInteger(start) && start !== 1 ? start : null,
          children: listItems(source, depth),
        },
      ];
    }
    case 'listItem':
      return [{ kind: 'li', children: children(source, depth) }];
    case 'blockquote':
      return [{ kind: 'blockquote', children: children(source, depth) }];
    case 'codeBlock':
      return [{ kind: 'pre', text: plainText(source, depth) }];
    case 'horizontalRule':
      return [{ kind: 'hr' }];
    case 'hardBreak':
      return [{ kind: 'br' }];
    case 'image':
      return image(attrs);
    default:
      // Unknown nodes (including anything posing as `script` or `iframe`) keep only their text content.
      return children(source, depth);
  }
}

/** Lists hold only list items; stray content is wrapped so the list stays valid. */
function listItems(list: ProseMirrorNode, depth: number): RichNode[] {
  return children(list, depth).map((child) => (child.kind === 'li' ? child : { kind: 'li', children: [child] }));
}

function headingLevel(value: unknown): 1 | 2 | 3 | 4 | 5 | 6 {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6
    ? (value as 1 | 2 | 3 | 4 | 5 | 6)
    : 2;
}

function marks(source: ProseMirrorNode): RichMark[] {
  if (!Array.isArray(source.marks)) return [];
  const result: RichMark[] = [];
  const seen = new Set<string>();
  for (const mark of source.marks) {
    const kind = typeof mark?.type === 'string' ? MARKS[mark.type] : undefined;
    if (!kind || seen.has(kind)) continue;
    seen.add(kind);
    if (kind !== 'link') {
      result.push({ kind });
      continue;
    }
    // An internal link to a page carries the page's current path; an unpublished page has none.
    const attrs = mark.attrs ?? {};
    const href = typeof attrs['entryId'] === 'string' ? attrs['path'] : attrs['href'];
    const link = resolveHref(href);
    if (link) result.push({ kind: 'link', link });
  }
  // Links outermost, so formatting sits inside the link text.
  return result.sort((a, b) => Number(b.kind === 'link') - Number(a.kind === 'link'));
}

function image(attrs: Record<string, unknown>): RichNode[] {
  const asset = attrs['asset'] as Partial<NovanAsset> | undefined;
  const src = typeof asset === 'object' && asset !== null ? asset.url : attrs['src'];
  if (!isSafeImageSrc(src)) return [];
  const alt = (typeof asset === 'object' && asset !== null ? asset.alt : undefined) ?? attrs['alt'];
  return [
    {
      kind: 'img',
      src,
      alt: typeof alt === 'string' ? alt : '',
      width: positive(asset?.width ?? attrs['width']),
      height: positive(asset?.height ?? attrs['height']),
    },
  ];
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function plainText(source: ProseMirrorNode, depth: number): string {
  if (depth > MAX_DEPTH) return '';
  if (source.type === 'text') return typeof source.text === 'string' ? source.text : '';
  if (source.type === 'hardBreak') return '\n';
  return Array.isArray(source.content) ? source.content.map((child) => (isNode(child) ? plainText(child, depth + 1) : '')).join('') : '';
}

function isNode(value: unknown): value is ProseMirrorNode {
  return typeof value === 'object' && value !== null && typeof (value as ProseMirrorNode).type === 'string';
}

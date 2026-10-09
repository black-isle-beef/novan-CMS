import {
  type BlockTypeDef,
  type EntryData,
  type FieldDef,
  isEmptyValue,
  isTranslated,
  mapValueFields,
  type ProseMirrorNode,
  translationOf,
  withTranslation,
} from '@novan/shared-schemas';

/** One value to translate: the texts in it, and how to rebuild it from their translations. */
interface Job {
  texts: string[];
  build(translated: readonly string[]): unknown;
}

/** What a machine translation of entry data needs: every text to send, and how to put the answers back. */
export interface TranslationPlan {
  /** Dotted paths of the values filled in, e.g. `title`, `body.<uid>.heading`. */
  paths: string[];
  /** Every text to translate, in order. */
  texts: string[];
  /** The data with `to` filled in from the translations of {@link texts}, in the same order. */
  apply(translated: readonly string[]): EntryData;
}

/**
 * Plans filling `to`'s empty translations from `from`. Text, rich text and the text of links are translated; other
 * translated values (files, links' targets, numbers) are copied, so the draft is complete. Values `to` already has
 * are left alone.
 */
export function planTranslation(
  fields: readonly FieldDef[],
  data: EntryData,
  blockTypes: readonly BlockTypeDef[],
  locales: { from: string; to: string; defaultLocale: string },
): TranslationPlan {
  const { from, to, defaultLocale } = locales;
  const jobs = new Map<string, Job>();
  mapValueFields(fields, data, blockTypes, (field, value, path) => {
    if (!isTranslated(field)) return value;
    const source = translationOf(value, from, defaultLocale);
    if (isEmptyValue(source) || !isEmptyValue(translationOf(value, to, defaultLocale))) return value;
    jobs.set(path, jobFor(field, source));
    return value;
  });

  const texts = [...jobs.values()].flatMap((job) => job.texts);
  return {
    paths: [...jobs.keys()],
    texts,
    apply(translated) {
      let next = 0;
      const results = new Map<string, unknown>();
      for (const [path, job] of jobs) {
        results.set(path, job.build(translated.slice(next, next + job.texts.length)));
        next += job.texts.length;
      }
      return mapValueFields(fields, data, blockTypes, (_field, value, path) =>
        results.has(path) ? withTranslation(value, to, results.get(path), defaultLocale) : value,
      );
    },
  };
}

function jobFor(field: FieldDef, source: unknown): Job {
  if (field.type === 'text' && typeof source === 'string') {
    return { texts: [source], build: ([text]) => text ?? source };
  }
  if (field.type === 'richText' && isObject(source)) {
    const nodes: ProseMirrorNode[] = [];
    collectText(source as unknown as ProseMirrorNode, nodes);
    return {
      texts: nodes.map((node) => node.text ?? ''),
      build: (translated) => {
        let index = 0;
        return replaceText(source as unknown as ProseMirrorNode, () => translated[index++]);
      },
    };
  }
  if (field.type === 'link' && isObject(source) && typeof source['text'] === 'string' && source['text'].trim()) {
    return { texts: [source['text']], build: ([text]) => ({ ...source, text: text ?? source['text'] }) };
  }
  // Nothing to translate: the draft uses the same value.
  return { texts: [], build: () => structuredClone(source) };
}

function collectText(node: ProseMirrorNode, into: ProseMirrorNode[]): void {
  if (node.type === 'text' && typeof node.text === 'string') into.push(node);
  node.content?.forEach((child) => collectText(child, into));
}

function replaceText(node: ProseMirrorNode, next: () => string | undefined): ProseMirrorNode {
  if (node.type === 'text' && typeof node.text === 'string') return { ...node, text: next() ?? node.text };
  return node.content ? { ...node, content: node.content.map((child) => replaceText(child, next)) } : { ...node };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

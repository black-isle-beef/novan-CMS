/**
 * Machine translation for drafts (docs/build/16-localisation.md). The provider is chosen later; until then
 * `TRANSLATOR` is unset and {@link createTranslator} gives `null`, so the admin offers no machine translation.
 * `TRANSLATOR=pseudo` marks text instead of translating it, for local development and tests.
 */
export abstract class Translator {
  /** Shown to editors, e.g. in the draft's version message. */
  abstract readonly name: string;
  /** Translates each text from one locale (`en-GB`) to another, keeping their order. */
  abstract translate(texts: readonly string[], from: string, to: string): Promise<string[]>;
}

/** Injects the space's `Translator | null`. */
export const MACHINE_TRANSLATOR = Symbol('MACHINE_TRANSLATOR');

export const TRANSLATOR_PROVIDERS = ['pseudo'] as const;
export type TranslatorProvider = (typeof TRANSLATOR_PROVIDERS)[number];

/** The translator `TRANSLATOR` names, or null when none is set up. */
export function createTranslator(env: NodeJS.ProcessEnv = process.env): Translator | null {
  const named = env['TRANSLATOR'] as TranslatorProvider | undefined;
  switch (named) {
    case 'pseudo':
      return new PseudoTranslator();
    default:
      return null;
  }
}

/** "Hello" becomes "[fr-FR] Hello": obviously not a translation, so nobody mistakes it for one. */
export class PseudoTranslator extends Translator {
  readonly name = 'Pseudo-translation';

  translate(texts: readonly string[], _from: string, to: string): Promise<string[]> {
    return Promise.resolve(texts.map((text) => (text.trim() ? `[${to}] ${text}` : text)));
  }
}

// css-processor.ts — makes an uploaded stylesheet safe to serve to client sites and puts it in its cascade layer
// (docs/build/24-design-systems.md), and lists the classes it defines for the editor's autocomplete.
import { CASCADE_LAYERS, type CascadeLayer, CLASS_TOKEN } from '@novan/shared-design-system';
import { MAX_INDEXED_CLASSES, type ValidationIssue } from '@novan/shared-schemas';
import postcss, { type AtRule, type ChildNode, CssSyntaxError, type Node, type Root } from 'postcss';
import selectorParser from 'postcss-selector-parser';
import valueParser from 'postcss-value-parser';

export interface StylesheetOptions {
  /** The file's name in the package, for the report. */
  file: string;
  /** Origins whose `@import`s are kept (manifest `allowedOrigins`), e.g. `https://fonts.googleapis.com`. */
  allowedOrigins: readonly string[];
  /** The address the stylesheet came from, to resolve relative `url()`s against; null for an upload. */
  baseUrl: string | null;
  layer?: Extract<CascadeLayer, 'ds-vendor' | 'ds-components'>;
}

export interface ProcessedStylesheet {
  css: string;
  /** Every class the stylesheet's selectors use, as written in markup (`md:px-8`, not `md\:px-8`). */
  classes: string[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/** `data:` URLs kept in `url()`: images and fonts only, never documents or scripts. */
const SAFE_DATA_URL = /^data:(image\/(png|jpe?g|gif|webp|avif|svg\+xml)|font\/[a-z0-9.+-]+|application\/(font-[a-z0-9.+-]+|x-font-[a-z0-9.+-]+|vnd\.ms-fontobject))[;,]/i;
/** Properties that run code in old browsers. */
const DANGEROUS_PROPERTIES = new Set(['behavior', '-moz-binding']);

/**
 * Parses the stylesheet and returns it ready to serve: wrapped in its layer, after the cascade layer order, with
 * anything that could run code or load from where it should not removed (each removal is a warning), and the
 * classes it defines. A stylesheet that cannot be parsed is an error, with its line.
 */
export function processStylesheet(source: string, options: StylesheetOptions): ProcessedStylesheet {
  const { file } = options;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const warn = (node: Node, message: string) => warnings.push({ file, line: node.source?.start?.line, message });

  let root: Root;
  try {
    root = postcss.parse(source, { from: file });
  } catch (error) {
    if (!(error instanceof CssSyntaxError)) throw error;
    errors.push({ file, line: error.line, message: `The stylesheet cannot be read: ${error.reason}.` });
    return { css: '', classes: [], errors, warnings };
  }

  // At-rules that must stay at the top, or that can load other stylesheets.
  const imports: AtRule[] = [];
  root.walkAtRules((rule) => {
    const name = rule.name.toLowerCase();
    if (name === 'charset') {
      rule.remove();
    } else if (name === 'namespace') {
      warn(rule, '@namespace was removed: it cannot sit inside a cascade layer.');
      rule.remove();
    } else if (name === 'import') {
      const kept = rule.parent === root ? keptImport(rule, options) : null;
      if (kept) imports.push(kept);
      else warn(rule, `@import ${rule.params} was removed: only imports from the design system's allowed origins are kept.`);
      rule.remove();
    }
  });

  let important = 0;
  const origins = new Set<string>();
  root.walkDecls((decl) => {
    if (DANGEROUS_PROPERTIES.has(decl.prop.toLowerCase())) {
      warn(decl, `${decl.prop} was removed: it runs code in old browsers.`);
      decl.remove();
      return;
    }
    if (/expression\s*\(/i.test(decl.value)) {
      warn(decl, `${decl.prop}: expression() was removed: it runs code in old browsers.`);
      decl.remove();
      return;
    }
    if (/url\s*\(/i.test(decl.value)) {
      const rewritten = rewriteUrls(decl.value, options.baseUrl, origins);
      if (rewritten.problem) {
        warn(decl, `${decl.prop} was removed: ${rewritten.problem}`);
        decl.remove();
        return;
      }
      decl.value = rewritten.value;
    }
    if (decl.important) important++;
  });
  if (important) {
    warnings.push({
      file,
      message: `${important} declaration${important === 1 ? ' uses' : 's use'} !important, which beats the classes editors add to blocks.`,
    });
  }
  if (origins.size) {
    warnings.push({ file, message: `It loads files from ${[...origins].sort().join(', ')}; visitors' browsers fetch them from there.` });
  }

  const classes = classesOf(root);
  if (classes.length > MAX_INDEXED_CLASSES) {
    warnings.push({ file, message: `It defines ${classes.length} classes; the first ${MAX_INDEXED_CLASSES} are suggested in the editor.` });
  }

  const rules = root.nodes.filter((node) => node.type !== 'comment' || node.text.startsWith('!'));
  if (!rules.some((node) => node.type !== 'comment')) {
    errors.push({ file, message: 'The stylesheet has no rules.' });
  }

  const layer = postcss.atRule({ name: 'layer', params: options.layer ?? 'ds-vendor' });
  layer.append(...root.nodes);
  const out = postcss.root();
  out.append(postcss.atRule({ name: 'layer', params: CASCADE_LAYERS.join(', ') }), ...imports, layer);
  // One statement a line, the layer's rules starting on their own line.
  out.each((node, index) => {
    node.raws.before = index ? '\n' : '';
  });
  Object.assign(layer.raws, { between: ' ', after: '\n' });
  if (layer.first) layer.first.raws.before = '\n';
  return { css: out.toString(), classes: classes.slice(0, MAX_INDEXED_CLASSES), errors, warnings };
}

/** An `@import` from an allowed origin, rewritten into the layer; null for any other. */
function keptImport(rule: AtRule, options: StylesheetOptions): AtRule | null {
  const parsed = valueParser(rule.params);
  const first = parsed.nodes.find((node) => node.type !== 'space');
  const href =
    first?.type === 'string' ? first.value : first?.type === 'function' && first.value.toLowerCase() === 'url' ? urlOf(first) : null;
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href, options.baseUrl ?? undefined);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !options.allowedOrigins.includes(url.origin)) return null;
  // Whatever followed the address: media queries or supports(); an existing layer() is replaced.
  const rest = valueParser
    .stringify(parsed.nodes.slice(parsed.nodes.indexOf(first as valueParser.Node) + 1))
    .replace(/\blayer(\([^)]*\))?/i, '')
    .trim();
  return postcss.atRule({ name: 'import', params: `url(${JSON.stringify(url.href)}) layer(${options.layer ?? 'ds-vendor'})${rest ? ` ${rest}` : ''}` });
}

/** The declaration's value with each `url()` checked and made absolute, or why it cannot be kept. */
function rewriteUrls(value: string, baseUrl: string | null, origins: Set<string>): { value: string; problem?: string } {
  const parsed = valueParser(value);
  let problem: string | undefined;
  parsed.walk((node) => {
    if (problem || node.type !== 'function' || node.value.toLowerCase() !== 'url') return;
    const href = urlOf(node).trim();
    if (href === '' || href.startsWith('#')) return;
    if (/^data:/i.test(href)) {
      if (!SAFE_DATA_URL.test(href)) problem = 'it embeds a data: URL that is not an image or a font.';
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:/i.test(href)) {
      problem = `it links to ${href.split(':')[0]}: addresses.`;
      return;
    }
    let url: URL;
    try {
      url = baseUrl ? new URL(href, baseUrl) : new URL(href);
    } catch {
      problem = `${href} is a file inside the package; upload a zip with the stylesheet and its files.`;
      return;
    }
    if (url.protocol !== 'https:') {
      problem = `${href} is not an https address.`;
      return;
    }
    origins.add(url.origin);
    node.nodes = [{ type: 'string', value: url.href, quote: '"', sourceIndex: 0, sourceEndIndex: 0 } as valueParser.StringNode];
  });
  return problem ? { value, problem } : { value: valueParser.stringify(parsed.nodes) };
}

function urlOf(node: valueParser.FunctionNode): string {
  return node.nodes.map((child) => (child.type === 'string' || child.type === 'word' ? child.value : '')).join('');
}

/** The classes used in the stylesheet's selectors, outside keyframes, in the order they first appear. */
function classesOf(root: Root): string[] {
  const classes = new Set<string>();
  const collect = selectorParser((selectors) => {
    selectors.walkClasses((node) => {
      if (CLASS_TOKEN.test(node.value)) classes.add(node.value);
    });
  });
  root.walkRules((rule) => {
    if (inKeyframes(rule)) return;
    try {
      collect.processSync(rule.selector);
    } catch {
      // A selector the parser cannot read gives no classes; the browser decides whether it applies.
    }
  });
  return [...classes];
}

function inKeyframes(node: ChildNode): boolean {
  let current = node.parent as Node | undefined;
  while (current && current.type !== 'root') {
    if (current.type === 'atrule' && /keyframes$/i.test((current as AtRule).name)) return true;
    current = current.parent as Node | undefined;
  }
  return false;
}

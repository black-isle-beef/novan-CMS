import { afterNextRender, ChangeDetectionStrategy, Component, computed, DOCUMENT, effect, inject, Injector, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsAlertComponent, DsToastService } from '@black-isle-beef/novan-design-system';
import { Confirm, copy, Skeleton } from '@novan/admin-shell';
import { ManagementApi, problemFieldErrors, problemMessage, SpaceContext, SpaceLocales } from '@novan/admin-spaces';
import {
  createLocaleRequestSchema,
  defaultLocalePrefix,
  type ManagedLocales,
  MAX_LOCALES,
  type SpaceLocale,
  updateLocaleRequestSchema,
} from '@novan/shared-schemas';
import { firstValueFrom } from 'rxjs';

/** What the form holds: a new language, or changes to one. */
interface LanguageForm {
  code: string;
  name: string;
  /** Where its missing translations come from: a language code, or '' for nowhere. */
  fallback: string;
  prefix: string;
}

/** Languages people often add, offered as suggestions; other language codes work too. */
const SUGGESTED = ['en-GB', 'en-US', 'cy-GB', 'ga-IE', 'gd-GB', 'fr-FR', 'de-DE', 'es-ES', 'it-IT', 'nl-NL', 'pl-PL', 'pt-PT'];

/**
 * The languages the space's site is published in (docs/build/16-localisation.md). Everyone sees them; space admins and
 * developers add, change and remove them and choose the main language; space admins choose whether the site's
 * addresses start with the language (`/fr/about`). Each language reads missing translations from another language, or
 * shows nothing in their place.
 */
@Component({
  selector: 'nv-languages-page',
  imports: [DsAlertComponent, RouterLink, Skeleton],
  templateUrl: './languages-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LanguagesPage {
  private readonly api = inject(ManagementApi);
  private readonly store = inject(SpaceLocales);
  private readonly confirm = inject(Confirm);
  private readonly toasts = inject(DsToastService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  protected readonly context = inject(SpaceContext);
  protected readonly copy = copy;
  protected readonly suggested = SUGGESTED;
  protected readonly maxLocales = MAX_LOCALES;

  /** Bound from the `:spaceId` route parameter. */
  readonly spaceId = input.required<string>();

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly value = signal<ManagedLocales | null>(null);
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly errors = signal<Record<string, string[]>>({});
  /** The language being changed in the form, or null when adding one. */
  protected readonly editing = signal<SpaceLocale | null>(null);
  protected readonly form = signal<LanguageForm>(emptyForm());

  protected readonly locales = computed(() => this.value()?.locales ?? []);
  protected readonly main = computed(() => this.locales().find((locale) => locale.isDefault) ?? null);
  /** Space admins and developers manage languages (RLS agrees, 0013_localisation.sql). */
  protected readonly canChange = computed(() => this.context.viewingAs() === null && this.context.can('schema.write'));
  /** How addresses show the language is a space setting, for space admins. */
  protected readonly canChangePrefixes = computed(() => this.context.canManageCurrent());
  protected readonly full = computed(() => this.locales().length >= MAX_LOCALES);
  /** Languages the one in the form may read missing translations from. */
  protected readonly fallbacks = computed(() => this.locales().filter((locale) => locale.code !== this.editing()?.code));

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      untracked(() => {
        this.context.currentSpaceId.set(spaceId);
        void this.load(spaceId);
      });
    });
  }

  protected nameOf(code: string | null): string {
    return this.locales().find((locale) => locale.code === code)?.name ?? code ?? '';
  }

  /** What the address of the About page looks like in this language. */
  protected example(locale: SpaceLocale): string {
    return this.value()?.prefixes && !locale.isDefault ? `/${locale.prefix}/about` : '/about';
  }

  protected set(key: keyof LanguageForm, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this.form.update((form) => {
      const next = { ...form, [key]: value };
      // A new language gets a name and an address prefix from its code, until they are typed.
      if (key === 'code' && !this.editing()) {
        const code = value.trim();
        if (!form.name || form.name === languageName(form.code)) next.name = languageName(code);
        if (!form.prefix || form.prefix === defaultLocalePrefix(form.code)) next.prefix = code ? defaultLocalePrefix(code) : '';
      }
      return next;
    });
  }

  protected edit(locale: SpaceLocale): void {
    this.editing.set(locale);
    this.form.set({ code: locale.code, name: locale.name, fallback: locale.fallback ?? '', prefix: locale.prefix });
    this.errors.set({});
    this.problem.set(null);
    this.focus('language-name');
  }

  protected cancelEdit(): void {
    this.editing.set(null);
    this.form.set(emptyForm(this.main()?.code));
    this.errors.set({});
    this.problem.set(null);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    this.problem.set(null);
    const form = this.form();
    const editing = this.editing();
    const body = editing
      ? { name: form.name, prefix: form.prefix, ...(editing.isDefault ? {} : { fallback: form.fallback || null }) }
      : { code: form.code.trim(), name: form.name, prefix: form.prefix, fallback: form.fallback || null };
    // The same checks as the API, so mistakes show at once and in the same words.
    const parsed = (editing ? updateLocaleRequestSchema : createLocaleRequestSchema).safeParse(body);
    if (!parsed.success) {
      this.errors.set(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0] ?? 'form'), [issue.message]])));
      this.focus(`language-${String(parsed.error.issues[0]?.path[0] ?? 'code')}`);
      return;
    }
    this.errors.set({});
    await this.run(async () => {
      if (editing) {
        await this.apply(this.api.updateLocale(this.spaceId(), editing.code, body));
        this.toasts.success(`${form.name} changed.`);
      } else {
        await this.apply(this.api.createLocale(this.spaceId(), body as { code: string; name: string }));
        this.toasts.success(`${form.name} added. Pages show the ${this.nameOf(form.fallback || null) || 'main language'} text until translated.`);
      }
      this.cancelEdit();
      this.focus('languages-list-heading');
    });
  }

  protected async makeMain(locale: SpaceLocale): Promise<void> {
    const confirmed = await this.confirm.ask({
      heading: `Make ${locale.name} the main language?`,
      body: `Pages are written in the main language first: publishing a page needs its ${locale.name} text from now on, and its addresses no longer start with a language.`,
      confirmLabel: `Make ${locale.name} the main language`,
    });
    if (!confirmed) return;
    await this.run(async () => {
      await this.apply(this.api.updateLocale(this.spaceId(), locale.code, { isDefault: true }));
      this.toasts.success(`${locale.name} is now the main language.`);
    });
  }

  protected async remove(locale: SpaceLocale): Promise<void> {
    const confirmed = await this.confirm.ask({
      heading: `Remove ${locale.name}?`,
      body: `The site stops showing pages in ${locale.name}. Its translations are kept in earlier versions of each page, but are dropped the next time a page is saved.`,
      confirmLabel: `Remove ${locale.name}`,
      destructive: true,
    });
    if (!confirmed) return;
    await this.run(async () => {
      await this.apply(this.api.removeLocale(this.spaceId(), locale.code));
      this.toasts.success(`${locale.name} removed.`);
      this.focus('languages-heading');
    });
  }

  protected async setPrefixes(event: Event): Promise<void> {
    const prefixes = (event.target as HTMLInputElement).checked;
    await this.run(async () => {
      await this.apply(this.api.setLocalePrefixes(this.spaceId(), prefixes));
      this.toasts.success(prefixes ? 'Addresses now start with the language, like /fr/about.' : 'Addresses no longer show the language.');
    });
  }

  protected invalid(key: keyof LanguageForm): boolean {
    return Boolean(this.errors()[key]?.length);
  }

  private async apply(request: ReturnType<ManagementApi['listLocales']>): Promise<void> {
    const value = await firstValueFrom(request);
    this.value.set(value);
    this.store.set(this.spaceId(), value);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      this.problem.set(problemMessage(error));
      this.errors.set(problemFieldErrors(error));
      this.focus('languages-problem');
    } finally {
      this.busy.set(false);
    }
  }

  private async load(spaceId: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const value = await firstValueFrom(this.api.listLocales(spaceId));
      this.value.set(value);
      this.store.set(spaceId, value);
      this.form.set(emptyForm(value.locales.find((locale) => locale.isDefault)?.code));
    } catch (error) {
      this.loadError.set(problemMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private focus(id: string): void {
    afterNextRender(() => this.document.getElementById(id)?.focus(), { injector: this.injector });
  }
}

/** A new language reads missing translations from the main language, unless chosen otherwise. */
function emptyForm(main?: string): LanguageForm {
  return { code: '', name: '', fallback: main ?? '', prefix: '' };
}

/** `French (France)` for `fr-FR`, in English; the code itself when the browser does not know it. */
function languageName(code: string): string {
  if (!code) return '';
  try {
    return new Intl.DisplayNames(['en-GB'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

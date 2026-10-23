import { afterNextRender, ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsCookieBannerComponent, DsModalComponent } from '@black-isle-beef/novan-design-system';
import { consentCategories, type ConsentCategoryId } from '@novan/marketing-content';
import { type ConsentChoices, ConsentService } from './consent.service';

/**
 * The cookie banner and the "Manage preferences" dialog, from the design system. Accept all and Reject all carry
 * equal weight; nothing optional runs until the visitor accepts it. The banner never takes focus on page load (the
 * skip link stays first); reopening it from "Cookie settings" moves focus into it and back again afterwards.
 */
@Component({
  selector: 'mk-consent-manager',
  imports: [DsCookieBannerComponent, DsModalComponent, RouterLink],
  templateUrl: './consent-manager.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MkConsentManager {
  protected readonly consent = inject(ConsentService);
  protected readonly categories = consentCategories;
  /** The dialog's unsaved choices. */
  protected readonly draft = signal<ConsentChoices>(this.consent.choices());

  constructor() {
    // The cookie is read in the browser only, so every visitor gets the same cached page.
    afterNextRender(() => this.consent.init());
  }

  protected openPreferences(): void {
    this.draft.set({ ...this.consent.choices() });
    this.consent.preferencesOpen.set(true);
  }

  protected isChecked(id: ConsentCategoryId): boolean {
    return id === 'necessary' || this.draft()[id];
  }

  protected toggle(id: ConsentCategoryId, event: Event): void {
    if (id === 'necessary') return;
    const checked = (event.target as HTMLInputElement).checked;
    this.draft.update((draft) => ({ ...draft, [id]: checked }));
  }

  protected saveDraft(event: Event): void {
    event.preventDefault();
    this.consent.save(this.draft());
  }
}

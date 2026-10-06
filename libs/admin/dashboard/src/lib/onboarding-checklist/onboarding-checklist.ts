import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsButtonComponent, DsProgressComponent } from '@black-isle-beef/novan-design-system';
import type { Onboarding, OnboardingStep } from '@novan/shared-schemas';

interface StepView {
  key: OnboardingStep;
  title: string;
  hint: string;
  link: string[];
  queryParams?: Record<string, string>;
  action: string;
  done: boolean;
}

/**
 * The getting-started checklist of a new space (stored in `spaces.settings.onboarding`). Steps tick themselves
 * when someone does them; anyone who can edit may dismiss the list for the whole space.
 */
@Component({
  selector: 'nv-onboarding-checklist',
  imports: [DsButtonComponent, DsProgressComponent, RouterLink],
  templateUrl: './onboarding-checklist.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnboardingChecklist {
  readonly spaceId = input.required<string>();
  readonly checklist = input.required<Onboarding>();
  /** The top-level `home` page, if the space has one. */
  readonly homePageId = input<string | null>(null);
  readonly canEdit = input(false);
  readonly canDismiss = input(false);
  readonly dismiss = output<void>();

  protected readonly steps = computed<StepView[]>(() => {
    const space = ['/spaces', this.spaceId()];
    const done = (key: OnboardingStep) => Boolean(this.checklist().completed[key]);
    const home = this.homePageId();
    return [
      {
        key: 'logo',
        title: 'Add your logo',
        hint: 'Upload it to the media library, so it is ready to use on your site.',
        link: [...space, 'media'],
        action: 'Open media',
        done: done('logo'),
      },
      {
        key: 'homePage',
        title: 'Edit your home page',
        hint: 'Change the words and pictures people see first.',
        link: home ? [...space, 'content', home] : [...space, 'content'],
        action: home ? 'Edit the home page' : 'Open pages',
        done: done('homePage'),
      },
      {
        key: 'newPage',
        title: 'Add a page',
        hint: 'Give it a title, then fill it in.',
        link: [...space, 'content'],
        queryParams: this.canEdit() ? { add: 'page' } : undefined,
        action: this.canEdit() ? 'Add a page' : 'Open pages',
        done: done('newPage'),
      },
      {
        key: 'publish',
        title: 'Publish a page',
        hint: 'Publishing puts your changes on the live site.',
        link: [...space, 'content'],
        action: 'Open pages',
        done: done('publish'),
      },
    ];
  });

  protected readonly doneCount = computed(() => this.steps().filter((step) => step.done).length);
}

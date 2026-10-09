import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsAlertComponent } from '@black-isle-beef/novan-design-system';
import { FieldForm, FieldFormContext, LocaleSwitcher } from '@novan/admin-fields';
import { MediaPicker, MediaPickerDialog } from '@novan/admin-media';
import { copy, shortcutKeys, Skeleton } from '@novan/admin-shell';
import { SingletonEditor } from '../singleton-editor';

/**
 * Site settings (docs/build/14-seo-site-features.md): the `siteSettings` singleton in a form of its own. The site's
 * name, logo, browser tab icon, sharing image, contact details, social media and analytics ID, as the content model
 * defines them, so a developer can add fields without changing this screen.
 */
@Component({
  selector: 'nv-site-settings-page',
  imports: [DsAlertComponent, FieldForm, LocaleSwitcher, MediaPickerDialog, RouterLink, Skeleton],
  providers: [FieldFormContext, MediaPicker],
  templateUrl: './site-settings-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteSettingsPage extends SingletonEditor {
  protected readonly apiId = 'siteSettings';
  protected readonly idPrefix = 'site-settings';
  protected readonly copy = copy;
  protected readonly shortcutKeys = shortcutKeys;
}

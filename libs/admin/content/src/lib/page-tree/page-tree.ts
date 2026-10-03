import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsBadgeComponent } from '@black-isle-beef/novan-design-system';
import type { EntrySummary, Folder } from '@novan/shared-schemas';
import { type FolderNode, statusBadges } from '../content-tree';

/**
 * One level of the page tree: folders (each a disclosure button that shows what is inside) then pages.
 * Nested levels are the same component.
 */
@Component({
  selector: 'nv-page-tree',
  imports: [DsBadgeComponent, RouterLink],
  templateUrl: './page-tree.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageTree {
  readonly spaceId = input.required<string>();
  readonly folders = input<FolderNode[]>([]);
  readonly entries = input<EntrySummary[]>([]);
  /** Whether rename and delete buttons are shown for folders (editors and up). */
  readonly canManageFolders = input(false);

  readonly renameFolder = output<Folder>();
  readonly deleteFolder = output<Folder>();

  protected readonly statusBadges = statusBadges;
  /** Folders the user has closed; everything starts open. */
  protected readonly closed = signal<ReadonlySet<string>>(new Set());

  protected isOpen(folder: Folder): boolean {
    return !this.closed().has(folder.id);
  }

  protected toggle(folder: Folder): void {
    const closed = new Set(this.closed());
    if (closed.has(folder.id)) closed.delete(folder.id);
    else closed.add(folder.id);
    this.closed.set(closed);
  }
}

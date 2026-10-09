import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DsAlertComponent } from '@black-isle-beef/novan-design-system';
import { Field, FieldFormContext, fieldId } from '@novan/admin-fields';
import { MediaPicker } from '@novan/admin-media';
import { copy, shortcutKeys, Skeleton } from '@novan/admin-shell';
import type { FieldDef } from '@novan/shared-schemas';
import { SingletonEditor } from '../singleton-editor';
import {
  addItem,
  itemName,
  listAt,
  moveItem,
  type NavNode,
  type NavTree,
  navTrees,
  nestItem,
  removeItem,
  unnestItem,
  withList,
} from './nav-tree';

/** Plain names for the menus the starter kit has; others take their field's label. */
const NAMES: Readonly<Record<string, { item: string; child: string }>> = {
  items: { item: 'menu item', child: 'sub-link' },
  footerGroups: { item: 'column', child: 'link' },
};

/**
 * The navigation editor (docs/build/14-seo-site-features.md): the `navigation` singleton as trees, the main menu
 * (items with sub-links) and the footer (columns of links), which the site's `ds-header` and `ds-footer` show. Each
 * item's own fields (label, a link to a page or another website) use the same controls as the page form; the tree is
 * changed with buttons (add, move up and down, move into the item above and back out, remove), each announced, with
 * focus kept on the item moved.
 */
@Component({
  selector: 'nv-navigation-page',
  imports: [DsAlertComponent, Field, RouterLink, Skeleton],
  providers: [FieldFormContext, MediaPicker],
  templateUrl: './navigation-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavigationPage extends SingletonEditor {
  protected readonly apiId = 'navigation';
  protected readonly idPrefix = 'navigation';
  protected readonly copy = copy;
  protected readonly shortcutKeys = shortcutKeys;
  protected readonly announcement = signal('');

  protected readonly trees = computed(() => navTrees(this.type()?.fields ?? []));

  protected items(tree: NavTree): NavNode[] {
    return listAt(this.data(), [tree.field.apiId]);
  }

  protected children(tree: NavTree, index: number): NavNode[] {
    return tree.children ? listAt(this.data(), [tree.field.apiId, index, tree.children.apiId]) : [];
  }

  /** An item's own fields, without its children. */
  protected ownFields(tree: NavTree): FieldDef[] {
    return tree.field.fields.filter((field) => field !== tree.children);
  }

  /** What to call the tree's items and their children, in a sentence and at the start of one. */
  protected words(tree: NavTree): { item: string; child: string; Item: string; Child: string } {
    const { item, child } = NAMES[tree.field.apiId] ?? { item: 'item', child: tree.children?.label.toLowerCase() ?? 'item' };
    return { item, child, Item: capitalise(item), Child: capitalise(child) };
  }

  /** The id of an item's list of children, which the error summary links to (`fieldId` of its path). */
  protected listId(tree: NavTree, index: number): string {
    return fieldId(this.path(tree.field.apiId, index, tree.children?.apiId ?? ''));
  }

  protected name(node: NavNode | undefined, key: string, position: number): string {
    return itemName(node, key, position);
  }

  protected path(...parts: (string | number)[]): string {
    return parts.join('.');
  }

  protected canAdd(tree: NavTree, index?: number): boolean {
    const field = index === undefined ? tree.field : tree.children;
    const count = index === undefined ? this.items(tree).length : this.children(tree, index).length;
    return this.canEdit() && !!field && (field.max === undefined || count < field.max);
  }

  // --- Changes ---

  protected setField(listPath: (string | number)[], index: number, field: FieldDef, value: unknown): void {
    const list = listAt(this.data(), listPath).map((node, i) => (i === index ? { ...node, [field.apiId]: value } : node));
    this.setData(withList(this.data(), listPath, list));
  }

  protected add(tree: NavTree, index?: number): void {
    const listPath = index === undefined ? [tree.field.apiId] : [tree.field.apiId, index, tree.children?.apiId ?? ''];
    this.setData(addItem(this.data(), listPath));
    const position = listAt(this.data(), listPath).length;
    const words = this.words(tree);
    this.announcement.set(index === undefined ? `Added ${words.item} ${position}.` : `Added ${words.child} ${position}.`);
    this.focus(fieldId([...listPath, position - 1, index === undefined ? tree.nameKey : tree.childNameKey].join('.')));
  }

  protected move(tree: NavTree, index: number, offset: -1 | 1, parent?: number): void {
    const listPath = parent === undefined ? [tree.field.apiId] : [tree.field.apiId, parent, tree.children?.apiId ?? ''];
    const length = listAt(this.data(), listPath).length;
    const target = index + offset;
    if (target < 0 || target >= length) return;
    this.setData(moveItem(this.data(), listPath, index, offset));
    this.announcement.set(`Moved to position ${target + 1} of ${length}.`);
    // Keep focus on the button used; at the end of the list it is disabled, so use the other one.
    const atEnd = offset < 0 ? target === 0 : target === length - 1;
    const direction = (offset < 0) !== atEnd ? 'up' : 'down';
    this.focus(`${this.buttonId(tree, target, parent)}-${direction}`);
  }

  protected nest(tree: NavTree, index: number): void {
    const above = this.items(tree)[index - 1];
    const children = this.children(tree, index - 1).length;
    this.setData(nestItem(this.data(), tree, index));
    this.announcement.set(`Moved into ${this.name(above, tree.nameKey, index)} as ${this.words(tree).child} ${children + 1}.`);
    this.focus(`${this.buttonId(tree, children, index - 1)}-out`);
  }

  protected unnest(tree: NavTree, parent: number, index: number): void {
    this.setData(unnestItem(this.data(), tree, parent, index));
    this.announcement.set(`Moved out to ${this.words(tree).item} ${parent + 2}.`);
    this.focus(`${this.buttonId(tree, parent + 1)}-into`);
  }

  protected remove(tree: NavTree, index: number, parent?: number): void {
    const listPath = parent === undefined ? [tree.field.apiId] : [tree.field.apiId, parent, tree.children?.apiId ?? ''];
    this.setData(removeItem(this.data(), listPath, index));
    const words = this.words(tree);
    this.announcement.set(`Removed ${parent === undefined ? words.item : words.child} ${index + 1}.`);
    const left = listAt(this.data(), listPath).length;
    this.focus(left ? `${this.buttonId(tree, Math.min(index, left - 1), parent)}-remove` : `${tree.field.apiId}-add${parent === undefined ? '' : `-${parent}`}`);
  }

  /** The prefix of an item's action buttons' ids. */
  protected buttonId(tree: NavTree, index: number, parent?: number): string {
    return parent === undefined ? `nav-${tree.field.apiId}-${index}` : `nav-${tree.field.apiId}-${parent}-${index}`;
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

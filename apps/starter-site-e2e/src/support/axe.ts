import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** WCAG 2.2 AA (docs/build/00-conventions.md). */
const wcag22aa = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Runs axe on the current page and fails with a readable list of any violations. */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(wcag22aa).analyze();
  const summary = violations.map(
    (violation) => `${violation.id}: ${violation.help} -> ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );
  expect(summary, `axe violations on ${page.url()}`).toEqual([]);
}

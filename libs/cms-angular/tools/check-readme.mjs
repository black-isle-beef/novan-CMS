// The README's example is the code in examples/, which `check-readme` compiles with the Angular compiler.
// This checks every ```ts block that starts with `// examples/<file>` matches that file, and that every
// example file is shown, so the README cannot drift from code that compiles.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
const examples = readdirSync(join(root, 'examples')).filter((name) => name.endsWith('.ts'));

const problems = [];
const shown = new Set();
for (const [, body] of readme.matchAll(/```ts\n([\s\S]*?)```/g)) {
  const [first, ...rest] = body.split('\n');
  const name = /^\/\/ examples\/(.+\.ts)$/.exec(first)?.[1];
  if (!name) continue;
  shown.add(name);
  if (!examples.includes(name)) {
    problems.push(`README shows examples/${name}, which does not exist.`);
    continue;
  }
  const file = readFileSync(join(root, 'examples', name), 'utf8').replace(/\r\n/g, '\n').trimEnd();
  if (rest.join('\n').trimEnd() !== file) problems.push(`README's examples/${name} differs from the file.`);
}
for (const name of examples) {
  if (!shown.has(name)) problems.push(`examples/${name} is not in the README.`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`README examples match ${examples.length} files.`);

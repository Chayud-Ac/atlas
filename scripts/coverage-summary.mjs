// Prints Vitest json-summary coverage for every workspace as a Markdown table.
// CI appends the output to $GITHUB_STEP_SUMMARY.
import { glob, readFile } from 'node:fs/promises';

const patterns = [
  'apps/*/coverage/coverage-summary.json',
  'packages/*/coverage/coverage-summary.json',
];

const rows = [];
for await (const file of glob(patterns)) {
  const workspace = file.split('/').slice(0, 2).join('/');
  const { total } = JSON.parse(await readFile(file, 'utf8'));
  rows.push(
    `| ${workspace} | ${total.lines.pct}% | ${total.branches.pct}% | ${total.functions.pct}% |`,
  );
}

console.log('### Coverage\n');
if (rows.length === 0) {
  console.log('No coverage reports found.');
} else {
  console.log('| Workspace | Lines | Branches | Functions |');
  console.log('| --- | --- | --- | --- |');
  console.log(rows.sort().join('\n'));
}

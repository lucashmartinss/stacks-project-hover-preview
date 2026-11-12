import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const file = name => new URL(name, import.meta.url);
const light = await readFile(file('../userscripts/stacks-hover-preview.user.js'), 'utf8');
const css = (await readFile(file('../styles/dark-theme.css'), 'utf8')).trim();
const marker = '  document.head.append(style);';
assert.equal(light.split(marker).length, 2);

const dark = light
  .replace('Stacks Project Hover Preview\n', 'Stacks Project Hover Preview (Soft Dark)\n')
  .replace('without leaving the page.', 'in a soft dark theme for the entire Stacks site.')
  .replace(marker, () => [
    '  style.textContent += `',
    ...css.split('\n').map(line => line ? '    ' + line.replace(/[\\`$]/g, '\\$&') : ''),
    '  `;',
    marker
  ].join('\n'));
assert.match(dark, /@name +Stacks Project Hover Preview \(Soft Dark\)/);

const output = file('../userscripts/stacks-hover-preview-dark.user.js');
if (process.argv.includes('--check')) {
  assert.equal(await readFile(output, 'utf8'), dark, 'Run node scripts/build-dark.mjs to regenerate the dark script.');
} else {
  await writeFile(output, dark);
}

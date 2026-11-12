import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const file = name => new URL(name, import.meta.url);
const light = await readFile(file('../userscripts/stacks-hover-preview.user.js'), 'utf8');
const css = (await readFile(file('../styles/dark-theme.css'), 'utf8')).trim();
const initMarker = "  const prefix = 'stacks-hover-preview:v1:';";
const stylesMarker = '  document.head.append(style);';
assert.equal(light.split(initMarker).length, 2);
assert.equal(light.split(stylesMarker).length, 2);

const dark = light
  .replace('Stacks Project Hover Preview\n', 'Stacks Project Hover Preview (Soft Dark)\n')
  .replace('without leaving the page.', 'in a soft dark theme for the entire Stacks site.')
  .replace('@run-at       document-idle', '@run-at       document-start')
  .replace('(() => {\n', '(async () => {\n')
  .replace(initMarker, () => [
    '  // Apply the page theme before waiting for the hover UI to mount.',
    "  const darkStyle = document.createElement('style');",
    "  darkStyle.id = 'stacks-hover-theme';",
    '  darkStyle.textContent = `',
    ...css.split('\n').map(line => line ? '    ' + line.replace(/[\\`$]/g, '\\$&') : ''),
    '  `;',
    '  if (!document.documentElement) {',
    '    await new Promise(resolve => {',
    '      const observer = new MutationObserver(() => {',
    '        if (!document.documentElement) return;',
    '        observer.disconnect();',
    '        resolve();',
    '      });',
    '      observer.observe(document, { childList: true });',
    '    });',
    '  }',
    '  (document.head ?? document.documentElement).append(darkStyle);',
    "  if (document.readyState === 'loading') {",
    "    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));",
    '  }',
    "  if (document.getElementById('stacks-hover-card')) return;",
    '',
    initMarker
  ].join('\n'))
  .replace(stylesMarker, '  document.head.append(style, darkStyle);');
assert.match(dark, /@name +Stacks Project Hover Preview \(Soft Dark\)/);
assert.match(dark, /@run-at +document-start/);

const output = file('../userscripts/stacks-hover-preview-dark.user.js');
if (process.argv.includes('--check')) {
  assert.equal(await readFile(output, 'utf8'), dark, 'Run node scripts/build-dark.mjs to regenerate the dark script.');
} else {
  await writeFile(output, dark);
}

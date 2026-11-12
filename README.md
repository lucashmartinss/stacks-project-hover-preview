# Stacks Project Hover Preview

Hover over a Stacks Project tag link to read its statement and proof on the same page.

## Install

1. With a userscript manager enabled in your browser, open [Light](https://raw.githubusercontent.com/lucashmartinss/stacks-project-hover-preview/main/userscripts/stacks-hover-preview.user.js) to keep the site's appearance or [Soft Dark](https://raw.githubusercontent.com/lucashmartinss/stacks-project-hover-preview/main/userscripts/stacks-hover-preview-dark.user.js) to apply a charcoal theme.
2. Confirm the installation. If the link opens as plain text, copy the whole script into a new script in your manager and save it. Keep one edition enabled at a time.
3. Open or reload the Stacks Project and hover over a tag link.

Move into the preview to scroll or follow a reference. Keyboard focus opens the preview. Press **Down Arrow** to move into it or **Escape** to close it.

## API and cache

The userscript fetches statements and proofs from the [Stacks Project API](https://stacks.math.columbia.edu/api) at `/data/tag/<tag>/content/full`. It sends no cookies with these requests and filters the returned HTML before display. Math is rendered with the site's MathJax and its Safe extension. If Safe cannot load, previews show source TeX.

Previews are stored locally in the browser. For 24 hours, hovering over a cached tag makes no API request. After that, the next hover shows the cached content immediately and rechecks it in the background. The script uses HTTP validators when available and compares the returned HTML otherwise. If a check fails, the cached preview remains available.

## Development

Run `node scripts/build-dark.mjs` after editing the light script or `styles/dark-theme.css`. Add `--check` to verify that the generated dark edition is up to date.

The live tests need Node.js 22 or later and Chrome or Chromium. They look for the browser on `PATH`. Set `CHROMIUM_PATH` to the browser executable if needed.

```sh
node scripts/test-live.mjs
node scripts/test-live.mjs --dark
```

## License and affiliation

The author does not own the Stacks Project and is not affiliated with or endorsed by it. The Stacks Project's text and proofs are covered by the [GNU Free Documentation License](https://stacks.math.columbia.edu/tag/02C1).

These userscripts were generated with AI. The author does not intend to maintain this repository. The community is welcome to use, modify, fork, and redistribute the code under the [MIT License](LICENSE).

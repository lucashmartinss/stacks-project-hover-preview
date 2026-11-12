# Stacks Project Hover Preview

Hover over a Stacks Project tag link to read its statement and proof on the same page.

**AI and maintenance notice.** These userscripts were generated with AI. The author does not intend to maintain this repository. The community is welcome to use, modify, fork, and redistribute the code under the [MIT License](LICENSE).

**Unofficial project.** The author does not own the Stacks Project and is not affiliated with or endorsed by it. The MIT License applies to the userscript code in this repository. The Stacks Project's text and proofs are available under the [GNU Free Documentation License](https://stacks.math.columbia.edu/tag/02C1).

## Install

1. Choose [Light](stacks-hover-preview.user.js) for the original Stacks appearance or [Soft Dark](stacks-hover-preview-dark.user.js) for a charcoal theme across the site and preview card.
2. In Tampermonkey, choose **Create a new script**. Paste the chosen file's contents over the starter code and save. Keep one version enabled at a time.
3. Reload [Tag 0B3I](https://stacks.math.columbia.edu/tag/0B3I). In the last paragraph of the proof, hover over Lemma 29.45.11, Lemma 29.42.7, Lemma 27.13.4, or Lemma 26.10.4.

Move the pointer into the card to scroll through the proof or follow a reference. Keyboard focus also opens a preview. Press **Down Arrow** to enter the card or **Escape** to close it. Clicking the original reference still opens its tag page.

## If Tampermonkey says the URL is restricted

Open Tampermonkey on the actual Stacks page after saving the script. The preview runs on `https://stacks.math.columbia.edu/` pages, so use the toolbar there to check whether the script is enabled.

In Chrome, right-click the Tampermonkey icon, select **Manage extension**, and turn on **Allow User Scripts**. Under **Site access**, allow `https://stacks.math.columbia.edu`. In Edge, look for the same toggle in Tampermonkey's extension details. If your Chrome-based browser lacks that toggle, see the [Tampermonkey instructions for Developer mode](https://www.tampermonkey.net/faq.php?q=Q209). Reload the Stacks page after changing permissions.

## API and cache

- [The Stacks Project API](https://stacks.math.columbia.edu/api) documents `/data/tag/<tag>/content/full` for statements and proofs. The script requests that HTML after a short hover delay and renders the math using the Stacks page's own MathJax configuration.
- Successful previews are stored in the browser, per tag. Fresh hits require no API request. After 24 hours, the next hover shows the cached preview immediately while checking the API. Content is replaced only if the response changes. Temporary failures keep the cached preview and delay the next attempt for five minutes in that tab.
- Live responses for the four example tags, an affine schemes section, and an introduction section had no ETag or Last-Modified header. The script uses conditional requests if the API supplies either header and otherwise compares the HTML directly. The [Recent changes page](https://stacks.math.columbia.edu/recent-changes) covers only a [limited set of commits](https://github.com/gerby-project/gerby-website/blob/master/gerby/views/stacks.py), and the upstream repository can be ahead of the deployed site.
- Searches for dedicated Stacks hover-preview scripts and extensions found no equivalent public tool. Stacks already has some popover code, but the four example references on Tag 0B3I are ordinary links.

## Security and privacy

- Both versions match the Stacks HTTPS origin, run in the top-level page, and request no privileged userscript APIs. They make same-origin tag API requests without cookies or redirects and keep cached tag HTML in Stacks-origin browser storage. There is no analytics or external userscript dependency.
- Preview HTML is parsed in an inert template. The script builds the visible preview from an allowlist of HTML elements, attributes, and classes. It drops foreign markup, active elements, unsafe URL schemes, and off-site image sources, and bounds response size and markup traversal. Cached HTML passes through the same checks before display.
- The script uses the site's existing MathJax 2 renderer and enables its [Safe extension](https://docs.mathjax.org/en/v2.7/options/other/Safe.html) before typesetting a preview. It disables TeX-defined links, styles, classes, IDs, and extension loading for subsequent typesetting on that page. If Safe cannot load, the preview can still show the statement and proof with source TeX. The site's renderer and its configuration remain part of the trust boundary.

## Build and test

With Node.js 22 or later and Chrome installed, run from this folder:

```powershell
node test-live.mjs 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node test-live.mjs 'C:\Program Files\Google\Chrome\Application\chrome.exe' --dark
node build-dark.mjs --check
```

The test starts Chrome with a temporary profile and opens the live proof page. It checks four rendered previews, theme colors, HTML filtering, MathJax Safe settings, and cache behavior. Run `node build-dark.mjs` after editing the light script or `dark-theme.css` to regenerate the dark edition.

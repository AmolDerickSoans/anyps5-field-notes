# All software is open source

An independent interactive GitHub field study of [AnyPS5](https://github.com/boykopovar/AnyPS5).

The site is buildless. Serve `dist/` over HTTP to preview. GitHub Pages publishes the same directory through the included workflow.

Research snapshots and chart-template decisions live in `research/`. `scripts/prepare-data.py` normalizes the full saved commit/PR responses into `dist/data.json`. The published site ships a sanitized source manifest.

The original Anatomy instruction fixture uses the [MIT geometry kit](https://github.com/wheresryan22/anatomy). Chart implementations adapt [Lieflat Charts](https://github.com/larashero3-dotcom/lieflat-charts) under PolyForm Noncommercial 1.0.0. The official AnyPS5 progress diagram and data retain upstream GPL-2.0 terms. Full third-party terms are in `dist/assets/licenses/`; this project does not apply a blanket license to those separate works.

Raw responses with commit author metadata remain local; the public repository contains the minimized chart dataset, request provenance, pinned engineering evidence, and attributed upstream maps. Install the Anatomy kit under `vendor/anatomy` to rebuild the inspection figure; `node scripts/build-binary-figure.mjs --audit` validates its geometry.

# oxabl.org — design laws

This document is the authority for the visual identity of oxabl.org. It exists because the previous version of this site drifted into framework defaults — shadcn tokens untouched, rounded cards, soft shadows, a single hue tinting every neutral, seven identical sections — and read as generated rather than authored. The cause was the absence of written rules, not a lack of effort.

Read this before changing anything visual. If a change conflicts with a law below, the law wins, or the law gets amended here first. Do not resolve a conflict silently in a component.

## Who the site is for

**Primary: the working ABL/OpenEdge developer.** Likely on Windows, in an editor from another decade, has never had a formatter or a linter that understood their code. The job of the page is _"this exists, it works on your code, here's how to run it in sixty seconds."_ The emotion is relief.

**Secondary: the Rust/tooling audience.** They will never write ABL. They are here to admire an engineering artifact, and they are the ones who share the link. The middle of the page is theirs.

**Incidental: adopters and contributors.** One CI snippet and one footer line respectively. Neither gets a section, and neither shapes the design.

No block on the site tries to serve two audiences at once.

## The laws

1. **One grid law.** The 24px vertical baseline governs vertical spacing and layout. The five named type roles retain their specified line-heights as deliberate exceptions. Rules are 1px at full opacity. Corners are square everywhere. Boxes are made of lines meeting at true corners — never a fill, never a shadow, never a radius.
2. **The chrome is colorless. All color is real output.** Structure is ink on paper. Every colored pixel on the site comes from something oxabl actually emits: syntax highlighting, or diagnostic severity. No accent-colored buttons, no colored eyebrow labels, no colour-gradient washes, no decorative charts. An alpha mask that fades overflowing content, such as the keyword field, is permitted: it controls content visibility and is not a decorative colour gradient.
3. **Dark means interactive.** Dark panels are _screens_ — you touch them. Light areas are _printed_ — you read them. This is functional, not aesthetic: it teaches the reader where to put their hands without a single "try it!" label. Static copyable snippets are printed, not dark terminals, because darkness has to keep meaning something. Named exception: **the consumer block's producer pane** may remain a fixed, static screen beside its interactive consumers, because keeping the single producer and many consumers on one screen is what makes that argument legible.
4. **Nothing moves on its own. Everything moves when you touch it.** No entrance animations, no scroll-triggered reveals, no autoplay, no carousels, no counters ticking up. The hex floor idles at zero cost until the cursor enters. The playground parses when you type. The consumer block swaps when you click. Honor `prefers-reduced-motion` by removing the transition entirely, not by shortening it.
5. **Only real output. No gimmicks, no stunts.** Every number, transcript, token stream, diagnostic and benchmark figure on the page was produced by oxabl. If it is illustrated, it is real. Nothing is mocked up, and nothing is a fabricated diagram of a thing that doesn't run.
6. **The era flavor lives in the small type.** The '80s machine-panel reference (Michroma, Martian Mono) belongs in chrome: labels, part numbers, captions, readouts. Never in prose, never in code, never as a giant display headline. There is one named exception: **the single numeral** — one large numeric readout per page may be set in Martian Mono at display size, because it is the instrument-panel readout idiom rather than a sci-fi display headline. The `562` in the vocabulary block is that exception. Eurostile and OCR are one step from sci-fi cosplay, and scale is what separates the two.
7. **Green means clean.** Green is not a brand wash — it is the linter's pass state, and it appears only where code passes: the playground gutter, the check summary, the CI tab. The green phosphor heritage of the OpenEdge world is carried instead as _material_, in the faint hue cast of the screen grounds. Ambient green tints nothing.

## Typography

Four faces, each with one job. Geist and JetBrains Mono are removed.

| Role              | Face                   | Usage                                                                                                                                                                                                                                                                                                                             |
| ----------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wordmark          | **Michroma** (OFL)     | The single word `oxabl`, lowercase. A loaded webfont is acceptable for this version; optically corrected SVG outlines are a deferred refinement. One named exception: the **"what is oxabl"** heading, set lowercase at `heading` size — never larger — because that block's job is to name the thing, so the name sets the line. |
| Structural chrome | **Martian Mono** (OFL) | Section labels, crate names, table headers, figure captions, numeric readouts. Small, uppercase, tracked. Subset to uppercase + digits + punctuation.                                                                                                                                                                             |
| Display and prose | **IBM Plex Sans**      | Headlines and body text. Quiet and confident.                                                                                                                                                                                                                                                                                     |
| Real oxabl output | **IBM Plex Mono**      | Code, token streams, diagnostics, AST, shell transcripts.                                                                                                                                                                                                                                                                         |

**Hard rule: Martian Mono never appears in prose or in code.** It is chrome only. The moment it lands in a paragraph or a code block, the whole thing tips into costume.

Five sizes, and only five. The old site set every heading at `text-3xl sm:text-4xl`, which is why it read flat — seven sections all shouting at the same volume.

| Token     | Size / line-height           | Face         | Notes                               |
| --------- | ---------------------------- | ------------ | ----------------------------------- |
| `display` | 56 / 60, `-0.02em`           | Plex Sans    | 36 / 40 below `md`. One per page.   |
| `heading` | 24 / 32                      | Plex Sans    | Block headings.                     |
| `body`    | 17 / 28                      | Plex Sans    | Prose. Generous measure, ~68ch max. |
| `chrome`  | 12 / 16, `0.14em`, uppercase | Martian Mono | Labels and readouts.                |
| `code`    | 14 / 24                      | Plex Mono    | All emitted output.                 |

Nothing in between. If a size feels needed, the hierarchy is wrong.

The 24px baseline applies to vertical spacing and layout, not the internal metrics of type. The named role line-heights—60px, 32px, 28px, 16px, and 24px—are deliberate exceptions and must remain as specified.

Only two weights are permitted: 400 and 500. Wordmark, structural chrome, body, and code use 400. Display and heading roles use 500. Weight does not create additional roles or sizes.

The Michroma webfont is an accepted delivery choice for this version. Replacing the wordmark with optically corrected SVG outlines remains a deferred payload and optical-refinement task, not a current specification violation.

## Color

Two materials: **paper** and **screen**. Paper is warm-neutral with near-zero chroma. Screen is near-black with a whisper of hue 150 — a green-phosphor cast that is unmistakable when you look at it and invisible as "a green website."

Screens stay dark in both themes. A screen is a screen; it does not recolor when the page theme changes. In dark mode the screen ground goes _below_ the page ground so it still reads as a distinct object.

### Paper (light theme)

```
--paper            oklch(0.985 0.002 80)
--paper-sunk       oklch(0.965 0.003 80)
--ink              oklch(0.20  0.006 80)
--ink-muted        oklch(0.48  0.006 80)
--rule             oklch(0.86  0.004 80)
--rule-strong      oklch(0.72  0.005 80)
```

### Paper (dark theme)

```
--paper            oklch(0.17  0.004 80)
--paper-sunk       oklch(0.14  0.004 80)
--ink              oklch(0.94  0.004 80)
--ink-muted        oklch(0.66  0.005 80)
--rule             oklch(0.30  0.005 80)
--rule-strong      oklch(0.42  0.006 80)
```

### Screen (both themes; darker variant under dark)

```
--screen           oklch(0.16  0.010 150)   /* dark theme: 0.13 */
--screen-raised    oklch(0.21  0.012 150)
--screen-rule      oklch(0.32  0.014 150)
--screen-ink       oklch(0.93  0.006 150)
--screen-ink-muted oklch(0.66  0.008 150)
```

### Syntax theme

Four roles, one spot hue. Indigo carries structure; identifiers are plain ink. Red is not used for syntax, because red has to mean broken.

```
/* on screen */
--syn-keyword      oklch(0.72 0.10  265)
--syn-literal      oklch(0.80 0.055 265)
--syn-comment      oklch(0.61 0.008 150)
--syn-ident        var(--screen-ink)

/* printed on light paper */
--syn-keyword-print oklch(0.42 0.11  265)
--syn-literal-print oklch(0.52 0.07  265)
--syn-comment-print oklch(0.58 0.005  80)
--syn-ident-print   var(--ink)

/* printed on dark paper */
--syn-keyword-print oklch(0.74 0.10  265)
--syn-literal-print oklch(0.82 0.055 265)
--syn-comment-print oklch(0.62 0.005  80)
--syn-ident-print   var(--ink)
```

The paper syntax palette needs its own dark values because it is printed on paper, and paper is the material that moves between themes. The light-paper indigo sits at L 0.42, which measures 2.2:1 against dark paper — it does not survive the theme change, it disappears into it. `--syn-ident-print` needs no dark value: it is declared as `var(--ink)` and follows ink for free.

### Signal — severity only

These appear in diagnostics and check summaries. Never in chrome, never as a button, never as a label.

```
                paper (light)            paper (dark)             screen
--ok            oklch(0.62 0.14 150)     oklch(0.76 0.14 150)     oklch(0.78 0.15 150)
--error         oklch(0.55 0.20  25)     oklch(0.70 0.18  25)     oklch(0.70 0.18  25)
--warn          oklch(0.62 0.13  75)     oklch(0.80 0.12  75)     oklch(0.80 0.12  75)
```

`--ok` is the payoff of the entire site. It is the only green, and it fires when the reader's code passes.

On dark paper the signal colours converge with their screen counterparts, and `--error` and `--warn` land on exactly the same values. That is a consequence of the definition rather than a shortcut: these values are chosen to sit legibly on a dark ground, and under the dark theme both grounds are dark. The tokens stay separate because the _reason_ to use one or the other is the material, not the colour, and paper will move again if the palette is ever retuned.

**Known gap, light theme.** `--ok` measures 3.28:1 and `--warn` 3.57:1 against light paper — both clear AA for large text but not for body-sized text. Every other paper token clears AA in both themes. This predates the dark palette work and is recorded here rather than quietly fixed, because moving `--ok` is a change to the payoff colour of the site and deserves its own decision.

### Deleted

`--radius`, `--card-shadow`, `--chart-1` through `--chart-5`, `--oxabl-green`, `--oxabl-green-soft`, and every hue-150-tinted neutral. Nothing on the site has a border radius or a shadow.

## Theme default

**The default follows the reader's system preference.** This section used to read _"light is the default … if both end up equally strong, switch the default to follow the user's system preference"_ — and that condition is now met. Every paper-side token has a dark value, and on dark paper all of them clear AA.

Light is still the identity: it is where the ink-on-paper language comes from, it is what the screenshots show, and it is what a reader whose system expresses no preference receives. Following the system is a courtesy to the reader's own configuration, not a claim that the site is dark-first.

### The theme control

Three states, not two: **Auto · Light · Dark**. A two-state switch cannot express "follow the system", so the first touch would permanently strand the reader on an explicit choice and make the default unreachable. Auto is therefore stored as the _absence_ of a preference rather than as a third value, which is what lets a reader on Auto keep following their system — including when it changes mid-visit, which the control listens for.

It sits at the right end of the navbar as one bordered three-cell control, built from the same parts as everything else on the site: 1px rules, square corners, chrome type, `ink-muted` for the inactive cells, `ink` on `paper-sunk` for the active one. It carries **no icon**. The surface icons in block 4 remain the only pictograms here, and a sun-and-moon pair is the single most framework-default set of glyphs available — the exact look this document exists to prevent.

The theme is resolved by a small inline script in the head, before first paint, because a flash of the wrong material costs the reader more than the script weighs. Nothing about the change is animated: a whole-page colour crossfade is the page moving on its own, which law 4 forbids.

### Where dark mode is weakest

Under the dark theme, page ground (L 0.17) and screen ground (L 0.13) sit 1.05:1 apart. Law 3 asks darkness to mean _interactive_, and when the whole page is dark that signal is carried almost entirely by the 1px `--screen-rule` frame rather than by the ground beneath it. This is inherent to putting a dark theme on a paper-and-screen metaphor, and it is the honest cost of shipping one. If it proves too subtle in use, the lever is to take the dark-theme screen further down — not to lighten the page, which would break the light theme's identity.

## Page structure

Seven blocks. No two share a shape — that is what gives the page rhythm under a single grid law. Density varies per block: uniform `py-24` is what made the old page read as one long section.

| #   | Block          | Shape                                                                                   | Material       |
| --- | -------------- | --------------------------------------------------------------------------------------- | -------------- |
| 1   | **Masthead**   | One bordered instrument panel: separate text and dominant shader cells                  | paper + screen |
| 2   | **Playground** | Full-width interactive. Not a titled section — it _is_ the second screen                | screen         |
| 3   | **Vocabulary** | One enormous keyword count, beneath it the real keyword list as a dense monospace field | paper          |
| 4   | **What it is** | Centered wordmark-face heading, a full-width lead line, one ruled band of three icons   | paper          |
| 5   | **Pipeline**   | The crates as one bespoke diagram built to the grid, each carrying its own description  | paper          |
| 6   | **Speed**      | One honest benchmark table — files, lines, bytes, milliseconds                          | paper          |
| 7   | **Run it**     | Install, CLI invocations, a CI snippet, and the one-output-many-consumers block         | paper + screen |
| —   | **Footer**     | Contribute line, license, crates links, the no-affiliation disclaimer                   | paper          |

The thesis sentence is **"ABL developers deserve modern toolchains."** It leads the masthead. It was previously buried two-thirds down the page under a green eyebrow label while the hero opened with a feature list.

Features and pipeline were previously the same six things told twice, in two visual treatments, across ~350 lines. The crates _are_ the features; block 4 absorbs both.

### The what-it-is block

It sits between the vocabulary and pipeline blocks and answers the plainest question on the page. Only the heading is centered — it is the one place where the page states its reason rather than demonstrating it — and it is set in Michroma at `heading` size. The line below it is left-aligned; centered prose is never correct on this site.

That line is a **lead**, not prose, and it is the one named exception to the ~68ch measure: one or two short sentences set at `heading` size in weight 400, spanning the full grid width so the line runs left-to-right across the block. It is sized to be read at a glance and measured to the box beneath it, so it reads as that box's caption rather than as a column of text someone has to settle into. The exception is narrow on purpose — it holds for the sentences that state what oxabl is, and it must land in two lines; a third line means the copy is too long, not that the measure should grow. Any paragraph the reader is expected to actually read stays at `body` and ~68ch.

Beneath it, one bordered box split into three cells by 1px rules, built to the same shape as the install block: CLI, LSP, CI. It is a single short horizontal band — three equal cells at every width, never stacking. Each cell holds a centered line-drawn icon and one `chrome` caption beneath it naming where that surface runs: _for your terminal_, _for your editor_, _for your CI_. Nothing else — no command, no prose. The install block already prints the commands, and repeating them here would make the two boxes the same object twice. The caption says where it runs and the icon says what it is, so the surface acronym itself is needed only as the icon's accessible name.

The icons are the only pictograms on the site, and they follow law 2 without exception: 1px strokes in `--ink-muted`, no fill, no radius, no colour, drawn on the same grid as everything else. A filled or coloured icon set would reintroduce exactly the framework-default look this document exists to prevent.

### The consumer block

One bordered box, split by a 1px vertical rule. Left: a single `oxabl analyze --json` payload, fixed, never changing. Right: what consumed it — swapped by a row of tracked-mono tabs along the top edge (`jq` · `grep` · `ci` · `agent`). The fixed-left/variable-right composition _is_ the argument, so the copy does not have to make it.

Every tab's output is a real transcript that was actually run. Crossfade opacity only, ~120ms, on the right panel alone — no slide, no scale, no height animation (which would reflow and break the baseline). Under `prefers-reduced-motion`, swap instantly with no transition.

The `agent` tab is how AI capability appears on this site: fourth in a list of ordinary tools, as a demonstration rather than a claim. There is no AI section, and nothing above the fold mentions agents.

### The hex shader

`HexHero.tsx` + `hex/hexFloat.ts` stay, and every one of their gates stays: WebGL2 detection, `prefers-reduced-motion`, minimum viewport, and the FPS probe that tears the canvas down and reveals the static fallback. `float: 0` keeps the loop idle at zero cost until the cursor enters. This is the most carefully built thing on the site.

The masthead is one large bordered instrument panel spanning the `max-w-7xl` content width. The paper text cell and dominant screen shader cell begin at the panel's top edge and are divided directly by 1px rules. On desktop the cells sit side by side at roughly 40% text / 60% shader, both filling the panel height; the panel has a minimum height of `min(78vh, 760px)` and the shader cell is at least 480px tall. Below `md` the cells stack, the shader sits below the text, and it is at least 360px tall. The static `.hero-grid` fallback lives inside and fills the shader cell.

A shader too small to get a cursor into loses the whole point of the site's best interactive object. The shader therefore gets the dominant cell, but remains contained: the headline and all masthead copy stay in the separate paper cell, never on top of the canvas. A full-bleed `absolute inset-0` shader background remains forbidden. `iridescence` stays at `0.35`: a sheen across the bevels rather than a rainbow. Holographic iridescence is the signature of the aesthetic this redesign exists to escape.

The static CSS fallback is rebuilt to match the panel — dark and contained, not a hue-tinted full-bleed wash.

## Naming

`oxabl`, lowercase, everywhere. No underscore, no `ox_abl`, no `Oxidized_ABL` tagline. The repo, the domain, the crates and the binary are all `oxabl`, and what people read should be what they type. "Oxidized X" is now a genre convention and reads as derivative rather than explanatory.

The keycap mark is retired. Wordmark only — one fewer bespoke object to keep consistent.

### The icon

There is exactly one exception to "wordmark only", and it is not a separate mark: the icon is the wordmark's own `o`, in Michroma. It exists **only where a square asset is mandatory** — the favicon and the browser tab. It never appears on the site, never sits beside the wordmark in the navbar, and is never used as a logo. A five-letter wordmark cannot survive a 16px tile, so the icon is the wordmark cropped to one glyph rather than a second object to keep consistent.

The `o` is green as a quiet homage to Progress ABL's long association with the colour. This is a deliberate exception to the site's palette, contained entirely within the browser icon. There is no tile, frame, background, or theme variant: the transparent ground lets the same simple shape read naturally against light and dark browser chrome.

One artwork ships, tuned for 16px, encoded as both `favicon.svg` and `favicon.ico`. The `.ico` is not a second design — it is the same transparent artwork in the raster container Safari will load.

## Navigation

A single 1px-ruled bar: wordmark left, `playground` · `github` · `crates` right. Nothing else. A sticky in-page anchor menu on a six-block single-page site is a template reflex, and three links fit on a phone without a sheet.

## Removed components

`HoverGlow.tsx`, `MobileNav.tsx`, `ui/sheet.tsx`, `ui/card.tsx` (a card with no radius and no shadow is a bordered div), and the six feature graphics — `AstGraphic`, `TokenGraphic`, `SemanticGraphic`, `PreprocGraphic`, `SchemaGraphic`, `PerfGraphic` — along with the feature grid that hosted them.

## Content dependencies

**Keyword counts and the keyword list** come from the oxabl workspace at `~/oxabl`, not from this repo. Vendor a generated JSON into `src/data/` the same way the WASM artifact is vendored, and read it at build time. Record the regeneration command in `CLAUDE.md`.

**Benchmark figures** must come from ABL that can be published — synthetic or public sample code, generated at whatever scale makes the point honestly. Performance results are described in bytes and milliseconds; line counts are also permitted for publishable fixtures committed in the oxabl workspace because the primary ABL audience leads with lines. Do not reference any private corpus, its provenance, its size, its file count, or its pass rate; scrub the mention, not just the data.

## How this document keeps working

Every law here exists because its absence produced a specific defect in the previous site. The failure mode is not one bad decision — it is a hundred small defaults accumulating until nothing has an opinion. When adding to the site, the question is not "does this look fine?" but "which law does this follow?" If the answer is none, it does not ship.

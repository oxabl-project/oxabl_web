# Residual review findings — `fix/mobile-layout`

Code review run 2026-08-14 against `master` (`6ed7376`), plan
`docs/plans/2026-08-14-001-fix-mobile-layout-plan.md`. Six reviewers: correctness,
adversarial, frontend-races, project-standards, maintainability, testing.

Findings that were **applied** are in commits `19f158b` and `a3647a5`. What follows is
what was reviewed, judged real, and deliberately **not** acted on. Nothing here blocks
the change.

## Accepted, not fixed

**Theme control coupling has no back-reference.** `src/styles/global.css` reaches into
`ThemeControl.astro`'s rendered DOM (`[data-menu-panel] [data-theme-control] > button`)
to give its cells a 44px touch target inside the panel. `global.css` documents its side
of that dependency; `ThemeControl.astro` carries no comment saying its DOM shape is
load-bearing for something outside it. A structural edit there would silently drop the
touch target with no build error. Not fixed because the plan's KTD5 fences that file off
— its whole reuse argument rests on the component staying untouched.

**`env(safe-area-inset-bottom)` is inert today.** The panel's
`pb-[max(24px,env(safe-area-inset-bottom))]` resolves to a flat 24px, because
`src/layouts/main.astro` sets `<meta name="viewport" content="width=device-width">`
with no `viewport-fit=cover`. That is not a bug — without `viewport-fit=cover` iOS
already insets the layout viewport so the home indicator area is excluded, so 24px is
genuinely enough. The `max()` is a harmless no-op that starts working if
`viewport-fit=cover` is ever added. Adding it now was rejected as out of scope: it
changes layout site-wide on notched devices (content can run under the notch in
landscape) and nothing here can verify that without a device.

**Scrollbar collapse can trip the width backstop.** `lockScroll()` sets
`position: fixed` on `<body>`, which removes the classic scrollbar and widens the
viewport by its gutter. At a width sitting within a scrollbar's width below 640px, that
could push `matchMedia("(min-width: 40rem)")` into matching and self-close the panel.
Anchor 50 — mobile browsers use overlay scrollbars, so the band where this bites is
narrow and desktop-only. Fix if it ever shows up: capture
`window.innerWidth - document.documentElement.clientWidth` before locking and set it as
`padding-right`, clearing it alongside the other three styles.

**Modifier-click on the in-page link takes the fragment exemption.** Cmd/Ctrl/middle
clicking `#playground` opens a new tab but still hits the `href.startsWith("#")` branch,
so this page's scroll offset is released without being restored. Anchor 50, cosmetic.
Fix: gate the branch on `event.button === 0 && !event.metaKey && !event.ctrlKey &&
!event.shiftKey && !event.altKey`.

**Both mobile diagram blocks are doubly inset on small phones.** The section's `px-4`
plus the block's own `px-6` leaves roughly 140px of text measure inside a
`.pipeline-node` at 320px, so the longest captions wrap to six or eight lines and the
box no longer lines up with the headings above it. `DESIGN.md` documents the centred
inset as intended (R14), so this is a judgement call about how much inset, not a defect
— but nobody has looked at it in a browser.

## The gap that matters most

**No visual verification of any kind was performed.** No browser was opened and no
device was used; the repo has no test runner and adding one was deferred by the plan.
Desktop invariance (R2) was proven structurally instead — every unvariant display
utility precedes its variant in the built stylesheet, and the built `dist/index.html`
was diffed before and after the label refactor to confirm the desktop trees come out
byte-identical. That is strong evidence but it is not a screenshot.

Highest-value manual pass, roughly ten minutes:

1. At 375px, open the panel: it should come up from the bottom edge, not stretch to
   full height, and not reflow the page behind it into a narrow column.
2. Close it five ways — Escape, the close control, the backdrop, the `playground` link,
   and by widening past 640px — and after each one confirm `<body>` carries no leftover
   `position: fixed` and the scroll offset is where you left it. The `playground` link
   should leave you at the playground, not back where you started.
3. On a real iOS device, with the panel open, drag outside it: the page behind must not
   scroll or rubber-band. This is the one scenario that does not reproduce in devtools
   emulation, and the plan says so explicitly.
4. Tab through the open panel and past the last item; focus must not reach the hero or
   footer behind it.
5. Compare 768px, 1024px, 1280px and 1440px against `master` in both themes.
6. At 320px, check the pipeline and benchmark blocks for caption readability and that
   nothing overflows its border.

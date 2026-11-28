import * as React from "react"

/**
 * The playground's static shell. It loads nothing heavy: Monaco, the worker
 * and the WASM engine arrive only after the visitor clicks the button, never
 * on page load and never because the section scrolled into view.
 */

const LOAD_SIZE = "about 1.7 MB"

type Phase = "idle" | "loading" | "error"

const subscribeNothing = () => () => {}

export function TryOxabl() {
  const [Playground, setPlayground] =
    React.useState<React.ComponentType | null>(null)
  const [phase, setPhase] = React.useState<Phase>("idle")
  // The server-rendered button is inert until React attaches its handler, so
  // it stays disabled until then rather than swallowing an early click.
  const hydrated = React.useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false
  )

  async function load() {
    setPhase("loading")
    try {
      const module = await import("./Playground")
      setPlayground(() => module.Playground)
    } catch {
      setPhase("error")
    }
  }

  if (Playground) return <Playground />

  return (
    <div className="screen-material border border-screen-rule bg-screen text-screen-ink">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-screen-rule px-4 py-3 font-chrome text-chrome uppercase md:py-0">
        <span className="text-screen-ink">Playground / sports2000 project</span>
        <span className="text-screen-ink-muted">oxabl_wasm · web worker</span>
      </div>

      <div className="flex min-h-[528px] flex-col items-start justify-center gap-6 px-4 py-12 md:px-6">
        <button
          type="button"
          onClick={() => void load()}
          disabled={!hydrated || phase === "loading"}
          data-playground-load
          className="inline-flex h-12 items-center border border-screen-ink-muted bg-screen px-4 font-chrome text-chrome text-screen-ink uppercase transition-colors hover:bg-screen-raised disabled:cursor-wait disabled:opacity-50"
        >
          {phase === "loading" ? "Loading…" : "Load demo playground"}
        </button>
        <p
          className="max-w-prose font-code text-code text-screen-ink-muted"
          aria-live="polite"
        >
          {phase === "error"
            ? "The playground could not be downloaded. Check your connection and try again."
            : `Loads the Monaco editor and the oxabl engine, ${LOAD_SIZE}, and runs a five-file Sports2000 project in this browser.`}
        </p>
      </div>

      <div className="flex min-h-[72px] items-center border-t border-screen-rule px-4 py-3 font-code text-code text-screen-ink-muted md:px-6">
        The editor and the engine download only when you click. Nothing you type
        leaves the page.
      </div>
    </div>
  )
}

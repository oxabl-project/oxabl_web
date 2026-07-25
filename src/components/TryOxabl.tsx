import * as React from "react"
import {
  analyze as analyzeSource,
  crashReportUrl,
  format as formatSource,
  isTerminal,
  type Diagnostic,
  type OxablFailure,
} from "@/lib/oxabl"

const example = `DEFINE VARIABLE customer-name AS CHARACTER NO-UNDO.
DEFINE VARIABLE unused-count AS INTEGER NO-UNDO.

customer-name = "Ada".
IF TRUE THEN
MESSAGE customer-name.`

function summarize(count: number, startedAt: number): string {
  const elapsed = (performance.now() - startedAt).toFixed(1)
  return `${count} diagnostic${count === 1 ? "" : "s"} · ${elapsed}ms`
}

/** The short line beside the status dot. Never the full crash message. */
function failureHeadline(failure: OxablFailure): string {
  switch (failure.kind) {
    case "crash":
      return `Internal error · engine ${failure.version} · recovered`
    case "unsupported":
      return "Unsupported browser"
    case "stale-artifact":
      return "Engine build mismatch · reload required"
    case "load":
      return "Engine failed to load · try again"
  }
}

export function TryOxabl() {
  const [source, setSource] = React.useState(example)
  const [diagnostics, setDiagnostics] = React.useState<Diagnostic[]>([])
  const [status, setStatus] = React.useState("Loading Oxabl…")
  const [busy, setBusy] = React.useState(true)
  // Carried explicitly rather than inferred from an empty `diagnostics` array:
  // an empty array renders the cheerful "No diagnostics" box, which beside a red
  // dot would tell the visitor everything is fine.
  const [failure, setFailure] = React.useState<OxablFailure | null>(null)

  // A terminal failure cannot be retried without a page reload, so the controls
  // stay disabled rather than re-enabling when the work finishes.
  const terminal = failure !== null && isTerminal(failure)
  const disabled = busy || terminal

  const analyze = React.useCallback(async (nextSource: string) => {
    setBusy(true)
    const started = performance.now()
    const result = await analyzeSource(nextSource)
    if (result.ok) {
      setFailure(null)
      setDiagnostics(result.value.diagnostics)
      setStatus(summarize(result.value.diagnostics.length, started))
    } else {
      // Drop the previous run's diagnostics: presenting them beside a crash
      // notice would show stale results as current.
      setDiagnostics([])
      setFailure(result.failure)
      setStatus(failureHeadline(result.failure))
    }
    setBusy(false)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    const started = performance.now()

    void analyzeSource(example).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setDiagnostics(result.value.diagnostics)
        setStatus(summarize(result.value.diagnostics.length, started))
      } else {
        setFailure(result.failure)
        setStatus(failureHeadline(result.failure))
      }
      setBusy(false)
    })

    return () => {
      cancelled = true
    }
  }, [])

  async function format() {
    setBusy(true)
    const started = performance.now()
    const result = await formatSource(source)

    if (!result.ok) {
      setDiagnostics([])
      setFailure(result.failure)
      setStatus(failureHeadline(result.failure))
      setBusy(false)
      return
    }

    // A formatter *bail* is a successful call: the formatter declined to rewrite
    // input it could not reproduce faithfully, and returned the original bytes.
    // That is a normal outcome, not a crash — keep it visibly distinct.
    if (result.value.error) {
      setFailure(null)
      setStatus(`Formatter left source unchanged · ${result.value.error}`)
      setBusy(false)
      return
    }

    setSource(result.value.source)
    const analyzed = await analyzeSource(result.value.source)
    if (analyzed.ok) {
      setFailure(null)
      setDiagnostics(analyzed.value.diagnostics)
      setStatus(
        `${result.value.changed ? "Formatted" : "Already formatted"} · ${(performance.now() - started).toFixed(1)}ms`
      )
    } else {
      setDiagnostics([])
      setFailure(analyzed.failure)
      setStatus(failureHeadline(analyzed.failure))
    }
    setBusy(false)
  }

  const dotClass = failure
    ? "bg-destructive"
    : busy
      ? "animate-pulse bg-amber-500"
      : "bg-oxabl-green"

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card [box-shadow:var(--card-shadow)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`size-2 rounded-full ${dotClass}`} />
          <span>{status}</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => void analyze(source)}
            className="inline-flex h-9 items-center rounded-4xl border border-border bg-background px-4 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-50"
          >
            Analyze
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void format()}
            className="inline-flex h-9 items-center rounded-4xl bg-primary px-4 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-50"
          >
            Format
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]">
        <label className="relative min-h-80 border-b border-border lg:border-r lg:border-b-0">
          <span className="sr-only">ABL source</span>
          <textarea
            value={source}
            onChange={(event) => setSource(event.target.value)}
            spellCheck={false}
            className="absolute inset-0 size-full resize-none bg-background/50 p-5 font-mono text-[13px] leading-6 text-foreground outline-none"
          />
        </label>

        <div className="min-h-64 bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
            <span>Diagnostics</span>
            <span>single file</span>
          </div>
          {failure ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <p className="font-medium text-destructive">
                {failure.kind === "crash"
                  ? "Oxabl hit an internal error"
                  : failureHeadline(failure)}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {failure.message}
              </p>
              {failure.kind === "crash" && (
                <>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Diagnostics are unavailable for this run. The engine has
                    restarted, so you can edit and try again without reloading.
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Engine build {failure.version}
                  </p>
                  <a
                    href={crashReportUrl(failure, source)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex h-8 items-center rounded-4xl border border-border bg-background px-3 text-[11px] font-medium transition-colors hover:bg-muted"
                  >
                    Report this input
                  </a>
                </>
              )}
            </div>
          ) : diagnostics.length === 0 ? (
            <div className="rounded-2xl border border-oxabl-green/20 bg-oxabl-green/5 p-4 text-sm text-muted-foreground">
              No diagnostics. Try removing a period or adding an unused
              variable.
            </div>
          ) : (
            <ol className="space-y-2">
              {diagnostics.map((diagnostic, index) => (
                <li
                  key={`${diagnostic.code}-${diagnostic.start.byte}-${index}`}
                  className="rounded-2xl border border-border bg-card p-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-[10px]">
                    <span
                      className={
                        diagnostic.severity === "error"
                          ? "text-destructive"
                          : "text-amber-600 dark:text-amber-400"
                      }
                    >
                      {diagnostic.severity}
                    </span>
                    <span className="text-oxabl-green">{diagnostic.code}</span>
                    <span className="ml-auto text-muted-foreground">
                      {diagnostic.start.line}:{diagnostic.start.column}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-foreground">
                    {diagnostic.message}
                  </p>
                  {diagnostic.help && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {diagnostic.help}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="border-t border-border px-4 py-3 text-[10px] leading-relaxed text-muted-foreground">
        Runs locally in your browser. This demo uses Oxabl’s shared single-file
        analysis and safe formatter; project includes and schema-backed checks
        remain CLI/LSP capabilities.
      </div>
    </div>
  )
}

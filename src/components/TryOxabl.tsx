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
  const [status, setStatus] = React.useState("Loading oxabl…")
  const [busy, setBusy] = React.useState(true)
  const [passed, setPassed] = React.useState(false)
  const analysisSequence = React.useRef(0)
  const formattedSource = React.useRef<string | null>(null)
  const initialAnalysisScheduled = React.useRef(false)
  // Carried explicitly rather than inferred from an empty `diagnostics` array:
  // an empty array renders the cheerful pass state, which beside a red failure
  // notice would tell the visitor everything is fine.
  const [failure, setFailure] = React.useState<OxablFailure | null>(null)

  // A terminal failure cannot be retried without a page reload, so the controls
  // stay disabled rather than re-enabling when the work finishes.
  const terminal = failure !== null && isTerminal(failure)
  const disabled = busy || terminal

  const analyze = React.useCallback(async (nextSource: string) => {
    const sequence = ++analysisSequence.current
    setBusy(true)
    setPassed(false)
    const started = performance.now()
    const result = await analyzeSource(nextSource)
    if (sequence !== analysisSequence.current) return

    if (result.ok) {
      setFailure(null)
      setDiagnostics(result.value.diagnostics)
      setPassed(result.value.diagnostics.length === 0)
      setStatus(summarize(result.value.diagnostics.length, started))
    } else {
      // Drop the previous run's diagnostics: presenting them beside a crash
      // notice would show stale results as current.
      setDiagnostics([])
      setPassed(false)
      setFailure(result.failure)
      setStatus(failureHeadline(result.failure))
    }
    setBusy(false)
  }, [])

  React.useEffect(() => {
    if (formattedSource.current === source) {
      formattedSource.current = null
      return
    }
    if (terminal) return

    const delay = initialAnalysisScheduled.current ? 250 : 0
    initialAnalysisScheduled.current = true
    const timeout = window.setTimeout(() => void analyze(source), delay)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [analyze, source, terminal])

  async function format() {
    const sequence = ++analysisSequence.current
    setBusy(true)
    setPassed(false)
    const started = performance.now()
    const result = await formatSource(source)
    if (sequence !== analysisSequence.current) return

    if (!result.ok) {
      setDiagnostics([])
      setPassed(false)
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
      setPassed(false)
      setStatus(`Formatter left source unchanged · ${result.value.error}`)
      setBusy(false)
      return
    }

    formattedSource.current = result.value.source
    setSource(result.value.source)
    const analyzed = await analyzeSource(result.value.source)
    if (sequence !== analysisSequence.current) return

    if (analyzed.ok) {
      setFailure(null)
      setDiagnostics(analyzed.value.diagnostics)
      setPassed(analyzed.value.diagnostics.length === 0)
      setStatus(
        `${result.value.changed ? "Formatted" : "Already formatted"} · ${(performance.now() - started).toFixed(1)}ms`
      )
    } else {
      setDiagnostics([])
      setPassed(false)
      setFailure(analyzed.failure)
      setStatus(failureHeadline(analyzed.failure))
    }
    setBusy(false)
  }

  const hasErrors = diagnostics.some(
    (diagnostic) => diagnostic.severity === "error"
  )
  const hasDiagnostics = diagnostics.length > 0
  const clean = !busy && !failure && passed && !hasDiagnostics
  const dotClass = hasErrors
    ? "bg-error-screen"
    : hasDiagnostics
      ? "bg-warn-screen"
      : clean
        ? "bg-ok-screen"
        : "bg-screen-ink-muted"
  const statusClass = hasErrors
    ? "text-error-screen"
    : hasDiagnostics
      ? "text-warn-screen"
      : clean
        ? "text-ok-screen"
        : "text-screen-ink-muted"

  return (
    <div className="screen-material border border-screen-rule bg-screen text-screen-ink">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-screen-rule px-4 py-3 font-chrome text-chrome uppercase md:py-0">
        <span className="text-screen-ink">Playground / single file</span>
        <span className="text-screen-ink-muted">oxabl_wasm · runs locally</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-screen-rule px-6 py-6">
        <div
          className={`flex items-center gap-2 font-code text-code ${statusClass}`}
        >
          <span className={`size-2 ${dotClass}`} aria-hidden="true" />
          <span aria-live="polite">{clean ? `Clean · ${status}` : status}</span>
        </div>
        <div className="flex gap-2 font-chrome text-chrome uppercase">
          <button
            type="button"
            disabled={disabled}
            onClick={() => void analyze(source)}
            className="inline-flex h-12 items-center border border-screen-rule bg-screen px-4 text-screen-ink transition-colors hover:bg-screen-raised disabled:cursor-wait disabled:opacity-50"
          >
            Analyze
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void format()}
            className="inline-flex h-12 items-center border border-screen-ink-muted bg-screen px-4 text-screen-ink transition-colors hover:bg-screen-raised disabled:cursor-wait disabled:opacity-50"
          >
            Format
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]">
        <label className="relative min-h-[432px] overflow-hidden border-b border-screen-rule lg:border-r lg:border-b-0">
          <span className="sr-only">ABL source</span>
          <textarea
            value={source}
            onChange={(event) => {
              analysisSequence.current += 1
              setSource(event.target.value)
              setPassed(false)
              setDiagnostics([])
              if (!terminal) {
                setFailure(null)
                setStatus("Waiting for oxabl analysis…")
                setBusy(true)
              }
            }}
            spellCheck={false}
            className="absolute inset-0 size-full resize-none bg-transparent p-6 font-code text-code text-screen-ink caret-screen-ink"
          />
        </label>

        <div className="min-h-[336px] p-6">
          <div className="mb-6 flex flex-col gap-1 font-chrome text-chrome text-screen-ink-muted uppercase sm:flex-row sm:items-center sm:justify-between sm:gap-0">
            <span>Diagnostics</span>
            <span>live engine output</span>
          </div>
          {failure ? (
            <div className="border border-screen-rule p-4 font-code text-code">
              <p className="text-screen-ink">
                {failure.kind === "crash"
                  ? "oxabl hit an internal error"
                  : failureHeadline(failure)}
              </p>
              <p className="mt-2 text-screen-ink-muted">{failure.message}</p>
              {failure.kind === "crash" && (
                <>
                  <p className="mt-2 text-screen-ink-muted">
                    Diagnostics are unavailable for this run. The engine has
                    restarted, so you can edit and try again without reloading.
                  </p>
                  <p className="mt-1 text-screen-ink-muted">
                    Engine build {failure.version}
                  </p>
                  <a
                    href={crashReportUrl(failure, source)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-6 inline-flex h-12 items-center border border-screen-rule px-3 font-chrome text-chrome text-screen-ink uppercase hover:bg-screen-raised"
                  >
                    Report this input
                  </a>
                </>
              )}
            </div>
          ) : clean ? (
            <div className="border border-ok-screen p-4 font-code text-code text-ok-screen">
              <p>PASS · no diagnostics</p>
              <p className="mt-2 text-screen-ink-muted">
                Remove a period or add an unused variable to see the signal.
              </p>
            </div>
          ) : diagnostics.length > 0 ? (
            <ul className="m-0 list-none space-y-3 p-0">
              {diagnostics.map((diagnostic, index) => (
                <li
                  key={`${diagnostic.code}-${diagnostic.start.byte}-${index}`}
                  className="border border-screen-rule p-4 font-code text-code"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        diagnostic.severity === "error"
                          ? "text-error-screen"
                          : "text-warn-screen"
                      }
                    >
                      {diagnostic.severity}
                    </span>
                    <span className="text-screen-ink-muted">
                      {diagnostic.code}
                    </span>
                    <span className="ml-auto text-screen-ink-muted">
                      {diagnostic.start.line}:{diagnostic.start.column}
                    </span>
                  </div>
                  <p className="mt-2 text-screen-ink">{diagnostic.message}</p>
                  {diagnostic.help && (
                    <p className="mt-1 text-screen-ink-muted">
                      {diagnostic.help}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="border border-screen-rule p-4 font-code text-code text-screen-ink-muted">
              Waiting for engine output.
            </div>
          )}
        </div>
      </div>

      <div className="flex min-h-[72px] items-center border-t border-screen-rule px-6 font-code text-code text-screen-ink-muted">
        Shared single-file analysis and safe formatting run in this browser.
        Project includes and schema-backed checks remain CLI/LSP capabilities.
      </div>
    </div>
  )
}

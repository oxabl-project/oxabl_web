import * as React from "react"
import initOxabl, { analyze_source, format_source } from "@/wasm/oxabl_wasm.js"

type Diagnostic = {
  source: "parse" | "preproc" | "semantic" | "lint"
  severity: "error" | "warning" | "info" | "hint"
  code: string
  message: string
  start: Position
  end: Position
  help: string | null
}

type Position = {
  byte: number
  line: number
  column: number
}

type AnalyzeResponse = {
  diagnostics: Diagnostic[]
}

type FormatResponse = {
  source: string
  changed: boolean
  error: string | null
}

type OxablWasm = {
  analyze_source: typeof analyze_source
  format_source: typeof format_source
}

const example = `DEFINE VARIABLE customer-name AS CHARACTER NO-UNDO.
DEFINE VARIABLE unused-count AS INTEGER NO-UNDO.

customer-name = "Ada".
IF TRUE THEN
MESSAGE customer-name.`

let wasmPromise: Promise<OxablWasm> | undefined

function loadOxabl() {
  if (!wasmPromise) {
    wasmPromise = initOxabl().then(() => ({
      analyze_source,
      format_source,
    }))
  }
  return wasmPromise
}

function parse<T>(json: string): T {
  return JSON.parse(json) as T
}

export function TryOxabl() {
  const [source, setSource] = React.useState(example)
  const [diagnostics, setDiagnostics] = React.useState<Diagnostic[]>([])
  const [status, setStatus] = React.useState("Loading Oxabl…")
  const [busy, setBusy] = React.useState(true)

  const analyze = React.useCallback(async (nextSource: string) => {
    setBusy(true)
    const started = performance.now()
    try {
      const wasm = await loadOxabl()
      const result = parse<AnalyzeResponse>(wasm.analyze_source(nextSource))
      setDiagnostics(result.diagnostics)
      setStatus(
        `${result.diagnostics.length} diagnostic${result.diagnostics.length === 1 ? "" : "s"} · ${(performance.now() - started).toFixed(1)}ms`
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Oxabl failed to load")
    } finally {
      setBusy(false)
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    const started = performance.now()

    void loadOxabl()
      .then((wasm) => {
        if (cancelled) return
        const result = parse<AnalyzeResponse>(wasm.analyze_source(example))
        setDiagnostics(result.diagnostics)
        setStatus(
          `${result.diagnostics.length} diagnostic${result.diagnostics.length === 1 ? "" : "s"} · ${(performance.now() - started).toFixed(1)}ms`
        )
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setStatus(
          error instanceof Error ? error.message : "Oxabl failed to load"
        )
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function format() {
    setBusy(true)
    const started = performance.now()
    try {
      const wasm = await loadOxabl()
      const result = parse<FormatResponse>(wasm.format_source(source))
      if (result.error) {
        setStatus(`Formatter left source unchanged · ${result.error}`)
        return
      }
      setSource(result.source)
      const analyzed = parse<AnalyzeResponse>(
        wasm.analyze_source(result.source)
      )
      setDiagnostics(analyzed.diagnostics)
      setStatus(
        `${result.changed ? "Formatted" : "Already formatted"} · ${(performance.now() - started).toFixed(1)}ms`
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Oxabl failed to run")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card [box-shadow:var(--card-shadow)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={`size-2 rounded-full ${busy ? "animate-pulse bg-amber-500" : "bg-oxabl-green"}`}
          />
          <span>{status}</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void analyze(source)}
            className="inline-flex h-9 items-center rounded-4xl border border-border bg-background px-4 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-50"
          >
            Analyze
          </button>
          <button
            type="button"
            disabled={busy}
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
          {diagnostics.length === 0 ? (
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

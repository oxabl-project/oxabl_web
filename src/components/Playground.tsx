import * as React from "react"
import {
  CONFIG_PATH,
  DEFAULT_FILE,
  DEFAULT_PROJECT,
  folderOf,
  openRequest,
} from "@/data/playground/project"
import {
  EDITOR_OPTIONS,
  diagnosticsToMarkers,
  formatEdits,
  modelUri,
  monaco,
  pathOfModel,
  refreshInlayHints,
  registerFileOpener,
  registerProviders,
  setupMonaco,
  snapshotOf,
  themeNameFor,
  type ProviderContext,
} from "@/lib/monacoAbl"
import {
  OxablClient,
  crashReportUrl,
  isTerminal,
  type OxablFailure,
  type WireConfigWarning,
  type WireDiagnostic,
} from "@/lib/oxablClient"
import { byteOffsetToMonacoPosition } from "@/lib/positions"

const PATHS = DEFAULT_PROJECT.map((file) => file.path)
const ORIGINALS: ReadonlyMap<string, string> = new Map(
  DEFAULT_PROJECT.map((file) => [file.path, file.text])
)
const EDIT_DEBOUNCE_MS = 200

type FileReport = {
  diagnostics: WireDiagnostic[]
  warnings: WireConfigWarning[]
}

type Reports = Record<string, FileReport>

/** One row of the Problems list, from either a diagnostic or a config warning. */
type Problem = {
  path: string
  severity: WireDiagnostic["severity"]
  code: string
  message: string
  line: number
  column: number
  byte: number | null
}

function problemsOf(path: string, report: FileReport | undefined): Problem[] {
  if (!report) return []
  const rows: Problem[] = report.diagnostics.map((d) => ({
    path,
    severity: d.severity,
    code: d.code,
    message: d.help ? `${d.message} ${d.help}` : d.message,
    line: d.start.line,
    column: d.start.column,
    byte: d.start.byte,
  }))
  rows.sort((a, b) => a.line - b.line || a.column - b.column)
  for (const w of report.warnings) {
    rows.push({
      path,
      severity: "warning",
      code: w.kind,
      message: w.message,
      line: 0,
      column: 0,
      byte: null,
    })
  }
  return rows
}

/** The short line beside the status dot. Never the full crash message. */
function failureHeadline(failure: OxablFailure): string {
  switch (failure.kind) {
    case "crash":
      return `Internal error · engine ${failure.version} · recovered`
    case "timeout":
      return "Engine timed out · restarted"
    case "unsupported":
      return "Unsupported browser"
    case "stale-artifact":
      return "Engine build mismatch · reload required"
    case "load":
      return "Engine failed to load · try again"
  }
}

function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1)
}

const SEVERITY_CLASS: Record<WireDiagnostic["severity"], string> = {
  error: "text-error-screen",
  warning: "text-warn-screen",
  info: "text-syn-keyword",
  hint: "text-screen-ink-muted",
}

const BUTTON =
  "inline-flex h-12 items-center border border-screen-rule bg-screen px-4 text-screen-ink transition-colors hover:bg-screen-raised disabled:cursor-wait disabled:opacity-50"

/** What the Monaco side of the playground exposes to the rest of the component. */
type Session = {
  client: OxablClient
  editor: monaco.editor.IStandaloneCodeEditor
  models: Map<string, monaco.editor.ITextModel>
  ctx: ProviderContext
  flush(path: string): Promise<void>
  analyzeAll(): Promise<void>
  select(path: string, at?: monaco.IRange | monaco.IPosition): void
  reset(): Promise<void>
  dispose(): void
}

export function Playground() {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const session = React.useRef<Session | null>(null)
  const hintsOnRef = React.useRef(true)
  const failureRef = React.useRef<OxablFailure | null>(null)

  const [ready, setReady] = React.useState(false)
  const [busy, setBusy] = React.useState(true)
  const [activePath, setActivePath] = React.useState(DEFAULT_FILE)
  const [reports, setReports] = React.useState<Reports>({})
  const [analyzed, setAnalyzed] = React.useState(false)
  const [status, setStatus] = React.useState("Starting oxabl…")
  const [hintsOn, setHintsOn] = React.useState(true)
  const [failure, setFailureState] = React.useState<OxablFailure | null>(null)
  const [crashSource, setCrashSource] = React.useState("")

  const setFailure = React.useCallback((next: OxablFailure | null) => {
    failureRef.current = next
    setFailureState(next)
  }, [])

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    setupMonaco()
    const client = new OxablClient()
    const models = new Map<string, monaco.editor.ITextModel>()
    const dirty = new Set<string>()
    const viewStates = new Map<
      string,
      monaco.editor.ICodeEditorViewState | null
    >()
    const disposables: monaco.IDisposable[] = []
    let analysisSequence = 0
    let editTimer: number | undefined
    let disposed = false
    // Reset rewrites every model; those edits are not the visitor's.
    let resetting = false

    const reportFailure = (next: OxablFailure) => {
      if (disposed) return
      setFailure(next)
      setStatus(failureHeadline(next))
      const model = editor.getModel()
      setCrashSource(model ? model.getValue() : "")
    }

    for (const file of DEFAULT_PROJECT) {
      const uri = modelUri(file.path)
      monaco.editor.getModel(uri)?.dispose()
      const model = monaco.editor.createModel(file.text, file.language, uri)
      model.setEOL(monaco.editor.EndOfLineSequence.LF)
      models.set(file.path, model)
    }

    const editor = monaco.editor.create(container, {
      ...EDITOR_OPTIONS,
      model: models.get(DEFAULT_FILE),
      theme: themeNameFor(document.documentElement),
    })

    const flush = async (path: string): Promise<void> => {
      if (!dirty.has(path)) return
      const model = models.get(path)
      if (!model) return
      dirty.delete(path)
      const result = await client.updateFile(path, model.getValue())
      if (!result.ok) reportFailure(result.failure)
    }

    const analyzeAll = async (): Promise<void> => {
      const sequence = ++analysisSequence
      const started = performance.now()
      setBusy(true)
      for (const path of models.keys()) await flush(path)
      if (sequence !== analysisSequence) return

      // Analyze the open file first so its squiggles land before the rest.
      const active = editor.getModel()
      const activeFile = active ? pathOfModel(active) : DEFAULT_FILE
      const order = [activeFile, ...PATHS.filter((p) => p !== activeFile)]
      const next: Reports = {}
      for (const path of order) {
        const model = models.get(path)
        if (!model) continue
        const version = model.getVersionId()
        const result = await client.analyze(path)
        if (sequence !== analysisSequence) return
        if (!result.ok) {
          reportFailure(result.failure)
          setBusy(false)
          return
        }
        next[path] = {
          diagnostics: result.value.diagnostics,
          warnings: result.value.config_warnings,
        }
        if (model.getVersionId() === version) {
          monaco.editor.setModelMarkers(
            model,
            "oxabl",
            diagnosticsToMarkers(model, result.value.diagnostics)
          )
        }
      }
      setReports(next)
      setAnalyzed(true)
      setFailure(null)
      const elapsed = (performance.now() - started).toFixed(1)
      const total = Object.values(next).reduce(
        (sum, r) => sum + r.diagnostics.length + r.warnings.length,
        0
      )
      setStatus(
        total === 0
          ? `Clean · ${elapsed}ms`
          : `${pluralize(total, "problem")} · ${elapsed}ms`
      )
      setBusy(false)
      refreshInlayHints()
    }

    const ctx: ProviderContext = {
      client,
      flush,
      hintsEnabled: () => hintsOnRef.current,
      onFailure: reportFailure,
      onFormat: ({ changed, error }) => {
        if (disposed) return
        setStatus(
          error !== null
            ? `Formatter left source unchanged · ${error}`
            : changed
              ? "Formatted"
              : "Already formatted"
        )
      },
    }

    const select = (path: string, at?: monaco.IRange | monaco.IPosition) => {
      const model = models.get(path)
      if (!model) return
      const current = editor.getModel()
      if (current !== model) {
        if (current)
          viewStates.set(pathOfModel(current), editor.saveViewState())
        editor.setModel(model)
        const saved = viewStates.get(path)
        if (saved) editor.restoreViewState(saved)
        setActivePath(path)
      }
      if (at) {
        const range =
          "startLineNumber" in at
            ? at
            : {
                startLineNumber: at.lineNumber,
                startColumn: at.column,
                endLineNumber: at.lineNumber,
                endColumn: at.column,
              }
        editor.setSelection(range)
        editor.revealRangeInCenter(range)
        editor.focus()
      }
    }

    const reset = async (): Promise<void> => {
      analysisSequence += 1
      if (editTimer !== undefined) window.clearTimeout(editTimer)
      setBusy(true)
      resetting = true
      for (const [path, model] of models) {
        model.setValue(ORIGINALS.get(path) ?? "")
        monaco.editor.setModelMarkers(model, "oxabl", [])
      }
      resetting = false
      dirty.clear()
      const result = await client.open(openRequest(ORIGINALS))
      if (disposed) return
      if (!result.ok) {
        reportFailure(result.failure)
        setBusy(false)
        return
      }
      await analyzeAll()
      setStatus((text) => `Reset · ${text}`)
    }

    for (const [path, model] of models) {
      disposables.push(
        model.onDidChangeContent(() => {
          if (resetting) return
          dirty.add(path)
          setBusy(true)
          if (editTimer !== undefined) window.clearTimeout(editTimer)
          editTimer = window.setTimeout(
            () => void analyzeAll(),
            EDIT_DEBOUNCE_MS
          )
        })
      )
    }
    disposables.push(registerProviders(ctx))
    disposables.push(registerFileOpener((path, at) => select(path, at)))

    const themeObserver = new MutationObserver(() => {
      monaco.editor.setTheme(themeNameFor(document.documentElement))
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })

    session.current = {
      client,
      editor,
      models,
      ctx,
      flush,
      analyzeAll,
      select,
      reset,
      dispose() {
        disposed = true
        analysisSequence += 1
        if (editTimer !== undefined) window.clearTimeout(editTimer)
        themeObserver.disconnect()
        for (const d of disposables) d.dispose()
        editor.dispose()
        for (const model of models.values()) model.dispose()
        client.dispose()
      },
    }

    // The editor font must be loaded before Monaco measures its glyphs.
    void (async () => {
      try {
        await document.fonts.load('14px "IBM Plex Mono"')
      } catch {
        // Measure with the fallback; the editor stays usable.
      }
      if (disposed) return
      monaco.editor.remeasureFonts()
      const opened = await client.open(openRequest(ORIGINALS))
      if (disposed) return
      if (!opened.ok) {
        reportFailure(opened.failure)
        setBusy(false)
        return
      }
      setReady(true)
      await analyzeAll()
    })()

    return () => {
      session.current?.dispose()
      session.current = null
    }
  }, [setFailure])

  const terminal = failure !== null && isTerminal(failure)
  const disabled = !ready || busy || terminal

  async function onFormat() {
    const current = session.current
    if (!current) return
    const model = current.editor.getModel()
    if (!model) return
    const edits = await formatEdits(current.ctx, model)
    if (edits.length > 0) {
      current.editor.pushUndoStop()
      current.editor.executeEdits(
        "oxabl-format",
        edits.map((edit) => ({
          range: monaco.Range.lift(edit.range),
          text: edit.text,
        }))
      )
      current.editor.pushUndoStop()
    }
  }

  function onToggleHints() {
    const next = !hintsOn
    hintsOnRef.current = next
    setHintsOn(next)
    refreshInlayHints()
  }

  function onSelectProblem(problem: Problem) {
    const current = session.current
    if (!current) return
    const model = current.models.get(problem.path)
    if (!model) return
    if (problem.byte === null) {
      current.select(problem.path, { lineNumber: 1, column: 1 })
      return
    }
    const snap = snapshotOf(model)
    const at = byteOffsetToMonacoPosition(snap.text, snap.index, problem.byte)
    current.select(problem.path, at)
  }

  const problemsByFile = new Map(
    PATHS.map((path) => [path, problemsOf(path, reports[path])] as const)
  )
  const allProblems = [...problemsByFile.values()].flat()
  const errorCount = allProblems.filter((p) => p.severity === "error").length
  const problemCount = allProblems.length
  const clean = analyzed && !busy && !failure && problemCount === 0
  const dotClass = failure
    ? "bg-error-screen"
    : errorCount > 0
      ? "bg-error-screen"
      : problemCount > 0
        ? "bg-warn-screen"
        : clean
          ? "bg-ok-screen"
          : "bg-screen-ink-muted"
  const statusClass = failure
    ? "text-error-screen"
    : errorCount > 0
      ? "text-error-screen"
      : problemCount > 0
        ? "text-warn-screen"
        : clean
          ? "text-ok-screen"
          : "text-screen-ink-muted"

  const folders = [...new Set(PATHS.map(folderOf))]

  function renderCount(path: string) {
    const count = problemsOf(path, reports[path]).length
    if (count === 0) return null
    const hasError = reports[path]?.diagnostics.some(
      (d) => d.severity === "error"
    )
    return (
      <span
        className={hasError ? "text-error-screen" : "text-warn-screen"}
        aria-label={pluralize(count, "problem")}
      >
        {count}
      </span>
    )
  }

  function fileButton(path: string, label: string) {
    const active = path === activePath
    return (
      <button
        type="button"
        key={path}
        aria-current={active ? "true" : undefined}
        disabled={!ready}
        onClick={() => session.current?.select(path)}
        className={`flex min-h-12 w-full items-center justify-between gap-2 px-4 text-left font-code text-code md:min-h-9 ${
          active
            ? "bg-screen-raised text-screen-ink"
            : "bg-transparent text-screen-ink-muted hover:bg-screen-raised hover:text-screen-ink"
        }`}
      >
        <span>{label}</span>
        {renderCount(path)}
      </button>
    )
  }

  return (
    <div className="screen-material border border-screen-rule bg-screen text-screen-ink">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-screen-rule px-4 py-3 font-chrome text-chrome uppercase md:py-0">
        <span className="text-screen-ink">Playground / sports2000 project</span>
        <span className="text-screen-ink-muted">oxabl_wasm · web worker</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-screen-rule px-4 py-3 md:px-6">
        <div
          className={`flex items-center gap-2 font-code text-code ${statusClass}`}
        >
          <span className={`size-2 ${dotClass}`} aria-hidden="true" />
          <span aria-live="polite" data-playground-status data-busy={busy}>
            {status}
          </span>
        </div>
        <div className="flex gap-2 font-chrome text-chrome uppercase">
          <button
            type="button"
            disabled={disabled}
            onClick={() => void onFormat()}
            className={BUTTON}
          >
            Format
          </button>
          <button
            type="button"
            disabled={!ready || terminal}
            aria-pressed={hintsOn}
            onClick={onToggleHints}
            className={BUTTON}
          >
            Hints {hintsOn ? "On" : "Off"}
          </button>
          <button
            type="button"
            disabled={!ready || terminal}
            onClick={() => void session.current?.reset()}
            className={BUTTON}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-[14rem_minmax(0,1fr)] lg:grid-cols-[14rem_minmax(0,1fr)_20rem]">
        <nav
          aria-label="Project files"
          className="border-b border-screen-rule py-3 md:border-r md:border-b-0 lg:row-span-1"
        >
          <ul className="m-0 flex list-none flex-wrap p-0 md:block">
            {/* Below md every path is written out, in one wrapped strip. */}
            {PATHS.map((path) => (
              <li key={path} className="w-1/2 sm:w-auto md:hidden">
                {fileButton(path, path)}
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            {folders.map((folder) => (
              <div key={folder || "root"} className="mb-3 last:mb-0">
                {folder && (
                  <p className="px-4 py-1 font-chrome text-chrome text-screen-ink-muted uppercase">
                    {folder}/
                  </p>
                )}
                <ul className="m-0 list-none p-0">
                  {PATHS.filter((p) => folderOf(p) === folder).map((path) => (
                    <li key={path}>{fileButton(path, fileName(path))}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <div className="min-w-0 border-b border-screen-rule lg:border-b-0">
          <div
            ref={containerRef}
            data-playground-editor
            data-active-file={activePath}
            className="h-[528px] w-full overflow-hidden"
          />
        </div>

        <div className="min-w-0 border-t border-screen-rule lg:border-t-0 lg:border-l">
          <div className="flex min-h-12 items-center justify-between border-b border-screen-rule px-4 font-chrome text-chrome uppercase">
            <span className="text-screen-ink">Problems</span>
            <span className="text-screen-ink-muted" data-playground-count>
              {problemCount}
            </span>
          </div>
          <div className="max-h-[336px] overflow-y-auto lg:h-[480px] lg:max-h-none">
            {failure ? (
              <div className="p-4 font-code text-code">
                <p className="text-screen-ink">
                  {failure.kind === "crash"
                    ? "oxabl hit an internal error"
                    : failureHeadline(failure)}
                </p>
                <p className="mt-2 text-screen-ink-muted">{failure.message}</p>
                {(failure.kind === "crash" || failure.kind === "timeout") && (
                  <p className="mt-2 text-screen-ink-muted">
                    The engine has restarted. Edit a file to try again; no
                    reload is needed.
                  </p>
                )}
                {failure.kind === "crash" && (
                  <>
                    <p className="mt-1 text-screen-ink-muted">
                      Engine build {failure.version}
                    </p>
                    <a
                      href={crashReportUrl(failure, crashSource, activePath)}
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
              <div className="m-4 border border-ok-screen p-4 font-code text-code text-ok-screen">
                <p>PASS · no diagnostics</p>
                <p className="mt-2 text-screen-ink-muted">
                  Every file in the project is clean.
                </p>
              </div>
            ) : problemCount > 0 ? (
              <div data-playground-problems>
                {PATHS.filter(
                  (path) => (problemsByFile.get(path) ?? []).length > 0
                ).map((path) => (
                  <section
                    key={path}
                    className="border-b border-screen-rule last:border-b-0"
                  >
                    <h3 className="px-4 pt-3 pb-1 font-chrome text-chrome font-normal text-screen-ink-muted uppercase">
                      {path}
                    </h3>
                    <ul className="m-0 list-none p-0">
                      {(problemsByFile.get(path) ?? []).map(
                        (problem, index) => (
                          <li key={`${problem.code}-${problem.byte}-${index}`}>
                            <button
                              type="button"
                              onClick={() => onSelectProblem(problem)}
                              title={problem.message}
                              data-problem-code={problem.code}
                              data-problem-file={problem.path}
                              className="block w-full bg-transparent px-4 py-3 text-left font-code text-code hover:bg-screen-raised"
                            >
                              <span className="flex items-center gap-x-2">
                                <span
                                  className={SEVERITY_CLASS[problem.severity]}
                                >
                                  {problem.severity}
                                </span>
                                <span className="text-screen-ink-muted">
                                  {problem.code}
                                </span>
                                {problem.line > 0 && (
                                  <span className="ml-auto text-screen-ink-muted">
                                    {problem.line}:{problem.column}
                                  </span>
                                )}
                              </span>
                              <span className="mt-1 line-clamp-3 text-screen-ink">
                                {problem.message}
                              </span>
                            </button>
                          </li>
                        )
                      )}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              <div className="m-4 border border-screen-rule p-4 font-code text-code text-screen-ink-muted">
                Waiting for engine output.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-[72px] items-center border-t border-screen-rule px-4 py-3 font-code text-code text-screen-ink-muted md:px-6">
        Monaco and oxabl_wasm run in this browser, the engine in a web worker,
        over a virtual Sports2000 project with its schema. Nothing you type
        leaves the page. Edit {CONFIG_PATH} to change the lint rules.
      </div>
    </div>
  )
}

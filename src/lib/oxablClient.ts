/**
 * Main-thread RPC client for the `oxabl_wasm` project Web Worker.
 *
 * Provides typed calls for all `project_*` exports, enforces per-request hang
 * deadlines (terminating and respawning the worker on timeout), and keeps the
 * canonical project state so a respawned worker re-hydrates automatically.
 */

export type ProjectOpenRequest = {
  /** Workspace-relative file paths -> UTF-8 source text. */
  files: Record<string, string>
  /** Optional `oxabl.toml` text. */
  config?: string
  /** Optional map of `.df` paths -> text. */
  schemas?: Record<string, string>
}

export type WireConfigWarning = {
  kind:
    | "config"
    | "schema"
    | "schema_path"
    | "lint"
    | "run_extension"
    | "root_extension"
  message: string
}

export type ProjectStatusResponse = {
  ok: boolean
  error: string | null
  generation: number
  schema_loaded: boolean
  table_count: number
  warnings: WireConfigWarning[]
}

export type WirePosition = {
  byte: number
  line: number
  column: number
}

export type WireDiagnostic = {
  source: "parse" | "preproc" | "semantic" | "lint"
  severity: "error" | "warning" | "info" | "hint"
  code: string
  message: string
  start: WirePosition
  end: WirePosition
  help: string | null
}

export type ProjectAnalyzeResponse = {
  diagnostics: WireDiagnostic[]
  config_warnings: WireConfigWarning[]
  error: string | null
}

export type InlayHintsRequest = {
  locks?: boolean
  index?: boolean
  scope?: boolean
  transactions?: boolean
  parameters?: boolean
}

export type WireInlayHint = {
  at: WirePosition
  kind: "lock" | "index" | "scope" | "transaction" | "parameter"
  label: string
  tooltip: string
  after: boolean
}

export type InlayHintsResponse = {
  hints: WireInlayHint[]
}

export type WireHover = {
  contents: string
  start: WirePosition | null
  end: WirePosition | null
}

export type WireTarget = {
  path: string
  start: WirePosition | null
  end: WirePosition | null
}

export type DefinitionsResponse = {
  targets: WireTarget[]
}

export type WireResolveData =
  | { kind: "doc"; doc: number }
  | { kind: "symbol"; generation: number; path: string; symbol: number }
  | { kind: "table"; generation: number; table: number }
  | { kind: "field"; generation: number; table: number; field: number }
  | { kind: "path"; path: string; entry: string }
  | {
      kind: "member"
      generation: number
      path: string
      class: string
      member_kind: string
      name: string
    }

export type WireCompletionItemKind =
  | "keyword"
  | "snippet"
  | "variable"
  | "property"
  | "method"
  | "function"
  | "struct"
  | "field"
  | "class"
  | "interface"
  | "enum"
  | "enum_member"
  | "event"
  | "module"
  | "file"
  | "folder"
  | "constant"

export type WireCompletionItem = {
  label: string
  kind: WireCompletionItemKind
  detail: string | null
  sort_text: string
  insert: string
  snippet: boolean
  resolve_data: WireResolveData | null
}

export type WireCompletionList = {
  incomplete: boolean
  word_start: WirePosition
  word_end: WirePosition
  cursor: WirePosition
  items: WireCompletionItem[]
}

export type ResolveCompletionResponse = {
  documentation: string | null
}

export type FormatResponse = {
  source: string
  changed: boolean
  error: string | null
}

export type OxablFailure =
  | { kind: "crash"; message: string; version: string }
  | { kind: "timeout"; message: string; timeoutMs: number }
  | { kind: "unsupported"; message: string }
  | { kind: "stale-artifact"; message: string }
  | { kind: "load"; message: string }

export type OxablResult<T> =
  { ok: true; value: T } | { ok: false; failure: OxablFailure }

export type WorkerRequest =
  | { id: number; type: "open"; payload: ProjectOpenRequest }
  | { id: number; type: "updateFile"; path: string; text: string }
  | { id: number; type: "removeFile"; path: string }
  | { id: number; type: "analyze"; path: string }
  | { id: number; type: "inlayHints"; path: string; kinds: InlayHintsRequest }
  | { id: number; type: "hover"; path: string; byteOffset: number }
  | { id: number; type: "definitions"; path: string; byteOffset: number }
  | {
      id: number
      type: "complete"
      path: string
      byteOffset: number
      trigger: string | null
    }
  | { id: number; type: "resolveCompletion"; data: WireResolveData }
  | { id: number; type: "format"; path: string }
  | { id: number; type: "version" }

export type WorkerResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; failure: OxablFailure }

type WorkerRequestPayload =
  | { type: "open"; payload: ProjectOpenRequest }
  | { type: "updateFile"; path: string; text: string }
  | { type: "removeFile"; path: string }
  | { type: "analyze"; path: string }
  | { type: "inlayHints"; path: string; kinds: InlayHintsRequest }
  | { type: "hover"; path: string; byteOffset: number }
  | { type: "definitions"; path: string; byteOffset: number }
  | {
      type: "complete"
      path: string
      byteOffset: number
      trigger: string | null
    }
  | { type: "resolveCompletion"; data: WireResolveData }
  | { type: "format"; path: string }
  | { type: "version" }

type PendingCall = {
  resolve: (result: OxablResult<unknown>) => void
  timer: ReturnType<typeof setTimeout>
}

const HEAVY_TIMEOUT_MS = 5000
const INTERACTIVE_TIMEOUT_MS = 2000

/** Terminal failures leave the playground unusable until a page reload. */
export function isTerminal(failure: OxablFailure): boolean {
  return failure.kind === "unsupported" || failure.kind === "stale-artifact"
}

/**
 * A pre-filled GitHub issue URL for a crash, built entirely client-side.
 */
export function crashReportUrl(
  failure: Extract<OxablFailure, { kind: "crash" }>,
  source: string,
  filename?: string
): string {
  const headerLines = [
    "The browser playground hit an internal error.",
    "",
    `**Engine build:** \`${failure.version}\``,
  ]
  if (filename) {
    headerLines.push(`**File:** \`${filename}\``)
  }

  const body = [
    ...headerLines,
    "",
    "**Message**",
    "",
    "```",
    failure.message,
    "```",
    "",
    "**Source that triggered it**",
    "",
    "```abl",
    source,
    "```",
  ].join("\n")

  const params = new URLSearchParams({
    title: "Playground: internal error on this input",
    body,
    labels: "bug,playground",
  })
  return `https://github.com/oxabl-project/oxabl/issues/new?${params.toString()}`
}

export class OxablClient {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, PendingCall>()
  private needsRehydrate = false
  private canonical: {
    opened: boolean
    files: Map<string, string>
    config: string | undefined
    schemas: Map<string, string>
  } = {
    opened: false,
    files: new Map(),
    config: undefined,
    schemas: new Map(),
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      const worker = new Worker(new URL("./oxabl.worker.ts", import.meta.url), {
        type: "module",
      })
      worker.addEventListener(
        "message",
        (event: MessageEvent<WorkerResponse>) => {
          this.handleMessage(event.data)
        }
      )
      worker.addEventListener("error", (event: ErrorEvent) => {
        this.failAll({
          kind: "load",
          message:
            event.message ||
            "The oxabl worker failed to start. Check your connection and try again.",
        })
        this.terminateWorker(false)
      })
      this.worker = worker
    }
    return this.worker
  }

  private handleMessage(response: WorkerResponse): void {
    const entry = this.pending.get(response.id)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(response.id)
    if (response.ok) {
      entry.resolve({ ok: true, value: response.value })
    } else {
      entry.resolve({ ok: false, failure: response.failure })
    }
  }

  private failAll(failure: OxablFailure): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      this.pending.delete(id)
      entry.resolve({ ok: false, failure })
    }
  }

  private terminateWorker(markRehydrate: boolean): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    if (markRehydrate && this.canonical.opened) {
      this.needsRehydrate = true
    }
  }

  private buildCanonicalPayload(): ProjectOpenRequest {
    const payload: ProjectOpenRequest = {
      files: Object.fromEntries(this.canonical.files),
    }
    if (this.canonical.config !== undefined) {
      payload.config = this.canonical.config
    }
    if (this.canonical.schemas.size > 0) {
      payload.schemas = Object.fromEntries(this.canonical.schemas)
    }
    return payload
  }

  private sendRaw<T>(
    payload: WorkerRequestPayload,
    timeoutMs: number
  ): Promise<OxablResult<T>> {
    const worker = this.ensureWorker()
    const id = this.nextId++
    const request: WorkerRequest = { id, ...payload }

    return new Promise<OxablResult<T>>((resolve) => {
      const timer = setTimeout(() => {
        this.terminateWorker(true)
        this.failAll({
          kind: "timeout",
          message:
            "The oxabl engine did not respond in time and was restarted.",
          timeoutMs,
        })
      }, timeoutMs)

      this.pending.set(id, {
        resolve: resolve as (result: OxablResult<unknown>) => void,
        timer,
      })
      worker.postMessage(request)
    })
  }

  private async send<T>(
    payload: WorkerRequestPayload,
    timeoutMs: number
  ): Promise<OxablResult<T>> {
    if (this.needsRehydrate && payload.type !== "open") {
      this.needsRehydrate = false
      const rehydrate = await this.sendRaw<ProjectStatusResponse>(
        { type: "open", payload: this.buildCanonicalPayload() },
        HEAVY_TIMEOUT_MS
      )
      if (!rehydrate.ok) {
        if (rehydrate.failure.kind === "timeout") {
          this.needsRehydrate = true
        }
        return rehydrate
      }
    }
    return this.sendRaw<T>(payload, timeoutMs)
  }

  open(
    payload: ProjectOpenRequest
  ): Promise<OxablResult<ProjectStatusResponse>> {
    this.canonical.opened = true
    this.canonical.files.clear()
    for (const [path, text] of Object.entries(payload.files)) {
      this.canonical.files.set(path, text)
    }
    this.canonical.config = payload.config
    this.canonical.schemas.clear()
    if (payload.schemas) {
      for (const [path, text] of Object.entries(payload.schemas)) {
        this.canonical.schemas.set(path, text)
      }
    }
    this.needsRehydrate = false
    return this.send<ProjectStatusResponse>(
      { type: "open", payload },
      HEAVY_TIMEOUT_MS
    )
  }

  updateFile(
    path: string,
    text: string
  ): Promise<OxablResult<ProjectStatusResponse>> {
    if (path === "oxabl.toml") {
      this.canonical.config = text
    } else if (
      this.canonical.schemas.has(path) ||
      path.toLowerCase().endsWith(".df")
    ) {
      this.canonical.schemas.set(path, text)
    } else {
      this.canonical.files.set(path, text)
    }
    return this.send<ProjectStatusResponse>(
      { type: "updateFile", path, text },
      HEAVY_TIMEOUT_MS
    )
  }

  removeFile(path: string): Promise<OxablResult<ProjectStatusResponse>> {
    if (path === "oxabl.toml") {
      this.canonical.config = undefined
    }
    this.canonical.schemas.delete(path)
    this.canonical.files.delete(path)
    return this.send<ProjectStatusResponse>(
      { type: "removeFile", path },
      HEAVY_TIMEOUT_MS
    )
  }

  analyze(path: string): Promise<OxablResult<ProjectAnalyzeResponse>> {
    return this.send<ProjectAnalyzeResponse>(
      { type: "analyze", path },
      HEAVY_TIMEOUT_MS
    )
  }

  inlayHints(
    path: string,
    kinds: InlayHintsRequest
  ): Promise<OxablResult<InlayHintsResponse>> {
    return this.send<InlayHintsResponse>(
      { type: "inlayHints", path, kinds },
      INTERACTIVE_TIMEOUT_MS
    )
  }

  hover(
    path: string,
    byteOffset: number
  ): Promise<OxablResult<WireHover | null>> {
    return this.send<WireHover | null>(
      { type: "hover", path, byteOffset },
      INTERACTIVE_TIMEOUT_MS
    )
  }

  definitions(
    path: string,
    byteOffset: number
  ): Promise<OxablResult<DefinitionsResponse>> {
    return this.send<DefinitionsResponse>(
      { type: "definitions", path, byteOffset },
      INTERACTIVE_TIMEOUT_MS
    )
  }

  complete(
    path: string,
    byteOffset: number,
    trigger: string | null = null
  ): Promise<OxablResult<WireCompletionList | null>> {
    return this.send<WireCompletionList | null>(
      { type: "complete", path, byteOffset, trigger },
      INTERACTIVE_TIMEOUT_MS
    )
  }

  resolveCompletion(
    data: WireResolveData
  ): Promise<OxablResult<ResolveCompletionResponse>> {
    return this.send<ResolveCompletionResponse>(
      { type: "resolveCompletion", data },
      INTERACTIVE_TIMEOUT_MS
    )
  }

  format(path: string): Promise<OxablResult<FormatResponse>> {
    return this.send<FormatResponse>({ type: "format", path }, HEAVY_TIMEOUT_MS)
  }

  version(): Promise<OxablResult<string>> {
    return this.send<string>({ type: "version" }, HEAVY_TIMEOUT_MS)
  }

  dispose(): void {
    this.failAll({
      kind: "load",
      message: "The oxabl client was disposed.",
    })
    this.terminateWorker(false)
  }
}

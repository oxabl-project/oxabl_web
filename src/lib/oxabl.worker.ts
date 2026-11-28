/**
 * Dedicated Web Worker hosting the `oxabl_wasm` project engine.
 *
 * Keeps WASM execution off the main thread, mirrors the virtual project files
 * so a panic trap (`WebAssembly.RuntimeError`) can reset the instance via
 * `__wbg_reset_state()` and re-hydrate automatically, and detects stale
 * vendored `src/wasm/` artifacts (missing `__wbg_reset_state`, `version`, or
 * `project_open`).
 */

import * as glue from "@/wasm/oxabl_wasm.js"
import type {
  DefinitionsResponse,
  FormatResponse,
  InlayHintsResponse,
  OxablFailure,
  ProjectAnalyzeResponse,
  ProjectOpenRequest,
  ProjectStatusResponse,
  ResolveCompletionResponse,
  WireCompletionList,
  WireHover,
  WorkerRequest,
  WorkerResponse,
} from "./oxablClient"

/**
 * Hand-typed surface of `oxabl_wasm` (the build passes `--no-typescript`, so
 * the glue ships no `.d.ts`). Optional exports allow runtime stale-artifact
 * detection without a static ESM import failure.
 */
type OxablProjectGlue = {
  default: (init?: unknown) => Promise<unknown>
  version?: () => string
  __wbg_reset_state?: () => void
  project_open?: (json: string) => string
  project_update_file?: (path: string, text: string) => string
  project_remove_file?: (path: string) => string
  project_analyze?: (path: string) => string
  project_inlay_hints?: (path: string, kindsJson: string) => string
  project_hover?: (path: string, byteOffset: number) => string
  project_definitions?: (path: string, byteOffset: number) => string
  project_complete?: (
    path: string,
    byteOffset: number,
    trigger: string | null
  ) => string
  project_resolve_completion?: (dataJson: string) => string
  project_format?: (path: string) => string
}

type LoadedOxablProjectGlue = Required<OxablProjectGlue>

const oxabl = glue as unknown as OxablProjectGlue

/** The `globalThis` key the artifact's panic hook writes to. Cross-repo contract. */
const PANIC_STASH_KEY = "__oxablPanicMessage"

class StaleArtifactError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StaleArtifactError"
  }
}

let loadPromise: Promise<LoadedOxablProjectGlue> | undefined
let cachedVersion: string | undefined

const mirror: {
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

function serializeMirror(): string {
  const payload: ProjectOpenRequest = {
    files: Object.fromEntries(mirror.files),
  }
  if (mirror.config !== undefined) {
    payload.config = mirror.config
  }
  if (mirror.schemas.size > 0) {
    payload.schemas = Object.fromEntries(mirror.schemas)
  }
  return JSON.stringify(payload)
}

function load(): Promise<LoadedOxablProjectGlue> {
  if (!loadPromise) {
    loadPromise = oxabl
      .default()
      .then(() => {
        if (typeof oxabl.__wbg_reset_state !== "function") {
          throw new StaleArtifactError(
            "the bundled engine has no __wbg_reset_state export, so it cannot recover from a crash"
          )
        }
        if (typeof oxabl.version !== "function") {
          throw new StaleArtifactError(
            "the bundled engine has no version export, so a crash cannot be traced to a build"
          )
        }
        if (typeof oxabl.project_open !== "function") {
          throw new StaleArtifactError(
            "the bundled engine has no project_open export — rebuild src/wasm/ from the project-playground engine"
          )
        }
        return oxabl as LoadedOxablProjectGlue
      })
      .catch((error: unknown) => {
        loadPromise = undefined
        throw error
      })
  }
  return loadPromise
}

function artifactVersion(): string {
  if (cachedVersion === undefined) {
    try {
      cachedVersion = oxabl.version?.() ?? "unknown"
    } catch {
      cachedVersion = "unknown"
    }
  }
  return cachedVersion
}

function clearPanicStash(): void {
  try {
    delete (globalThis as Record<string, unknown>)[PANIC_STASH_KEY]
  } catch {
    // Non-configurable property; fall back to the no-message form on trap.
  }
}

function readPanicStash(): string | undefined {
  const stashed = (globalThis as Record<string, unknown>)[PANIC_STASH_KEY]
  return typeof stashed === "string" && stashed.length > 0 ? stashed : undefined
}

function resetAndRehydrate(): boolean {
  const reset = oxabl.__wbg_reset_state
  if (typeof reset !== "function") return false
  try {
    reset()
    cachedVersion = undefined
    if (mirror.opened) {
      if (typeof oxabl.project_open !== "function") return false
      clearPanicStash()
      oxabl.project_open(serializeMirror())
    }
    return true
  } catch {
    return false
  }
}

function classify(error: unknown): OxablFailure {
  if (error instanceof StaleArtifactError) {
    return { kind: "stale-artifact", message: error.message }
  }

  if (
    error instanceof WebAssembly.CompileError ||
    error instanceof WebAssembly.LinkError
  ) {
    return {
      kind: "unsupported",
      message:
        "This browser can't run the oxabl engine. It needs a WebAssembly runtime a little newer than this one — the CLI and editor extension have no such requirement.",
    }
  }

  if (error instanceof WebAssembly.RuntimeError) {
    const stashed = readPanicStash()
    const healed = resetAndRehydrate()
    const version = artifactVersion()
    if (!healed) {
      return {
        kind: "stale-artifact",
        message:
          "The oxabl engine hit an internal error and this build cannot restart itself. Reload the page to continue.",
      }
    }
    return {
      kind: "crash",
      version,
      message:
        stashed ??
        "The oxabl engine hit an internal error with no captured message (a stack overflow or out-of-memory trap, rather than a Rust panic).",
    }
  }

  return {
    kind: "load",
    message:
      error instanceof Error
        ? error.message
        : "The oxabl engine failed to load. Check your connection and try again.",
  }
}

function parse<T>(json: string): T {
  return JSON.parse(json) as T
}

function updateMirrorForOpen(payload: ProjectOpenRequest): void {
  mirror.opened = true
  mirror.files.clear()
  for (const [path, text] of Object.entries(payload.files)) {
    mirror.files.set(path, text)
  }
  mirror.config = payload.config
  mirror.schemas.clear()
  if (payload.schemas) {
    for (const [path, text] of Object.entries(payload.schemas)) {
      mirror.schemas.set(path, text)
    }
  }
}

function updateMirrorForFile(path: string, text: string): void {
  if (path === "oxabl.toml") {
    mirror.config = text
  } else if (mirror.schemas.has(path) || path.toLowerCase().endsWith(".df")) {
    mirror.schemas.set(path, text)
  } else {
    mirror.files.set(path, text)
  }
}

function removeMirrorFile(path: string): void {
  if (path === "oxabl.toml") {
    mirror.config = undefined
  }
  mirror.schemas.delete(path)
  mirror.files.delete(path)
}

function dispatch(g: LoadedOxablProjectGlue, req: WorkerRequest): unknown {
  switch (req.type) {
    case "open": {
      updateMirrorForOpen(req.payload)
      return parse<ProjectStatusResponse>(
        g.project_open(JSON.stringify(req.payload))
      )
    }
    case "updateFile": {
      updateMirrorForFile(req.path, req.text)
      return parse<ProjectStatusResponse>(
        g.project_update_file(req.path, req.text)
      )
    }
    case "removeFile": {
      removeMirrorFile(req.path)
      return parse<ProjectStatusResponse>(g.project_remove_file(req.path))
    }
    case "analyze":
      return parse<ProjectAnalyzeResponse>(g.project_analyze(req.path))
    case "inlayHints":
      return parse<InlayHintsResponse>(
        g.project_inlay_hints(req.path, JSON.stringify(req.kinds))
      )
    case "hover":
      return parse<WireHover | null>(g.project_hover(req.path, req.byteOffset))
    case "definitions":
      return parse<DefinitionsResponse>(
        g.project_definitions(req.path, req.byteOffset)
      )
    case "complete":
      return parse<WireCompletionList | null>(
        g.project_complete(req.path, req.byteOffset, req.trigger)
      )
    case "resolveCompletion":
      return parse<ResolveCompletionResponse>(
        g.project_resolve_completion(JSON.stringify(req.data))
      )
    case "format":
      return parse<FormatResponse>(g.project_format(req.path))
    case "version":
      return artifactVersion()
  }
}

async function handleRequest(req: WorkerRequest): Promise<WorkerResponse> {
  try {
    const loaded = await load()
    clearPanicStash()
    const value = dispatch(loaded, req)
    return { id: req.id, ok: true, value }
  } catch (error) {
    return { id: req.id, ok: false, failure: classify(error) }
  }
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  void handleRequest(event.data).then((response) => {
    self.postMessage(response)
  })
})

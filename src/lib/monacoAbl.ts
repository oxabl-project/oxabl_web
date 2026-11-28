/**
 * Monaco for the playground: a minimal feature set, three Monarch languages,
 * the screen themes, and the providers that turn `oxabl_wasm` answers into
 * editor features. Imported only after the visitor clicks "Load demo
 * playground" — nothing else on the site may import this module.
 *
 * Monaco is imported piecemeal (`editor.api` plus the contributions the
 * playground uses) so the TypeScript, CSS, HTML and JSON language services
 * never reach the bundle.
 */

import * as monaco from "monaco-editor/editor/editor.api"
import "monaco-editor/editor/browser/coreCommands"
import "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching"
import "monaco-editor/editor/contrib/clipboard/browser/clipboard"
import "monaco-editor/editor/contrib/comment/browser/comment"
import "monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo"
import "monaco-editor/editor/contrib/find/browser/findController"
import "monaco-editor/editor/contrib/format/browser/formatActions"
import "monaco-editor/editor/contrib/gotoError/browser/gotoError"
import "monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands"
import "monaco-editor/editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition"
import "monaco-editor/editor/contrib/hover/browser/hoverContribution"
import "monaco-editor/editor/contrib/indentation/browser/indentation"
import "monaco-editor/editor/contrib/inlayHints/browser/inlayHintsContribution"
import "monaco-editor/editor/contrib/linesOperations/browser/linesOperations"
import "monaco-editor/editor/contrib/multicursor/browser/multicursor"
import "monaco-editor/editor/contrib/snippet/browser/snippetController2"
import "monaco-editor/editor/contrib/suggest/browser/suggestController"
import "monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter"
import "monaco-editor/editor/contrib/wordOperations/browser/wordOperations"
import "monaco-editor/editor/common/standaloneStrings"
import EditorWorker from "monaco-editor/editor/editor.worker?worker"

import keywords from "@/data/keywords.json"
import monacoCss from "@/styles/monaco.css?inline"
import {
  buildLineIndex,
  byteOffsetToMonacoPosition,
  monacoPositionToByteOffset,
  type LineIndex,
} from "./positions"
import type {
  OxablClient,
  OxablFailure,
  WireCompletionItemKind,
  WireDiagnostic,
  WirePosition,
  WireResolveData,
} from "./oxablClient"

export { monaco }

export const WORKSPACE_URI_PREFIX = "file:///workspace/"
export const THEME_LIGHT_HOST = "oxabl-screen-light-host"
export const THEME_DARK_HOST = "oxabl-screen-dark-host"
export const EDITOR_FONT = '"IBM Plex Mono", monospace'

export function modelUri(path: string): monaco.Uri {
  return monaco.Uri.parse(WORKSPACE_URI_PREFIX + path)
}

export function pathOfModel(model: monaco.editor.ITextModel): string {
  const full = model.uri.toString()
  return full.startsWith(WORKSPACE_URI_PREFIX)
    ? decodeURIComponent(full.slice(WORKSPACE_URI_PREFIX.length))
    : model.uri.path
}

/* ----------------------------------------------------------------------- */
/* Position snapshots                                                       */
/* ----------------------------------------------------------------------- */

export type Snapshot = {
  text: string
  index: LineIndex
  version: number
}

const snapshots = new WeakMap<monaco.editor.ITextModel, Snapshot>()

/** The model's text with its UTF-8 line index, cached per model version. */
export function snapshotOf(model: monaco.editor.ITextModel): Snapshot {
  const version = model.getVersionId()
  const cached = snapshots.get(model)
  if (cached && cached.version === version) return cached
  const text = model.getValue()
  const next = { text, index: buildLineIndex(text), version }
  snapshots.set(model, next)
  return next
}

function toMonaco(snap: Snapshot, at: WirePosition): monaco.IPosition {
  return byteOffsetToMonacoPosition(snap.text, snap.index, at.byte)
}

function rangeOf(
  snap: Snapshot,
  start: WirePosition,
  end: WirePosition
): monaco.IRange {
  const from = toMonaco(snap, start)
  const to = toMonaco(snap, end)
  return {
    startLineNumber: from.lineNumber,
    startColumn: from.column,
    endLineNumber: to.lineNumber,
    endColumn: to.column,
  }
}

/* ----------------------------------------------------------------------- */
/* Languages                                                                */
/* ----------------------------------------------------------------------- */

let languagesRegistered = false

function registerLanguages(): void {
  if (languagesRegistered) return
  languagesRegistered = true

  monaco.languages.register({
    id: "abl",
    extensions: [".p", ".i", ".w", ".cls"],
    aliases: ["ABL"],
  })
  monaco.languages.register({ id: "abl-df", extensions: [".df"] })
  monaco.languages.register({ id: "toml", extensions: [".toml"] })

  monaco.languages.setLanguageConfiguration("abl", {
    comments: { blockComment: ["/*", "*/"], lineComment: "//" },
    brackets: [
      ["(", ")"],
      ["[", "]"],
      ["{", "}"],
    ],
    autoClosingPairs: [
      { open: "(", close: ")" },
      { open: "[", close: "]" },
      { open: '"', close: '"', notIn: ["string", "comment"] },
      { open: "/*", close: " */", notIn: ["string"] },
    ],
    surroundingPairs: [
      { open: "(", close: ")" },
      { open: '"', close: '"' },
    ],
  })
  monaco.languages.setLanguageConfiguration("toml", {
    comments: { lineComment: "#" },
    brackets: [["[", "]"]],
  })

  // The vendored reserved-keyword list is uppercase; Monarch matches
  // case-insensitively. Operators and the `&` preprocessor names in the list
  // never match an identifier token, so they are harmless here.
  monaco.languages.setMonarchTokensProvider("abl", {
    ignoreCase: true,
    keywords: keywords as string[],
    preprocessor: [
      "&SCOPED-DEFINE",
      "&GLOBAL-DEFINE",
      "&UNDEFINE",
      "&IF",
      "&THEN",
      "&ELSEIF",
      "&ELSE",
      "&ENDIF",
      "&MESSAGE",
      "&ANALYZE-SUSPEND",
      "&ANALYZE-RESUME",
    ],
    tokenizer: {
      root: [
        [/\/\*/, "comment", "@comment"],
        [/\/\/.*$/, "comment"],
        [/"/, "string", "@dquote"],
        [/'/, "string", "@squote"],
        [
          /&[a-zA-Z][\w-]*/,
          { cases: { "@preprocessor": "keyword", "@default": "identifier" } },
        ],
        [/\{/, "keyword", "@include"],
        [/\d+(\.\d+)?/, "number"],
        // A qualified name is plain ink even when its tail is a reserved word
        // (`Customer.Name`): identifiers stay plain in the four-role theme.
        [/(\.)([a-zA-Z_][\w-]*)/, ["delimiter", "identifier"]],
        [
          /[a-zA-Z_][\w-]*/,
          { cases: { "@keywords": "keyword", "@default": "identifier" } },
        ],
      ],
      comment: [
        [/[^/*]+/, "comment"],
        [/\/\*/, "comment", "@push"],
        [/\*\//, "comment", "@pop"],
        [/[/*]/, "comment"],
      ],
      // ABL escapes with a tilde, not a backslash.
      dquote: [
        [/[^~"{]+/, "string"],
        [/~./, "string"],
        [/\{[^}"]*\}/, "keyword"],
        [/\{/, "string"],
        [/"/, "string", "@pop"],
      ],
      squote: [
        [/[^~'{]+/, "string"],
        [/~./, "string"],
        [/\{[^}']*\}/, "keyword"],
        [/\{/, "string"],
        [/'/, "string", "@pop"],
      ],
      include: [
        [/\}/, "keyword", "@pop"],
        [/"[^"]*"/, "string"],
        [/[^}"]+/, "keyword"],
        [/"/, "string"],
      ],
    },
  } as monaco.languages.IMonarchLanguage)

  monaco.languages.setMonarchTokensProvider("toml", {
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/\[\[?[^\]]*\]\]?/, "keyword"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'[^']*'/, "string"],
        [/\b(true|false)\b/, "number"],
        [/-?\d[\d_.]*/, "number"],
        [/[A-Za-z_][\w-]*(?=\s*=)/, "identifier"],
      ],
    },
  })

  monaco.languages.setMonarchTokensProvider("abl-df", {
    ignoreCase: true,
    keywords: [
      "ADD",
      "UPDATE",
      "TABLE",
      "FIELD",
      "INDEX",
      "SEQUENCE",
      "INDEX-FIELD",
      "OF",
      "AS",
      "AREA",
      "UNIQUE",
      "PRIMARY",
      "WORD",
      "ASCENDING",
      "DESCENDING",
      "ABBREVIATED",
      "INACTIVE",
      "INITIAL",
      "FORMAT",
      "LABEL",
      "COLUMN-LABEL",
      "DESCRIPTION",
      "HELP",
      "VALEXP",
      "VALMSG",
      "ORDER",
      "MAX-WIDTH",
      "DECIMALS",
      "CASE-SENSITIVE",
      "MANDATORY",
      "DUMP-NAME",
      "TABLE-TRIGGER",
      "FIELD-TRIGGER",
      "SEQ",
    ],
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/"([^"~]|~.|"")*"/, "string"],
        [/-?\d+(\.\d+)?/, "number"],
        [
          /[A-Za-z][\w-]*/,
          { cases: { "@keywords": "keyword", "@default": "identifier" } },
        ],
      ],
    },
  })
}

/* ----------------------------------------------------------------------- */
/* Themes                                                                   */
/* ----------------------------------------------------------------------- */

// Monaco's `defineTheme` takes sRGB hex only, so these are DESIGN.md's screen
// tokens converted from oklch (Oklab matrices, clamped to sRGB). The comment
// beside each value names its source token.
const TOKENS = {
  screen: "#0a0f0b", // --screen oklch(0.16 0.010 150)
  screenDeep: "#050806", // --screen under .dark, oklch(0.13 0.010 150)
  raised: "#141a15", // --screen-raised oklch(0.21 0.012 150)
  rule: "#2e352f", // --screen-rule oklch(0.32 0.014 150)
  ink: "#e5e9e6", // --screen-ink oklch(0.93 0.006 150)
  muted: "#8f9490", // --screen-ink-muted oklch(0.66 0.008 150)
  keyword: "#86a4e4", // --syn-keyword oklch(0.72 0.10 265)
  literal: "#adbee2", // --syn-literal oklch(0.80 0.055 265)
  comment: "#808581", // --syn-comment oklch(0.61 0.008 150)
  error: "#fa6863", // --error-screen oklch(0.70 0.18 25)
  warn: "#ebb25f", // --warn-screen oklch(0.80 0.12 75)
}

const NONE = "#00000000"

function screenTheme(ground: string): monaco.editor.IStandaloneThemeData {
  const strip = (hex: string) => hex.slice(1)
  return {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: strip(TOKENS.ink), background: strip(ground) },
      { token: "keyword", foreground: strip(TOKENS.keyword) },
      { token: "string", foreground: strip(TOKENS.literal) },
      { token: "number", foreground: strip(TOKENS.literal) },
      { token: "comment", foreground: strip(TOKENS.comment) },
      { token: "identifier", foreground: strip(TOKENS.ink) },
      { token: "delimiter", foreground: strip(TOKENS.ink) },
    ],
    colors: {
      "editor.background": ground,
      "editor.foreground": TOKENS.ink,
      "editorGutter.background": ground,
      "editorLineNumber.foreground": TOKENS.muted,
      "editorLineNumber.activeForeground": TOKENS.ink,
      "editorCursor.foreground": TOKENS.ink,
      "editor.selectionBackground": TOKENS.rule,
      "editor.inactiveSelectionBackground": TOKENS.raised,
      "editor.selectionHighlightBackground": TOKENS.raised,
      "editor.wordHighlightBackground": TOKENS.raised,
      "editor.wordHighlightStrongBackground": TOKENS.raised,
      "editor.findMatchBackground": TOKENS.rule,
      "editor.findMatchHighlightBackground": TOKENS.raised,
      "editor.lineHighlightBackground": NONE,
      "editor.lineHighlightBorder": NONE,
      "editorIndentGuide.background1": TOKENS.rule,
      "editorIndentGuide.activeBackground1": TOKENS.muted,
      "editorBracketMatch.background": TOKENS.raised,
      "editorBracketMatch.border": TOKENS.muted,
      "editorOverviewRuler.border": NONE,
      "editorWhitespace.foreground": TOKENS.rule,
      "editorError.foreground": TOKENS.error,
      "editorWarning.foreground": TOKENS.warn,
      "editorInfo.foreground": TOKENS.keyword,
      "editorHint.foreground": TOKENS.muted,
      "editorInlayHint.foreground": TOKENS.muted,
      "editorInlayHint.background": TOKENS.raised,
      "editorInlayHint.typeForeground": TOKENS.muted,
      "editorInlayHint.typeBackground": TOKENS.raised,
      "editorInlayHint.parameterForeground": TOKENS.muted,
      "editorInlayHint.parameterBackground": TOKENS.raised,
      "editorWidget.background": TOKENS.raised,
      "editorWidget.foreground": TOKENS.ink,
      "editorWidget.border": TOKENS.rule,
      "editorHoverWidget.background": TOKENS.raised,
      "editorHoverWidget.foreground": TOKENS.ink,
      "editorHoverWidget.border": TOKENS.rule,
      "editorHoverWidget.statusBarBackground": TOKENS.raised,
      "editorSuggestWidget.background": TOKENS.raised,
      "editorSuggestWidget.foreground": TOKENS.ink,
      "editorSuggestWidget.border": TOKENS.rule,
      "editorSuggestWidget.selectedBackground": TOKENS.rule,
      "editorSuggestWidget.highlightForeground": TOKENS.keyword,
      "editorSuggestWidget.focusHighlightForeground": TOKENS.keyword,
      "editorSuggestWidgetStatus.foreground": TOKENS.muted,
      "list.hoverBackground": TOKENS.rule,
      "list.activeSelectionBackground": TOKENS.rule,
      "list.focusBackground": TOKENS.rule,
      "list.highlightForeground": TOKENS.keyword,
      "symbolIcon.keywordForeground": TOKENS.muted,
      "symbolIcon.fieldForeground": TOKENS.muted,
      "symbolIcon.variableForeground": TOKENS.muted,
      "symbolIcon.functionForeground": TOKENS.muted,
      "symbolIcon.methodForeground": TOKENS.muted,
      "symbolIcon.classForeground": TOKENS.muted,
      "symbolIcon.structForeground": TOKENS.muted,
      "symbolIcon.snippetForeground": TOKENS.muted,
      "symbolIcon.constantForeground": TOKENS.muted,
      "symbolIcon.propertyForeground": TOKENS.muted,
      "symbolIcon.moduleForeground": TOKENS.muted,
      "symbolIcon.fileForeground": TOKENS.muted,
      "symbolIcon.folderForeground": TOKENS.muted,
      "symbolIcon.enumeratorForeground": TOKENS.muted,
      "symbolIcon.enumeratorMemberForeground": TOKENS.muted,
      "symbolIcon.interfaceForeground": TOKENS.muted,
      "symbolIcon.eventForeground": TOKENS.muted,
      "input.background": ground,
      "input.foreground": TOKENS.ink,
      "input.border": TOKENS.rule,
      "inputOption.activeBorder": TOKENS.muted,
      focusBorder: NONE,
      "scrollbar.shadow": NONE,
      "widget.shadow": NONE,
      "scrollbarSlider.background": `${TOKENS.rule}99`,
      "scrollbarSlider.hoverBackground": `${TOKENS.muted}66`,
      "scrollbarSlider.activeBackground": `${TOKENS.muted}99`,
      "menu.background": TOKENS.raised,
      "menu.foreground": TOKENS.ink,
      "menu.selectionBackground": TOKENS.rule,
      "menu.selectionForeground": TOKENS.ink,
      "menu.separatorBackground": TOKENS.rule,
      "menu.border": TOKENS.rule,
    },
  }
}

export function themeNameFor(documentElement: HTMLElement): string {
  return documentElement.classList.contains("dark")
    ? THEME_DARK_HOST
    : THEME_LIGHT_HOST
}

/* ----------------------------------------------------------------------- */
/* One-time setup                                                           */
/* ----------------------------------------------------------------------- */

let setupDone = false

/** Registers the worker, languages and themes. Safe to call more than once. */
export function setupMonaco(): void {
  if (setupDone) return
  setupDone = true
  // Astro drops the CSS of a dynamically imported chunk, and the page must not
  // carry Monaco's styles before the visitor asks for it: inject them here.
  const style = document.createElement("style")
  style.dataset.oxablMonaco = ""
  style.textContent = monacoCss
  document.head.append(style)
  ;(
    self as unknown as { MonacoEnvironment: monaco.Environment }
  ).MonacoEnvironment = {
    getWorker: () => new EditorWorker(),
  }
  registerLanguages()
  monaco.editor.defineTheme(THEME_LIGHT_HOST, screenTheme(TOKENS.screen))
  monaco.editor.defineTheme(THEME_DARK_HOST, screenTheme(TOKENS.screenDeep))
}

export const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions =
  {
    fontFamily: EDITOR_FONT,
    fontSize: 14,
    lineHeight: 24,
    fontLigatures: false,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: "none",
    lineNumbersMinChars: 3,
    folding: false,
    glyphMargin: false,
    automaticLayout: true,
    padding: { top: 24, bottom: 24 },
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
    fixedOverflowWidgets: true,
    inlayHints: { enabled: "on", fontSize: 12, fontFamily: EDITOR_FONT },
    bracketPairColorization: { enabled: false },
    guides: { bracketPairs: false, indentation: true },
    // Suggestions are the engine's alone: no word-based filler beside them.
    wordBasedSuggestions: "off",
    quickSuggestions: { other: true, comments: false, strings: false },
    suggestOnTriggerCharacters: true,
    tabSize: 4,
    insertSpaces: true,
    wordWrap: "off",
    smoothScrolling: false,
    cursorSmoothCaretAnimation: "off",
    cursorBlinking: "solid",
    occurrencesHighlight: "off",
    selectionHighlight: false,
    renderWhitespace: "none",
    contextmenu: false,
    suggestFontSize: 14,
    suggestLineHeight: 24,
    ariaLabel: "Project source",
  }

/* ----------------------------------------------------------------------- */
/* Diagnostics -> markers                                                   */
/* ----------------------------------------------------------------------- */

const SEVERITY: Record<WireDiagnostic["severity"], monaco.MarkerSeverity> = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info: monaco.MarkerSeverity.Info,
  hint: monaco.MarkerSeverity.Hint,
}

export function diagnosticsToMarkers(
  model: monaco.editor.ITextModel,
  diagnostics: readonly WireDiagnostic[]
): monaco.editor.IMarkerData[] {
  const snap = snapshotOf(model)
  return diagnostics.map((d) => {
    const range = rangeOf(snap, d.start, d.end)
    let { startColumn, endColumn } = range
    // A zero-width parse error would draw no squiggle: widen it by one
    // column, backwards when it sits at the end of its line.
    if (
      range.startLineNumber === range.endLineNumber &&
      startColumn === endColumn
    ) {
      const lineEnd = model.getLineMaxColumn(range.endLineNumber)
      if (endColumn < lineEnd) endColumn += 1
      else startColumn = Math.max(1, startColumn - 1)
    }
    return {
      severity: SEVERITY[d.severity],
      code: d.code,
      source: `oxabl (${d.source})`,
      message: d.help ? `${d.message}\n${d.help}` : d.message,
      startLineNumber: range.startLineNumber,
      startColumn,
      endLineNumber: range.endLineNumber,
      endColumn,
    }
  })
}

/* ----------------------------------------------------------------------- */
/* Providers                                                                */
/* ----------------------------------------------------------------------- */

export type ProviderContext = {
  client: OxablClient
  /** Sends pending edits of `path` to the engine before a query about it. */
  flush(path: string): Promise<void>
  hintsEnabled(): boolean
  onFailure(failure: OxablFailure): void
  onFormat(result: { changed: boolean; error: string | null }): void
}

const COMPLETION_KIND: Record<
  WireCompletionItemKind,
  monaco.languages.CompletionItemKind
> = {
  keyword: monaco.languages.CompletionItemKind.Keyword,
  snippet: monaco.languages.CompletionItemKind.Snippet,
  variable: monaco.languages.CompletionItemKind.Variable,
  property: monaco.languages.CompletionItemKind.Property,
  method: monaco.languages.CompletionItemKind.Method,
  function: monaco.languages.CompletionItemKind.Function,
  struct: monaco.languages.CompletionItemKind.Struct,
  field: monaco.languages.CompletionItemKind.Field,
  class: monaco.languages.CompletionItemKind.Class,
  interface: monaco.languages.CompletionItemKind.Interface,
  enum: monaco.languages.CompletionItemKind.Enum,
  enum_member: monaco.languages.CompletionItemKind.EnumMember,
  event: monaco.languages.CompletionItemKind.Event,
  module: monaco.languages.CompletionItemKind.Module,
  file: monaco.languages.CompletionItemKind.File,
  folder: monaco.languages.CompletionItemKind.Folder,
  constant: monaco.languages.CompletionItemKind.Constant,
}

type OxablCompletionItem = monaco.languages.CompletionItem & {
  oxablResolve?: WireResolveData | null
}

const hintsChanged = new monaco.Emitter<void>()

/** Asks Monaco to request inlay hints again (after an edit or a toggle). */
export function refreshInlayHints(): void {
  hintsChanged.fire()
}

/** Edits that replace the whole model with the formatter's output. */
export async function formatEdits(
  ctx: ProviderContext,
  model: monaco.editor.ITextModel
): Promise<monaco.languages.TextEdit[]> {
  const path = pathOfModel(model)
  await ctx.flush(path)
  const result = await ctx.client.format(path)
  if (!result.ok) {
    ctx.onFailure(result.failure)
    return []
  }
  ctx.onFormat({ changed: result.value.changed, error: result.value.error })
  if (result.value.error !== null || !result.value.changed) return []
  return [{ range: model.getFullModelRange(), text: result.value.source }]
}

export function registerProviders(ctx: ProviderContext): monaco.IDisposable {
  const { client } = ctx
  const disposables: monaco.IDisposable[] = []

  disposables.push(
    monaco.languages.registerHoverProvider("abl", {
      async provideHover(model, position, token) {
        const path = pathOfModel(model)
        await ctx.flush(path)
        const snap = snapshotOf(model)
        const byte = monacoPositionToByteOffset(snap.text, snap.index, position)
        const result = await client.hover(path, byte)
        if (token.isCancellationRequested) return null
        if (!result.ok) {
          ctx.onFailure(result.failure)
          return null
        }
        const hover = result.value
        if (!hover || model.getVersionId() !== snap.version) return null
        return {
          contents: [{ value: hover.contents }],
          range:
            hover.start && hover.end
              ? rangeOf(snap, hover.start, hover.end)
              : undefined,
        }
      },
    })
  )

  disposables.push(
    monaco.languages.registerInlayHintsProvider("abl", {
      onDidChangeInlayHints: hintsChanged.event,
      async provideInlayHints(model, range, token) {
        const empty = { hints: [], dispose() {} }
        if (!ctx.hintsEnabled()) return empty
        const path = pathOfModel(model)
        await ctx.flush(path)
        const snap = snapshotOf(model)
        const result = await client.inlayHints(path, {})
        if (token.isCancellationRequested) return empty
        if (!result.ok) {
          ctx.onFailure(result.failure)
          return empty
        }
        if (model.getVersionId() !== snap.version) return empty
        const hints: monaco.languages.InlayHint[] = []
        for (const hint of result.value.hints) {
          const position = toMonaco(snap, hint.at)
          if (
            position.lineNumber < range.startLineNumber ||
            position.lineNumber > range.endLineNumber
          ) {
            continue
          }
          hints.push({
            label: hint.label,
            position,
            tooltip: hint.tooltip,
            paddingLeft: hint.after,
            paddingRight: !hint.after,
          })
        }
        return { hints, dispose() {} }
      },
    })
  )

  disposables.push(
    monaco.languages.registerCompletionItemProvider("abl", {
      triggerCharacters: [":", ".", "{", "&", "/"],
      async provideCompletionItems(model, position, context, token) {
        const path = pathOfModel(model)
        await ctx.flush(path)
        const snap = snapshotOf(model)
        const byte = monacoPositionToByteOffset(snap.text, snap.index, position)
        const result = await client.complete(
          path,
          byte,
          context.triggerCharacter ?? null
        )
        if (token.isCancellationRequested) return undefined
        if (!result.ok) {
          ctx.onFailure(result.failure)
          return undefined
        }
        const list = result.value
        if (!list || model.getVersionId() !== snap.version) return undefined
        const insert = rangeOf(snap, list.word_start, list.cursor)
        const replaceEnd =
          list.word_end.byte > list.cursor.byte ? list.word_end : list.cursor
        const replace = rangeOf(snap, list.word_start, replaceEnd)
        const suggestions = list.items.map((item): OxablCompletionItem => ({
          label: item.label,
          kind: COMPLETION_KIND[item.kind],
          detail: item.detail ?? undefined,
          insertText: item.insert,
          insertTextRules: item.snippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          sortText: item.sort_text,
          filterText: item.label,
          range: { insert, replace },
          oxablResolve: item.resolve_data,
        }))
        return { incomplete: list.incomplete, suggestions }
      },
      async resolveCompletionItem(item) {
        const data = (item as OxablCompletionItem).oxablResolve
        if (!data) return item
        const result = await client.resolveCompletion(data)
        if (!result.ok) {
          ctx.onFailure(result.failure)
          return item
        }
        if (result.value.documentation) {
          item.documentation = { value: result.value.documentation }
        }
        return item
      },
    })
  )

  disposables.push(
    monaco.languages.registerDefinitionProvider("abl", {
      async provideDefinition(model, position, token) {
        const path = pathOfModel(model)
        await ctx.flush(path)
        const snap = snapshotOf(model)
        const byte = monacoPositionToByteOffset(snap.text, snap.index, position)
        const result = await client.definitions(path, byte)
        if (token.isCancellationRequested) return null
        if (!result.ok) {
          ctx.onFailure(result.failure)
          return null
        }
        const locations: monaco.languages.Location[] = []
        for (const target of result.value.targets) {
          const targetModel = monaco.editor.getModel(modelUri(target.path))
          if (!targetModel) continue
          // An include reference has no span: land at the top of the file.
          const range: monaco.IRange =
            target.start && target.end
              ? rangeOf(snapshotOf(targetModel), target.start, target.end)
              : {
                  startLineNumber: 1,
                  startColumn: 1,
                  endLineNumber: 1,
                  endColumn: 1,
                }
          locations.push({ uri: targetModel.uri, range })
        }
        return locations
      },
    })
  )

  disposables.push(
    monaco.languages.registerDocumentFormattingEditProvider("abl", {
      provideDocumentFormattingEdits: (model) => formatEdits(ctx, model),
    })
  )

  return {
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}

/**
 * Makes Ctrl+click and F12 switch files: the standalone editor cannot open
 * another model by itself, so the opener hands the switch to the component.
 */
export function registerFileOpener(
  onOpen: (
    path: string,
    selection: monaco.IRange | monaco.IPosition | undefined
  ) => void
): monaco.IDisposable {
  return monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      const uri = resource.toString()
      if (!uri.startsWith(WORKSPACE_URI_PREFIX)) return false
      onOpen(
        decodeURIComponent(uri.slice(WORKSPACE_URI_PREFIX.length)),
        selectionOrPosition
      )
      return true
    },
  })
}

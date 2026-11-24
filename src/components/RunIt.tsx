import * as React from "react"
import checkOutput from "@/data/check-output.json"

const consumers = ["jq", "grep", "ci", "agent"] as const
type Consumer = (typeof consumers)[number]

// Real transcripts, run in examples/check with oxabl 5.9.0.
const consumerOutput: Record<Consumer, React.ReactNode> = {
  jq: (
    <>
      <span className="text-screen-ink-muted">$</span> jq '.diagnostics[] |{"{"}
      path, line: .start.line, code, message{"}"}' check.json{"\n"}
      {`{
  "path": "src/undefined_symbol.p",
  "line": 3,
  "code": "LINT0001",
  "message": "undefined symbol \`ghost\`"
}`}
    </>
  ),
  grep: (
    <>
      <span className="text-screen-ink-muted">$</span> grep -n
      '"code"\|"drifted_count"' check.json{"\n"}
      {`8:      "code": "LINT0001",
31:    "drifted_count": 0`}
    </>
  ),
  ci: (
    <>
      <span className="text-screen-ink-muted">$</span> jq -e '.diagnostics |
      length == 0' check.json{"\n"}
      <span className="text-error-screen">false</span>
    </>
  ),
  agent: (
    <>
      <span className="text-screen-ink-muted">$</span> claude -p 'Review this
      oxabl check JSON. Report only actionable source issues.' &lt; check.json
      {"\n"}
      {`The one diagnostic is real and actionable.

- **\`src/undefined_symbol.p:3:11\`** (\`LINT0001\`, error): \`undefined symbol 'ghost'\`. Line 3 is \`MESSAGE x ghost.\`, and \`ghost\` is never declared. Only \`x\` is defined, on line 1. The span (bytes 49–54) and line/column match the file.
  - **Fix:** add a \`DEFINE VARIABLE ghost ...\` declaration, or remove \`ghost\` from the \`MESSAGE\` statement.
  - If this file is an intentional lint fixture (its name suggests it might be), no change is needed. The check is working as intended.

Nothing else needs action: \`format.drifted_count\` is 0, \`preproc\` and \`failures\` are empty, and \`unjudged_symbols\` is 0.`}
    </>
  ),
}

export function RunIt() {
  const [active, setActive] = React.useState<Consumer>("jq")
  const tabsRef = React.useRef<Array<HTMLButtonElement | null>>([])

  function selectFromKeyboard(index: number) {
    const next = consumers[(index + consumers.length) % consumers.length]
    setActive(next)
    tabsRef.current[consumers.indexOf(next)]?.focus()
  }

  return (
    <div className="screen-material border-t border-screen-rule bg-screen text-screen-ink md:border">
      <div className="grid min-h-[408px] lg:grid-cols-2">
        <div className="min-w-0 border-b border-screen-rule lg:border-r lg:border-b-0">
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-screen-rule px-4 font-chrome text-chrome uppercase">
            <span>Fixed output / check JSON</span>
            <span className="text-screen-ink-muted">producer</span>
          </div>
          <pre className="max-h-[360px] overflow-auto p-6 font-code text-code text-screen-ink">
            <code>
              <span className="text-screen-ink-muted">$</span> oxabl check src
              --json &gt; check.json{"\n\n"}
              {JSON.stringify(checkOutput, null, 2)}
            </code>
          </pre>
        </div>

        <div className="min-w-0">
          <div
            role="tablist"
            aria-label="Analysis output consumers"
            className="grid min-h-12 grid-cols-4 border-b border-screen-rule font-chrome text-chrome uppercase"
          >
            {consumers.map((consumer, index) => (
              <button
                key={consumer}
                ref={(element) => {
                  tabsRef.current[index] = element
                }}
                id={`consumer-tab-${consumer}`}
                type="button"
                role="tab"
                aria-selected={active === consumer}
                aria-controls={`consumer-panel-${consumer}`}
                tabIndex={active === consumer ? 0 : -1}
                onClick={() => setActive(consumer)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") {
                    event.preventDefault()
                    selectFromKeyboard(index + 1)
                  } else if (event.key === "ArrowLeft") {
                    event.preventDefault()
                    selectFromKeyboard(index - 1)
                  } else if (event.key === "Home") {
                    event.preventDefault()
                    selectFromKeyboard(0)
                  } else if (event.key === "End") {
                    event.preventDefault()
                    selectFromKeyboard(consumers.length - 1)
                  }
                }}
                className={`border-r border-screen-rule px-2 text-screen-ink last:border-r-0 ${
                  active === consumer ? "bg-screen-raised" : "bg-screen"
                }`}
              >
                {consumer}
              </button>
            ))}
          </div>

          <div className="grid min-h-[360px]">
            {consumers.map((consumer) => (
              <div
                key={consumer}
                id={`consumer-panel-${consumer}`}
                role="tabpanel"
                aria-labelledby={`consumer-tab-${consumer}`}
                aria-hidden={active !== consumer}
                className={`col-start-1 row-start-1 p-6 transition-opacity duration-[120ms] motion-reduce:transition-none ${
                  active === consumer
                    ? "opacity-100"
                    : "pointer-events-none opacity-0"
                }`}
              >
                <p className="font-chrome text-chrome text-screen-ink-muted uppercase">
                  Consumer / {consumer}
                </p>
                <pre className="mt-6 overflow-x-auto font-code text-code whitespace-pre-wrap text-screen-ink">
                  <code>{consumerOutput[consumer]}</code>
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

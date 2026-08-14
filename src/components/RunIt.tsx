import * as React from "react"

const consumers = ["jq", "grep", "ci", "agent"] as const
type Consumer = (typeof consumers)[number]

const consumerOutput: Record<Consumer, React.ReactNode> = {
  jq: (
    <>
      <span className="text-screen-ink-muted">$</span> jq '.diagnostics'
      /tmp/oxabl-analyze.json{"\n"}
      <span className="text-screen-ink-muted">[output not yet published]</span>
    </>
  ),
  grep: (
    <>
      <span className="text-screen-ink-muted">$</span> grep -n '"diagnostics"'
      /tmp/oxabl-analyze.json{"\n"}
      <span className="text-screen-ink-muted">[output not yet published]</span>
    </>
  ),
  ci: (
    <>
      <span className="text-screen-ink-muted">$</span> jq -e '.diagnostics |
      length == 0' /tmp/oxabl-analyze.json{"\n"}
      <span className="text-screen-ink-muted">[output not yet published]</span>
    </>
  ),
  agent: (
    <>
      <span className="text-screen-ink-muted">$</span> codex exec 'Review this
      oxabl analysis JSON. Report only actionable source issues.'
      {" \\"}
      {"\n"} &lt; /tmp/oxabl-analyze.json{"\n"}
      <span className="text-screen-ink-muted">[output not yet published]</span>
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
    <>
      <div className="grid border border-rule-strong md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="border-b border-rule p-6 md:border-r md:border-b-0 md:p-12">
          <p className="font-chrome text-chrome text-ink-muted uppercase">
            Install
          </p>
          <code className="mt-6 block overflow-x-auto font-code text-code whitespace-nowrap text-ink">
            single binary install coming soon
          </code>
        </div>

        <div className="grid sm:grid-cols-2">
          <div className="border-b border-rule p-6 sm:border-r sm:border-b-0">
            <p className="font-chrome text-chrome text-ink-muted uppercase">
              CLI / daily use
            </p>
            <pre className="mt-6 overflow-x-auto font-code text-code text-ink">
              <code>{`oxabl check .
oxabl format src --check
oxabl format src
oxabl lsp`}</code>
            </pre>
          </div>
          <div className="p-6">
            <p className="font-chrome text-chrome text-ink-muted uppercase">
              CI / GitHub Actions
            </p>
            <pre className="mt-6 overflow-x-auto font-code text-code text-ink">
              <code>{`- name: Install oxabl
  run: cargo install oxabl --locked
- name: Check ABL
  run: oxabl check .`}</code>
            </pre>
          </div>
        </div>
      </div>

      <div className="screen-material mt-6 border border-screen-rule bg-screen text-screen-ink">
        <div className="grid min-h-[408px] lg:grid-cols-2">
          <div className="border-b border-screen-rule lg:border-r lg:border-b-0">
            <div className="flex min-h-12 items-center justify-between gap-3 border-b border-screen-rule px-4 font-chrome text-chrome uppercase">
              <span>Fixed output / analyze JSON</span>
              <span className="text-screen-ink-muted">producer</span>
            </div>
            <pre className="overflow-x-auto p-6 font-code text-code text-screen-ink">
              <code>
                <span className="text-screen-ink-muted">$</span> cargo run -q -p
                oxabl -- analyze{" \\"}
                {"\n"} crates/oxabl_analyze/tests/fixtures/simple_variable.p
                {" \\"}
                {"\n"} --format json &gt; /tmp/oxabl-analyze.json{"\n\n"}
                <span className="text-screen-ink-muted">
                  [payload not yet published]
                </span>
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
    </>
  )
}

// TODO(output): From /home/evanr/oxabl, create the fixed payload with:
// cargo run -q -p oxabl -- analyze crates/oxabl_analyze/tests/fixtures/simple_variable.p --format json > /tmp/oxabl-analyze.json
// Replace the left-hand publication notice with the exact contents of /tmp/oxabl-analyze.json.
// TODO(output/jq): Run `jq '.diagnostics' /tmp/oxabl-analyze.json` and replace only the jq publication notice.
// TODO(output/grep): Run `grep -n '"diagnostics"' /tmp/oxabl-analyze.json` and replace only the grep publication notice.
// TODO(output/ci): Run `jq -e '.diagnostics | length == 0' /tmp/oxabl-analyze.json` and replace only the ci publication notice.
// TODO(output/agent): Run `codex exec 'Review this oxabl analysis JSON. Report only actionable source issues.' < /tmp/oxabl-analyze.json` and replace only the agent publication notice.

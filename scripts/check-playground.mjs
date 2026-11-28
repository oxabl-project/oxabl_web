// Black-box check of the project playground in a real browser.
//   pnpm build && pnpm playground:check
//
// 1. The weight gate: gzipped sizes of the lazy payload against the measured
//    sizes plus 10%, and the "about N MB" line the placeholder shows against the
//    Brotli total.
// 2. The load gate: nothing of Monaco, the worker or the WASM is requested on
//    load or after the playground scrolls into view, and all of it is requested
//    after the click on "Load demo playground".
// 3. The workbench: planted findings, inlay hints, file switching, the parse
//    error and the formatter bail, edit and Reset, go to definition into the
//    include and the schema, and completion.
//
// Chromium comes from Playwright (`pnpm exec playwright install chromium`).
// Set OXABL_BROWSER=/path/to/chrome to use an installed browser instead.
import { spawn } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { brotliCompressSync, constants, gzipSync } from "node:zlib"
import { chromium } from "playwright"

const root = join(import.meta.dirname, "..")
const dist = join(root, "dist")
const port = Number(process.env.OXABL_PLAYGROUND_PORT ?? 4322)
const base = `http://127.0.0.1:${port}`

const MAIN = "src/order-fulfillment.p"
const CREDIT = "src/credit-check.p"
const INCLUDE = "inc/order-totals.i"
const SCHEMA = "schema/sp2k.df"

// Measured gzip -9 sizes of the lazy payload, in bytes (Node's zlib, as this
// script computes them). The gate is these plus 10%: a bigger Monaco import or
// a bigger engine fails here and must be justified by raising a number.
// `monaco` is the Playground chunk: Monaco core, its contributions, the three
// languages and the playground's own code.
const MEASURED_GZIP = {
  wasm: 1_016_193,
  monaco: 914_091,
  worker: 98_906,
}
const HEADROOM = 1.1

const failures = []
// Each step line says ok or FAIL for the checks since the previous step.
let reported = 0
const step = (label) => {
  console.log(`${failures.length === reported ? "ok  " : "FAIL"} ${label}`)
  reported = failures.length
}
const check = (ok, what) => {
  if (!ok) failures.push(what)
  return ok
}

/* ----------------------------------------------------------------------- */
/* 1. Weight                                                                */
/* ----------------------------------------------------------------------- */

function assets() {
  const dir = join(dist, "_astro")
  if (!existsSync(dir)) {
    console.error("dist/_astro is missing: run `pnpm build` first")
    process.exit(1)
  }
  const files = readdirSync(dir)
  const one = (pattern, label) => {
    const hits = files.filter((f) => pattern.test(f))
    if (hits.length !== 1) {
      console.error(`expected one ${label} in dist/_astro, found: ${hits}`)
      process.exit(1)
    }
    return join(dir, hits[0])
  }
  return {
    wasm: one(/^oxabl_wasm_bg-.*\.wasm$/, "WASM artifact"),
    monaco: one(/^Playground\..*\.js$/, "Playground chunk (Monaco and app)"),
    worker: one(/^editor\.worker-.*\.js$/, "Monaco editor worker"),
    engineWorker: one(/^oxabl\.worker-.*\.js$/, "oxabl worker"),
    font: one(/^codicon\..*\.ttf$/, "Monaco icon font"),
  }
}

const sizeOf = (file) => {
  const bytes = readFileSync(file)
  return {
    raw: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
  }
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`
const mb = (n) => `${(n / 1_000_000).toFixed(2)} MB`

function checkWeight() {
  const files = assets()
  const sizes = Object.fromEntries(
    Object.entries(files).map(([name, file]) => [name, sizeOf(file)])
  )
  const limits = {
    wasm: Math.ceil(MEASURED_GZIP.wasm * HEADROOM),
    monaco: Math.ceil(MEASURED_GZIP.monaco * HEADROOM),
    worker: Math.ceil(MEASURED_GZIP.worker * HEADROOM),
  }
  for (const name of ["wasm", "monaco", "worker"]) {
    const { raw, gzip, brotli } = sizes[name]
    const ok = gzip <= limits[name]
    console.log(
      `${ok ? "ok  " : "FAIL"} ${name.padEnd(7)} raw ${kb(raw)}  gzip ${kb(gzip)} (limit ${kb(limits[name])})  brotli ${kb(brotli)}`
    )
    check(
      ok,
      `${name} is ${gzip} bytes gzipped, over the ${limits[name]} limit (measured ${MEASURED_GZIP[name]} + 10%)`
    )
  }

  // What a visitor downloads after the click, as a CDN would serve it.
  const lazy = Object.values(sizes)
  const totalGzip = lazy.reduce((sum, s) => sum + s.gzip, 0)
  const totalBrotli = lazy.reduce((sum, s) => sum + s.brotli, 0)
  console.log(
    `     lazy total: gzip ${mb(totalGzip)}, brotli ${mb(totalBrotli)}`
  )

  // The placeholder promises a size; it has to match what is shipped.
  const shell = readFileSync(join(root, "src/components/TryOxabl.tsx"), "utf8")
  const claim = /const LOAD_SIZE = "about ([\d.]+) MB"/.exec(shell)
  if (check(claim !== null, "TryOxabl.tsx has no LOAD_SIZE claim")) {
    const claimed = Number(claim[1]) * 1_000_000
    const ok = Math.abs(totalBrotli - claimed) / claimed <= 0.1
    check(
      ok,
      `the placeholder says about ${claim[1]} MB but the lazy payload is ${mb(totalBrotli)} Brotli`
    )
  }
}

/* ----------------------------------------------------------------------- */
/* Server and browser                                                       */
/* ----------------------------------------------------------------------- */

async function startPreview() {
  try {
    await fetch(base, { signal: AbortSignal.timeout(1000) })
    console.error(`port ${port} is already serving something: stop it first`)
    process.exit(1)
  } catch {
    // Nothing listens: good.
  }
  const server = spawn(
    "pnpm",
    ["exec", "astro", "preview", "--host", "127.0.0.1", "--port", String(port)],
    { cwd: root, stdio: "ignore" }
  )
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base, { signal: AbortSignal.timeout(1000) })
      if (res.ok) return server
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  server.kill()
  console.error("astro preview did not start")
  process.exit(1)
}

async function launch() {
  const executablePath = process.env.OXABL_BROWSER
  return chromium.launch(executablePath ? { executablePath } : {})
}

const HEAVY_ASSET =
  /\/_astro\/[^"'\s]*(Playground|editor\.worker|oxabl\.worker|oxabl_wasm|codicon)/
const HEAVY = new RegExp(`${HEAVY_ASSET.source}|monaco`, "i")
const norm = (text) => text.replaceAll("\u00a0", " ")

/* ----------------------------------------------------------------------- */
/* The checks that need a browser                                           */
/* ----------------------------------------------------------------------- */

async function checkLoadGate(browser, errors) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const requests = []
  page.on("request", (r) => requests.push(r.url()))
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
  page.on("pageerror", (e) => errors.push(e.message))

  const html = await (await fetch(base)).text()
  check(
    !HEAVY_ASSET.test(html),
    "index.html names a Monaco, worker or WASM file"
  )

  await page.goto(base)
  const load = page.locator("[data-playground-load]")
  await load.waitFor({ state: "visible" })
  await page.waitForFunction(
    () => !document.querySelector("[data-playground-load]")?.disabled
  )
  await page.waitForLoadState("networkidle")
  check(
    requests.filter((u) => HEAVY.test(u)).length === 0,
    `on load: ${requests.filter((u) => HEAVY.test(u))} requested before any click`
  )
  check(
    (await page.locator("#playground").innerText()).includes("about"),
    "the placeholder does not say how much the click downloads"
  )

  await page.locator("#playground").scrollIntoViewIfNeeded()
  await page.waitForTimeout(1500)
  await page.waitForLoadState("networkidle")
  check(
    requests.filter((u) => HEAVY.test(u)).length === 0,
    `after scrolling to the playground: ${requests.filter((u) => HEAVY.test(u))} requested before any click`
  )
  step("nothing heavy is requested on load or on scroll")

  await load.click()
  await page.waitForSelector("[data-playground-problems]", { timeout: 30_000 })
  const after = requests.filter((u) => HEAVY.test(u))
  for (const [label, pattern] of [
    ["the Monaco chunk", /Playground\./],
    ["the oxabl worker", /oxabl\.worker/],
    ["the WASM engine", /oxabl_wasm_bg.*\.wasm/],
  ]) {
    check(
      after.some((u) => pattern.test(u)),
      `${label} was not requested after the click`
    )
  }
  step("Monaco, the worker and the WASM load after the click")
  return page
}

// A wait that names itself when it times out.
async function until(label, page, predicate, arg) {
  try {
    await page.waitForFunction(predicate, arg, { timeout: 15_000 })
  } catch {
    const seen = await page
      .evaluate(
        () =>
          `${document.querySelectorAll(".monaco-editor").length} editors; ${window.__check?.text().slice(0, 240)}`
      )
      .catch(() => "")
    if (process.env.OXABL_PLAYGROUND_SHOT) {
      await page.screenshot({ path: process.env.OXABL_PLAYGROUND_SHOT })
    }
    throw new Error(
      `timed out waiting for: ${label}; the editor shows: ${seen}`
    )
  }
}

const rows = (page, file) => page.locator(`[data-problem-file="${file}"]`)

async function codesOf(page, file) {
  return (
    await rows(page, file).evaluateAll((els) =>
      els.map((e) => e.getAttribute("data-problem-code"))
    )
  ).sort()
}

const visibleCode = async (page) =>
  norm(await page.locator(".monaco-editor .view-lines").first().innerText())

async function activeFile(page) {
  return page
    .locator("[data-playground-editor]")
    .getAttribute("data-active-file")
}

const railButton = (page, name) =>
  page.getByRole("navigation", { name: "Project files" }).getByRole("button", {
    name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  })

async function selectText(page, text) {
  // Find, jump to the match, close the widget: the match stays selected.
  await page.keyboard.press("Control+f")
  await page.keyboard.press("Control+a")
  await page.keyboard.type(text)
  await page.keyboard.press("Enter")
  await page.keyboard.press("Escape")
  await page.keyboard.press("ArrowLeft")
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight")
}

// Predicates run inside the page, so they read these helpers from `window`.
const installPageHelpers = (page) =>
  page.evaluate(() => {
    window.__check = {
      text: () =>
        (
          document.querySelector(".monaco-editor .view-lines")?.textContent ??
          ""
        ).replaceAll("\u00a0", " "),
      activeIs: (file) =>
        document
          .querySelector("[data-playground-editor]")
          ?.getAttribute("data-active-file") === file,
      hasCode: (file, code) =>
        [...document.querySelectorAll(`[data-problem-file="${file}"]`)].some(
          (e) => e.getAttribute("data-problem-code") === code
        ),
    }
  })

async function checkWorkbench(page) {
  await installPageHelpers(page)
  const editor = page.locator("[data-playground-editor]")
  const planted = [
    "DB001",
    "DB001",
    "LINT0002",
    "LINT0003",
    "LK001",
    "TX001",
    "TX005",
    "TX006",
  ].sort()

  // Mount and findings.
  check(
    (await activeFile(page)) === MAIN,
    "the default file is not the main program"
  )
  const mainCodes = await codesOf(page, MAIN)
  check(
    JSON.stringify(mainCodes) === JSON.stringify(planted),
    `${MAIN} findings are ${mainCodes}, expected ${planted}`
  )
  check(
    !mainCodes.includes("PARSE001") &&
      !mainCodes.some((c) => c.startsWith("PREPROC")),
    "the main program shows a parse or preprocessor error"
  )
  const creditCodes = await codesOf(page, CREDIT)
  check(
    JSON.stringify(creditCodes) === JSON.stringify(["LINT0002", "PARSE001"]),
    `${CREDIT} findings are ${creditCodes}, expected LINT0002 and PARSE001`
  )
  step("findings: main program and credit-check.p")

  // Inlay hints, read from the lines Monaco renders after a problem row
  // scrolls the editor to the code.
  for (const [code, hint] of [
    ["LK001", "SHARE-LOCK"],
    ["LINT0003", "WHOLE-INDEX"],
    ["TX001", "transaction starts"],
  ]) {
    await rows(page, MAIN).filter({ hasText: code }).first().click()
    await until(
      `the hint "${hint}" next to ${code}`,
      page,
      (h) => window.__check.text().includes(h),
      hint
    )
  }
  // TX005 raises the Customer buffer to the main block, so its scope hint
  // sits at the top of the file, not at the line TX005 names.
  await editor.click()
  await page.keyboard.press("Control+Home")
  await until(
    'the hint "Customer scope starts" at the top of the file',
    page,
    (h) => window.__check.text().includes(h),
    "Customer scope starts"
  )
  step("inlay hints: SHARE-LOCK, WHOLE-INDEX, transaction, scope")

  // The Hints control turns them off and on.
  await rows(page, MAIN).filter({ hasText: "TX001" }).click()
  await page.getByRole("button", { name: "Hints On" }).click()
  await until(
    "hints to disappear with Hints Off",
    page,
    () => !window.__check.text().includes("transaction starts")
  )
  await page.getByRole("button", { name: "Hints Off" }).click()
  await until("hints to return with Hints On", page, () =>
    window.__check.text().includes("transaction starts")
  )
  step("the Hints control turns inlay hints off and on")

  // The file with the syntax error, and the formatter bail.
  await railButton(page, "credit-check.p").click()
  await until(
    "credit-check.p to open",
    page,
    (f) => window.__check.activeIs(f),
    CREDIT
  )
  await until("credit-check.p to render", page, () =>
    window.__check.text().includes("credit-check.p")
  )
  const before = await visibleCode(page)
  const parseRow = rows(page, CREDIT).filter({ hasText: "PARSE001" })
  check(
    (await parseRow.innerText()).startsWith("error"),
    "PARSE001 is not an error"
  )
  await page.getByRole("button", { name: "Format" }).click()
  await until("the formatter bail message", page, () =>
    document
      .querySelector("[data-playground-status]")
      ?.textContent.startsWith("Formatter left source unchanged")
  )
  const after = await visibleCode(page)
  check(
    after === before,
    `Format changed a file with a syntax error:\n--- before\n${before}\n--- after\n${after}`
  )
  step("credit-check.p: PARSE001 and the formatter bail")

  // Edit the main program, then Reset.
  await railButton(page, "order-fulfillment.p").click()
  await until(
    "the main program to open",
    page,
    (f) => window.__check.activeIs(f),
    MAIN
  )
  await editor.click({ position: { x: 400, y: 100 } })
  await page.keyboard.press("Control+End")
  await page.keyboard.type("\nIF TRUE")
  await until(
    "PARSE001 after the edit",
    page,
    ({ file, code }) => window.__check.hasCode(file, code),
    {
      file: MAIN,
      code: "PARSE001",
    }
  )
  const edited = await codesOf(page, MAIN)
  check(
    !edited.includes("LK001"),
    "a parse error in the main program should silence the strict lock rule"
  )
  await page.getByRole("button", { name: "Reset" }).click()
  await until("Reset to settle", page, () => {
    const status = document.querySelector("[data-playground-status]")
    return (
      status?.getAttribute("data-busy") === "false" &&
      status.textContent.startsWith("Reset")
    )
  })
  const restored = await codesOf(page, MAIN)
  check(
    JSON.stringify(restored) === JSON.stringify(planted),
    `after Reset ${MAIN} findings are ${restored}, expected ${planted}`
  )
  step("edit, parse error, Reset restores the findings")

  // Go to definition: the include, then the schema.
  await editor.click({ position: { x: 400, y: 100 } })
  await selectText(page, "IF ttOrderSummary.NetTotal")
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight")
  await page.keyboard.press("F12")
  await until(
    "F12 on ttOrderSummary to open the include",
    page,
    (f) => window.__check.activeIs(f),
    INCLUDE
  )
  await railButton(page, "order-fulfillment.p").click()
  await until(
    "the main program to open again",
    page,
    (f) => window.__check.activeIs(f),
    MAIN
  )
  await editor.click({ position: { x: 400, y: 100 } })
  await selectText(page, "= Customer.CustNum")
  for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowRight")
  await page.keyboard.press("F12")
  await until(
    "F12 on Customer to open the schema",
    page,
    (f) => window.__check.activeIs(f),
    SCHEMA
  )
  step("F12 opens the include and the schema")

  // Completion after `Customer.`.
  await railButton(page, "order-fulfillment.p").click()
  await until(
    "the main program to open for completion",
    page,
    (f) => window.__check.activeIs(f),
    MAIN
  )
  await editor.click({ position: { x: 400, y: 100 } })
  await page.keyboard.press("Control+End")
  await page.keyboard.type("\nDISPLAY Customer.")
  await page.locator(".suggest-widget.visible").waitFor({ timeout: 10_000 })
  const offered = await page
    .locator(".suggest-widget .monaco-list-row")
    .allInnerTexts()
  check(
    offered.some((t) => t.includes("CustNum")),
    `completion after "Customer." does not offer CustNum: ${offered.slice(0, 5)}`
  )
  await page.keyboard.press("Escape")
  step("completion after Customer. offers CustNum")
}

/* ----------------------------------------------------------------------- */

checkWeight()

const server = await startPreview()
let browser
const errors = []
try {
  browser = await launch()
  const page = await checkLoadGate(browser, errors)
  await checkWorkbench(page)
  check(
    errors.length === 0,
    `console errors or page errors: ${errors.join(" | ")}`
  )
} catch (error) {
  failures.push(`the browser check stopped: ${error.message}`)
} finally {
  await browser?.close()
  server.kill()
}

if (failures.length > 0) {
  console.error(
    `\nplayground check failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`
  )
  process.exit(1)
}
console.log("\nplayground check passed")

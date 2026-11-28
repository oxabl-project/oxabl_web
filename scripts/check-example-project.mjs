// Runs the vendored engine over the playground's example project and asserts
// what the playground promises: the planted findings, the inlay hints, the
// go-to-definition targets, completion and the formatter bail. A change to the
// example ABL, the config or src/wasm/ that loses one of them fails here
// instead of in front of a reader.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { before, describe, it } from "node:test"

const root = resolve(import.meta.dirname, "..")
const dir = join(root, "src/data/playground")
const read = (path) => readFileSync(join(dir, path), "utf8")

const MAIN = "src/order-fulfillment.p"
const CREDIT = "src/credit-check.p"
const files = {
  [MAIN]: read(MAIN),
  [CREDIT]: read(CREDIT),
  "inc/order-totals.i": read("inc/order-totals.i"),
}

const glue = await import(join(root, "src/wasm/oxabl_wasm.js"))
await glue.default({
  module_or_path: readFileSync(join(root, "src/wasm/oxabl_wasm_bg.wasm")),
})

const call = (name, ...args) => JSON.parse(glue[name](...args))
const analyze = (path) => call("project_analyze", path)
const codes = (path) => analyze(path).diagnostics.map((d) => d.code)
const hints = (path) => call("project_inlay_hints", path, "{}").hints
const labels = (path) => hints(path).map((h) => h.label)
// Byte offset of `needle` in the main file, `delta` bytes in.
const offsetOf = (source, needle, delta = 0) => {
  const at = source.indexOf(needle)
  assert.notEqual(at, -1, `${needle} is in the source`)
  return Buffer.byteLength(source.slice(0, at)) + delta
}

describe("example project against the vendored engine", () => {
  before(() => {
    const status = call(
      "project_open",
      JSON.stringify({
        files,
        config: read("oxabl.toml"),
        schemas: { "schema/sp2k.df": read("sp2k.df") },
      })
    )
    assert.equal(status.ok, true, status.error ?? "open failed")
    assert.equal(status.schema_loaded, true, "the Sports2000 schema loads")
    assert.equal(status.table_count, 25)
    assert.deepEqual(status.warnings, [], "oxabl.toml resolves cleanly")
  })

  it("the main program has the planted findings and no parse or preprocessor noise", () => {
    const found = codes(MAIN)
    for (const code of [
      "LINT0002",
      "LINT0003",
      "LK001",
      "DB001",
      "TX001",
      "TX005",
      "TX006",
    ]) {
      assert.ok(found.includes(code), `${MAIN} reports ${code}, got ${found}`)
    }
    assert.ok(!found.includes("PARSE001"), "the main program parses")
    assert.ok(
      !found.some((c) => c.startsWith("PREPROC")),
      "no preprocessor errors"
    )
    assert.ok(!found.includes("LINT0001"), "no unintended LINT0001")
    assert.deepEqual(
      new Set(found),
      new Set([
        "LINT0002",
        "LINT0003",
        "LK001",
        "DB001",
        "TX001",
        "TX005",
        "TX006",
      ]),
      "no code beyond the planted ones"
    )
  })

  it("the main program shows lock, index, scope and transaction hints", () => {
    const shown = labels(MAIN)
    for (const label of [
      "SHARE-LOCK",
      "index CustNum, WHOLE-INDEX",
      "index ItemNum",
      "index CustOrder",
      "Customer scope starts",
      "Customer scope ends",
      "transaction starts",
      "transaction ends",
    ]) {
      assert.ok(shown.includes(label), `hint "${label}" is shown, got ${shown}`)
    }
  })

  it("the syntax error sits in credit-check.p, where recovery keeps the lint finding", () => {
    const diagnostics = analyze(CREDIT).diagnostics
    const parse = diagnostics.find((d) => d.code === "PARSE001")
    assert.ok(parse, "credit-check.p reports PARSE001")
    assert.equal(parse.severity, "error")
    assert.ok(
      diagnostics.some((d) => d.code === "LINT0002"),
      "the unused variable is still reported after recovery"
    )
    assert.deepEqual(
      hints(CREDIT),
      [],
      "a recovered parse shows no database hints"
    )
  })

  it("the include and the schema have no findings", () => {
    assert.deepEqual(analyze("inc/order-totals.i").diagnostics, [])
    assert.deepEqual(analyze("schema/sp2k.df").diagnostics, [])
    assert.deepEqual(analyze("oxabl.toml").diagnostics, [])
  })

  it("go to definition leaves the file for the include and the schema", () => {
    const source = files[MAIN]
    const temp = call(
      "project_definitions",
      MAIN,
      offsetOf(source, "ttOrderSummary.NetTotal", 3)
    )
    assert.equal(temp.targets[0]?.path, "inc/order-totals.i")
    assert.ok(
      temp.targets[0].start,
      "the temp-table has a position in the include"
    )

    const table = call(
      "project_definitions",
      MAIN,
      offsetOf(source, "Customer.CustNum", 3)
    )
    assert.equal(table.targets[0]?.path, "schema/sp2k.df")

    const include = call(
      "project_definitions",
      MAIN,
      offsetOf(source, "order-totals.i}", 3)
    )
    assert.equal(include.targets[0]?.path, "inc/order-totals.i")
    assert.equal(
      include.targets[0].start,
      null,
      "an include has no span: open at 1:1"
    )
  })

  it("hover documents a temp-table and a schema table", () => {
    const source = files[MAIN]
    const temp = call(
      "project_hover",
      MAIN,
      offsetOf(source, "ttOrderSummary.NetTotal", 3)
    )
    assert.match(temp.contents, /TEMP-TABLE ttOrderSummary/)
    const table = call(
      "project_hover",
      MAIN,
      offsetOf(source, "Customer.CustNum", 3)
    )
    assert.match(table.contents, /TABLE Customer/)
  })

  it("typing Customer. completes the schema fields", () => {
    const edited = `${files[MAIN]}\nDISPLAY Customer.`
    const status = call("project_update_file", MAIN, edited)
    assert.equal(status.ok, true)
    const list = call("project_complete", MAIN, Buffer.byteLength(edited), ".")
    assert.ok(list, "completion answers after a dot")
    assert.ok(
      list.items.some((i) => i.label === "CustNum"),
      "CustNum is offered"
    )
    call("project_update_file", MAIN, files[MAIN])
  })

  it("the formatter leaves the main program alone and bails on the broken one", () => {
    const main = call("project_format", MAIN)
    assert.equal(main.error, null)
    assert.equal(main.changed, false, "the example is already formatted")
    const credit = call("project_format", CREDIT)
    assert.equal(credit.changed, false)
    assert.match(credit.error ?? "", /parse errors/)
  })
})

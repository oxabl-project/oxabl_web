import { readFile, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseToml } from "smol-toml"

const EXPECTED = {
  reservedRows: 439,
  reservedMultiWordRows: 69,
  traversedJsonEntries: 2249,
  typedJsonOccurrences: 1855,
  finalTypedJsonNames: 1765,
  enrichedWithAbbreviations: 78,
  enrichedWithTypeInfo: 192,
  enrichedCallableFunctions: 54,
  declaredAdditions: 131,
  effectiveAdditions: 126,
  declaredOverrides: 3,
  effectiveOverrides: 3,
  declaredRemovals: 4,
  effectiveRemovals: 3,
  total: 562,
  reserved: 461,
  withAbbreviations: 88,
  withTypeInfo: 318,
  callableFunctions: 54,
  reservedMultiWordFinal: 69,
}

const TYPE_SUFFIXES = [
  [" function", "Function"],
  [" statement", "Statement"],
  [" method", "Method"],
  [" property", "Property"],
  [" attribute", "Attribute"],
  [" event", "Event"],
  [" option", "Option"],
  [" phrase", "Phrase"],
  [" widget", "Widget"],
  [" type", "Type"],
  [" operator", "Operator"],
  [" system handle", "Handle"],
  [" handle", "Handle"],
  [" preprocessor directive", "Preprocessor"],
  [" preprocessor", "Preprocessor"],
]

const KNOWN_TYPES = new Map(
  [
    "Function",
    "Statement",
    "Method",
    "Property",
    "Attribute",
    "Event",
    "Option",
    "Phrase",
    "Widget",
    "Type",
    "Operator",
    "Handle",
    "System",
    "Preprocessor",
  ].map((type) => [type.toLowerCase(), type])
)

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, derived ${actual}`)
  }
}

function asciiSort(values) {
  return values.sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  )
}

function parseReservedKeywords(source) {
  const lines = source.split(/\r?\n/).slice(1)
  const keywords = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line === "") continue

    const separator = line.search(/ {2,}/)
    const name = (separator === -1 ? line : line.slice(0, separator)).trim()
    const abbreviation = separator === -1 ? "" : line.slice(separator).trim()

    if (name !== "") {
      keywords.push({
        name,
        reserved: true,
        minAbbreviation: abbreviation || null,
        keywordType: null,
        docUrl: null,
      })
    }
  }

  const names = keywords.map(({ name }) => name.toUpperCase())
  assertEqual("reserved source rows", keywords.length, EXPECTED.reservedRows)
  assertEqual("unique reserved source rows", new Set(names).size, names.length)
  assertEqual(
    "multi-word reserved source rows",
    names.filter((name) => name.includes(" ")).length,
    EXPECTED.reservedMultiWordRows
  )

  return keywords
}

function parseKeywordIndex(source) {
  const roots = JSON.parse(source)
  const keywordInfo = new Map()
  let traversedEntries = 0
  let typedOccurrences = 0

  function walk(entries) {
    for (const entry of entries) {
      traversedEntries += 1
      const title = entry.title.trim()

      for (const [suffix, keywordType] of TYPE_SUFFIXES) {
        if (!title.endsWith(suffix)) continue

        const name = title.slice(0, -suffix.length).toUpperCase()
        keywordInfo.set(name, { keywordType, docUrl: entry.url })
        typedOccurrences += 1
        break
      }

      walk(entry.childEntries)
    }
  }

  walk(roots)
  assertEqual(
    "traversed JSON entries",
    traversedEntries,
    EXPECTED.traversedJsonEntries
  )
  assertEqual(
    "typed JSON occurrences",
    typedOccurrences,
    EXPECTED.typedJsonOccurrences
  )
  assertEqual(
    "final typed JSON names",
    keywordInfo.size,
    EXPECTED.finalTypedJsonNames
  )

  return { keywordInfo, traversedEntries, typedOccurrences }
}

function enrichKeywords(keywords, keywordInfo) {
  return keywords.map((keyword) => {
    const typeInfo = keywordInfo.get(keyword.name.toUpperCase())
    return typeInfo === undefined ? keyword : { ...keyword, ...typeInfo }
  })
}

function keywordTypeFromString(value) {
  return KNOWN_TYPES.get(value.toLowerCase()) ?? value
}

function applyOverrides(keywords, overrides) {
  const keywordMap = new Map(
    keywords.map((keyword, index) => [keyword.name.toUpperCase(), index])
  )
  let effectiveRemovals = 0
  let effectiveOverrides = 0
  let effectiveAdditions = 0

  for (const removal of overrides.remove ?? []) {
    const index = keywordMap.get(removal.name.toUpperCase())
    if (index === undefined) continue

    keywords[index].name = ""
    effectiveRemovals += 1
  }

  for (const override of overrides.override ?? []) {
    const index = keywordMap.get(override.name.toUpperCase())
    if (index === undefined) continue

    const keyword = keywords[index]
    if (Object.hasOwn(override, "reserved")) {
      keyword.reserved = override.reserved
    }
    if (Object.hasOwn(override, "keyword_type")) {
      keyword.keywordType = keywordTypeFromString(override.keyword_type)
    }
    if (Object.hasOwn(override, "min_abbreviation")) {
      keyword.minAbbreviation = override.min_abbreviation || null
    }
    if (Object.hasOwn(override, "doc_url")) {
      keyword.docUrl = override.doc_url
    }
    effectiveOverrides += 1
  }

  for (const addition of overrides.add ?? []) {
    const nameUpper = addition.name.toUpperCase()
    if (keywordMap.has(nameUpper)) continue

    keywordMap.set(nameUpper, keywords.length)
    keywords.push({
      name: addition.name,
      reserved: addition.reserved ?? false,
      minAbbreviation: addition.min_abbreviation || null,
      keywordType: addition.keyword_type
        ? keywordTypeFromString(addition.keyword_type)
        : null,
      docUrl: addition.doc_url ?? null,
    })
    effectiveAdditions += 1
  }

  const records = keywords.filter(({ name }) => name !== "")
  const stats = {
    declaredAdditions: overrides.add?.length ?? 0,
    effectiveAdditions,
    declaredOverrides: overrides.override?.length ?? 0,
    effectiveOverrides,
    declaredRemovals: overrides.remove?.length ?? 0,
    effectiveRemovals,
  }

  for (const [label, actual] of Object.entries(stats)) {
    assertEqual(label, actual, EXPECTED[label])
  }

  return { records, stats }
}

function countRecords(records) {
  return {
    total: records.length,
    reserved: records.filter(({ reserved }) => reserved).length,
    withAbbreviations: records.filter(
      ({ minAbbreviation }) => minAbbreviation !== null
    ).length,
    withTypeInfo: records.filter(({ keywordType }) => keywordType !== null)
      .length,
    callableFunctions: records.filter(
      ({ keywordType }) => keywordType === "Function"
    ).length,
  }
}

function validateCounts(counts) {
  for (const key of [
    "total",
    "reserved",
    "withAbbreviations",
    "withTypeInfo",
    "callableFunctions",
  ]) {
    assertEqual(key, counts[key], EXPECTED[key])
  }
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function compareVendored(path, expected) {
  let actual
  try {
    actual = await readFile(path, "utf8")
  } catch (error) {
    throw new Error(`cannot read vendored file ${path}: ${error.message}`)
  }

  if (actual !== expected) {
    throw new Error(`vendored file is stale: ${path}`)
  }
}

async function writeAtomically(outputs) {
  const nonce = `${process.pid}-${Date.now()}`
  const temporaryOutputs = outputs.map(({ path, content }) => ({
    path,
    content,
    temporaryPath: `${path}.${nonce}.tmp`,
  }))

  try {
    await Promise.all(
      temporaryOutputs.map(({ temporaryPath, content }) =>
        writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" })
      )
    )
    for (const { path, temporaryPath } of temporaryOutputs) {
      await rename(temporaryPath, path)
    }
  } finally {
    await Promise.all(
      temporaryOutputs.map(({ temporaryPath }) =>
        unlink(temporaryPath).catch(() => undefined)
      )
    )
  }
}

async function main() {
  const args = process.argv.slice(2).filter((argument) => argument !== "--")
  const check = args[0] === "--check"
  const workspaceArgument = check ? args[1] : args[0]

  if (!workspaceArgument || args.length !== (check ? 2 : 1)) {
    throw new Error("usage: generate-keyword-data.mjs [--check] /path/to/oxabl")
  }

  const workspace = resolve(workspaceArgument)
  const resources = join(workspace, "resources")
  const reservedPath = join(resources, "abl_reserved_keywords.txt")
  const indexPath = join(resources, "abl_keyword_index.json")
  const overridesPath = join(resources, "keyword_overrides.toml")

  const [reservedSource, indexSource, overridesSource] = await Promise.all([
    readFile(reservedPath, "utf8"),
    readFile(indexPath, "utf8"),
    readFile(overridesPath, "utf8"),
  ])

  const reservedKeywords = parseReservedKeywords(reservedSource)
  const { keywordInfo, traversedEntries, typedOccurrences } =
    parseKeywordIndex(indexSource)
  const enrichedKeywords = enrichKeywords(reservedKeywords, keywordInfo)
  const enrichedCounts = countRecords(enrichedKeywords)
  assertEqual(
    "enriched abbreviations",
    enrichedCounts.withAbbreviations,
    EXPECTED.enrichedWithAbbreviations
  )
  assertEqual(
    "enriched type info",
    enrichedCounts.withTypeInfo,
    EXPECTED.enrichedWithTypeInfo
  )
  assertEqual(
    "enriched callable functions",
    enrichedCounts.callableFunctions,
    EXPECTED.enrichedCallableFunctions
  )

  const overrides = parseToml(overridesSource)
  const { records, stats: overrideStats } = applyOverrides(
    enrichedKeywords,
    overrides
  )
  const counts = countRecords(records)
  validateCounts(counts)

  const keywords = asciiSort(
    records
      .filter(({ reserved }) => reserved)
      .map(({ name }) => name.toUpperCase())
  )
  assertEqual("reserved keyword list length", keywords.length, counts.reserved)
  assertEqual(
    "unique reserved keywords",
    new Set(keywords).size,
    keywords.length
  )
  assertEqual(
    "final multi-word reserved keywords",
    keywords.filter((name) => name.includes(" ")).length,
    EXPECTED.reservedMultiWordFinal
  )

  const keywordCounts = {
    ...counts,
    provenance: {
      reservedKeywords: "resources/abl_reserved_keywords.txt",
      keywordIndex: "resources/abl_keyword_index.json",
      overrides: "resources/keyword_overrides.toml",
      generator:
        "scripts/generate-keyword-data.mjs; oxabl_codegen-compatible reserved → enrich → remove → override → add pipeline",
    },
  }

  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const countsPath = join(projectRoot, "src/data/keyword-counts.json")
  const keywordsPath = join(projectRoot, "src/data/keywords.json")
  const countsOutput = serialize(keywordCounts)
  const keywordsOutput = serialize(keywords)

  if (check) {
    await Promise.all([
      compareVendored(countsPath, countsOutput),
      compareVendored(keywordsPath, keywordsOutput),
    ])
  } else {
    await writeAtomically([
      { path: countsPath, content: countsOutput },
      { path: keywordsPath, content: keywordsOutput },
    ])
  }

  console.log(
    [
      `${check ? "checked" : "generated"}: ${counts.total} total`,
      `${counts.reserved} reserved`,
      `${counts.withAbbreviations} with abbreviations`,
      `${counts.withTypeInfo} with type info`,
      `${counts.callableFunctions} callable functions`,
    ].join(" · ")
  )
  console.log(
    `sources: ${reservedKeywords.length} reserved rows · ${traversedEntries} JSON entries · ${typedOccurrences} typed occurrences · ${keywordInfo.size} typed names`
  )
  console.log(
    `overrides: ${overrideStats.effectiveRemovals}/${overrideStats.declaredRemovals} removed · ${overrideStats.effectiveOverrides}/${overrideStats.declaredOverrides} modified · ${overrideStats.effectiveAdditions}/${overrideStats.declaredAdditions} added`
  )
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})

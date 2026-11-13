// Black-box check of what search engines and link previews read.
//   node scripts/check-seo.mjs          the built site in dist/ (after `pnpm build`)
//   node scripts/check-seo.mjs --live   what https://oxabl.org serves (after a deploy)
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const dist = join(root, "dist")
const site = "https://oxabl.org"
const live = process.argv.includes("--live")
// Fetch from elsewhere (a local server of dist/) while expecting the real URLs.
const base = process.env.OXABL_SEO_BASE ?? site
const failures = []
const check = (ok, what) => {
  if (!ok) failures.push(what)
}

// One reader for both modes: { status, type, headers, bytes, text } or null.
async function get(path) {
  if (live) {
    try {
      const res = await fetch(new URL(path, base), {
        redirect: "manual",
        headers: { "user-agent": "oxabl-seo-check (+https://oxabl.org)" },
      })
      const bytes = Buffer.from(await res.arrayBuffer())
      return {
        status: res.status,
        type: res.headers.get("content-type") ?? "",
        headers: res.headers,
        bytes,
        text: bytes.toString("utf8"),
      }
    } catch {
      return null
    }
  }
  const file = join(dist, path === "/" ? "index.html" : path.replace(/^\//, ""))
  if (!existsSync(file)) return null
  const bytes = readFileSync(file)
  return {
    status: 200,
    type: "",
    headers: new Headers(),
    bytes,
    text: bytes.toString("utf8"),
  }
}

if (live) {
  // Wait until the edge serves this build (the home page and the card equal
  // dist/), so a stale edge neither fails a good deploy nor hides a bad one.
  const local = (file) => readFileSync(join(dist, file))
  const deadline = Date.now() + 180_000
  let current = false
  while (!current) {
    const [home, card] = await Promise.all([get("/"), get("/og.png")])
    current =
      home?.status === 200 &&
      card?.status === 200 &&
      home.bytes.equals(local("index.html")) &&
      card.bytes.equals(local("og.png"))
    if (current) break
    if (Date.now() > deadline) {
      console.error(
        "SEO check failed (live): the deploy is not serving this build after 180 s"
      )
      process.exit(1)
    }
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
}

const metaTags = (html) =>
  [...html.matchAll(/<meta\s[^>]*>/gi)].map((m) => m[0])
const attr = (tag, name) =>
  new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
    .exec(tag)
    ?.slice(1)
    .find((v) => v !== undefined) ?? null
const metaContent = (html, key, value) =>
  metaTags(html)
    .filter((tag) => attr(tag, key)?.toLowerCase() === value.toLowerCase())
    .map((tag) => attr(tag, "content") ?? "")
const robotsMetas = (html) =>
  ["robots", "googlebot", "bingbot"].flatMap((name) =>
    metaContent(html, "name", name)
  )
const blocksIndexing = (value) => /noindex|none/i.test(value)

const home = await get("/")
check(home?.status === 200, "/ is served with status 200")
if (home) {
  const html = home.text
  const canonicals = [...html.matchAll(/<link\s[^>]*rel="canonical"[^>]*>/g)]
  check(
    canonicals.length === 1 && attr(canonicals[0][0], "href") === `${site}/`,
    "home has exactly one canonical, https://oxabl.org/"
  )
  check(/<title>[^<]{10,}<\/title>/.test(html), "home has a title")
  const descriptions = metaContent(html, "name", "description")
  check(
    descriptions.length === 1 && descriptions[0].length >= 50,
    "home has one description of 50+ characters"
  )
  for (const [key, value, expected] of [
    ["property", "og:url", `${site}/`],
    ["property", "og:image", `${site}/og.png`],
    ["name", "twitter:image", `${site}/og.png`],
    ["name", "twitter:card", "summary_large_image"],
  ]) {
    check(
      metaContent(html, key, value)[0] === expected,
      `${value} is ${expected}`
    )
  }
  for (const [key, value] of [
    ["property", "og:title"],
    ["property", "og:description"],
    ["name", "twitter:title"],
    ["name", "twitter:description"],
  ]) {
    check(
      (metaContent(html, key, value)[0] ?? "").length > 0,
      `${value} is set`
    )
  }
  check(
    !robotsMetas(html).some(blocksIndexing),
    "home has no noindex robots meta"
  )
  check(
    !blocksIndexing(home.headers.get("x-robots-tag") ?? ""),
    "/ has no noindex X-Robots-Tag header"
  )

  const blocks = [
    ...html.matchAll(
      /<script\s[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g
    ),
  ]
  check(blocks.length > 0, "home has JSON-LD")
  const types = []
  for (const block of blocks) {
    try {
      const data = JSON.parse(block[1])
      for (const node of data["@graph"] ?? [data]) types.push(node["@type"])
    } catch {
      check(false, "every JSON-LD block parses")
    }
  }
  for (const type of ["WebSite", "SoftwareApplication", "SoftwareSourceCode"]) {
    check(types.includes(type), `JSON-LD declares a ${type}`)
  }
}

const og = await get("/og.png")
check(og?.status === 200, "/og.png is served")
if (og) {
  const png = og.bytes
  check(
    png.length > 1000 &&
      png.subarray(1, 4).toString() === "PNG" &&
      png.readUInt32BE(16) === 1200 &&
      png.readUInt32BE(20) === 630 &&
      png.subarray(-12, -8).readUInt32BE(0) === 0 &&
      png.subarray(-8, -4).toString() === "IEND",
    "og.png is a complete 1200x630 PNG"
  )
  if (live) check(og.type.startsWith("image/png"), "/og.png is image/png")
}

const robots = await get("/robots.txt")
check(robots?.status === 200, "/robots.txt is served")
if (robots) {
  if (live)
    check(robots.type.startsWith("text/plain"), "/robots.txt is text/plain")
  check(
    robots.text.includes(`Sitemap: ${site}/sitemap-index.xml`),
    "robots.txt points to the sitemap"
  )
  // A group naming * or a search engine that disallows every path, however spelled.
  const searchAgents = ["*", "googlebot", "bingbot"]
  let agents = []
  let inRules = false
  for (const raw of robots.text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim()
    const [field, ...rest] = line.split(":")
    const name = field.trim().toLowerCase()
    const value = rest.join(":").trim()
    if (name === "user-agent") {
      if (inRules) agents = []
      agents.push(value.toLowerCase())
      inRules = false
    } else if (name) {
      inRules = true
      if (
        name === "disallow" &&
        agents.some((a) => searchAgents.includes(a)) &&
        /^\/(\*+\$?)?$/.test(value)
      )
        check(false, "robots.txt does not disallow the whole site")
    }
  }
}

const index = await get("/sitemap-index.xml")
check(
  index?.status === 200 && index.text.includes("sitemap-0.xml"),
  "sitemap-index.xml lists sitemap-0.xml"
)
const map = await get("/sitemap-0.xml")
check(
  map?.status === 200 && map.text.includes(`<loc>${site}/</loc>`),
  "sitemap-0.xml lists the home page"
)
check(!/<loc>[^<]*404/.test(map?.text ?? ""), "sitemap omits the 404")
if (!live && map) {
  for (const [, loc] of map.text.matchAll(/<loc>([^<]*)<\/loc>/g)) {
    const path = new URL(loc).pathname
    check(
      existsSync(join(dist, path, path.endsWith("/") ? "index.html" : "")),
      `sitemap page ${loc} is built`
    )
  }
}

// Cloudflare serves the 404.html asset at /404 with status 200, so the page
// itself must stay out of the index.
const notFound = await get(live ? "/404" : "/404.html")
check(notFound !== null, "the 404 page exists")
if (notFound) {
  check(
    metaContent(notFound.text, "name", "robots").some(blocksIndexing),
    "the 404 page has a noindex robots meta"
  )
  check(!/rel="canonical"/.test(notFound.text), "the 404 page has no canonical")
  check(!/ld\+json/.test(notFound.text), "the 404 page has no JSON-LD")
}

if (live) {
  const unknown = await get(`/no-such-page-${Date.now()}`)
  check(
    unknown?.status === 404,
    "an unknown path answers 404, not the home page"
  )
} else {
  // Headers and redirects change what crawlers see without touching the HTML.
  for (const file of ["_headers", "_redirects"]) {
    check(
      !existsSync(join(dist, file)),
      `dist/${file} is absent (this check does not read it)`
    )
  }
  let wrangler = null
  try {
    // Strip whole-line // comments (not the URL in "$schema") and block comments.
    wrangler = JSON.parse(
      readFileSync(join(root, "wrangler.jsonc"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
    )
  } catch {
    check(false, "wrangler.jsonc parses (whole-line comments only)")
  }
  if (wrangler)
    check(
      wrangler.assets?.not_found_handling === "404-page",
      "wrangler.jsonc serves 404.html for unknown paths"
    )
}

if (failures.length > 0) {
  console.error(
    `SEO check failed (${live ? "live" : "dist"}):\n${failures.map((f) => `  - ${f}`).join("\n")}`
  )
  process.exit(1)
}
console.log(`SEO check passed (${live ? "live" : "dist"})`)

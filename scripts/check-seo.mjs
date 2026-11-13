// Black-box check of what search engines and link previews read.
//   node scripts/check-seo.mjs          the built site in dist/ (after `pnpm build`)
//   node scripts/check-seo.mjs --live   what https://oxabl.org serves (after a deploy)
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const dist = join(root, "dist")
const site = "https://oxabl.org"
const live = process.argv.includes("--live")
const failures = []
const check = (ok, what) => {
  if (!ok) failures.push(what)
}

// One reader for both modes: { status, type, body } or null when absent.
async function get(path) {
  if (live) {
    try {
      const res = await fetch(new URL(path, site), { redirect: "manual" })
      const binary = (res.headers.get("content-type") ?? "").startsWith(
        "image/"
      )
      return {
        status: res.status,
        type: res.headers.get("content-type") ?? "",
        body: binary ? Buffer.from(await res.arrayBuffer()) : await res.text(),
      }
    } catch {
      return null
    }
  }
  const file = join(dist, path === "/" ? "index.html" : path.replace(/^\//, ""))
  if (!existsSync(file)) return null
  const body = path.endsWith(".png")
    ? readFileSync(file)
    : readFileSync(file, "utf8")
  return { status: 200, type: "", body }
}

const metaTags = (html) => [...html.matchAll(/<meta\s[^>]*>/g)].map((m) => m[0])
const attr = (tag, name) =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null
const metaContent = (html, key, value) =>
  metaTags(html)
    .filter((tag) => attr(tag, key) === value)
    .map((tag) => attr(tag, "content"))

const home = await get("/")
check(home?.status === 200, "/ is served with status 200")
if (home && typeof home.body === "string") {
  const html = home.body
  const canonicals = [...html.matchAll(/<link\s[^>]*rel="canonical"[^>]*>/g)]
  check(
    canonicals.length === 1 && attr(canonicals[0][0], "href") === `${site}/`,
    "home has exactly one canonical, https://oxabl.org/"
  )
  check(/<title>[^<]{10,}<\/title>/.test(html), "home has a title")
  check(
    (metaContent(html, "name", "description")[0] ?? "").length >= 50,
    "home has a description of 50+ characters"
  )
  check(
    metaContent(html, "property", "og:url")[0] === `${site}/`,
    "og:url is https://oxabl.org/"
  )
  check(
    metaContent(html, "property", "og:image")[0] === `${site}/og.png`,
    "og:image is https://oxabl.org/og.png"
  )
  check(
    metaContent(html, "name", "twitter:image")[0] === `${site}/og.png`,
    "twitter:image is https://oxabl.org/og.png"
  )
  check(
    metaContent(html, "name", "twitter:card")[0] === "summary_large_image",
    "twitter:card is summary_large_image"
  )
  check(
    !metaContent(html, "name", "robots").some((c) =>
      /noindex|none/i.test(c ?? "")
    ),
    "home has no noindex robots meta"
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
  for (const type of ["WebSite", "SoftwareApplication"]) {
    check(types.includes(type), `JSON-LD declares a ${type}`)
  }
}

const og = await get("/og.png")
check(og !== null && og.status === 200, "/og.png is served")
if (og && Buffer.isBuffer(og.body)) {
  const png = og.body
  check(
    png.length > 8 &&
      png.subarray(1, 4).toString() === "PNG" &&
      png.readUInt32BE(16) === 1200 &&
      png.readUInt32BE(20) === 630,
    "og.png is a 1200x630 PNG"
  )
  if (live) check(og.type.startsWith("image/png"), "/og.png is image/png")
}

const robots = await get("/robots.txt")
check(robots?.status === 200, "/robots.txt is served")
if (robots && typeof robots.body === "string") {
  if (live)
    check(robots.type.startsWith("text/plain"), "/robots.txt is text/plain")
  check(
    robots.body.includes(`Sitemap: ${site}/sitemap-index.xml`),
    "robots.txt points to the sitemap"
  )
  // Any group for * (or every agent) that disallows the root, however spelled.
  let agents = []
  let inRules = false
  for (const raw of robots.body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim()
    const [field, ...rest] = line.split(":")
    const value = rest.join(":").trim()
    if (/^user-agent$/i.test(field)) {
      if (inRules) agents = []
      agents.push(value)
      inRules = false
    } else if (field) {
      inRules = true
      if (
        /^disallow$/i.test(field) &&
        agents.includes("*") &&
        /^\/\*?$/.test(value)
      )
        check(false, "robots.txt does not disallow the whole site")
    }
  }
}

const index = await get("/sitemap-index.xml")
check(
  index?.status === 200 && String(index.body).includes("sitemap-0.xml"),
  "sitemap-index.xml lists sitemap-0.xml"
)
const map = await get("/sitemap-0.xml")
check(
  map?.status === 200 && String(map.body).includes(`<loc>${site}/</loc>`),
  "sitemap-0.xml lists the home page"
)
check(!/<loc>[^<]*404/.test(String(map?.body ?? "")), "sitemap omits the 404")

// Cloudflare serves the 404.html asset at /404 with status 200, so the page
// itself must stay out of the index.
const notFound = await get("/404")
const notFoundHtml = await get(live ? "/404" : "/404.html")
check(live ? notFound !== null : notFoundHtml !== null, "the 404 page exists")
if (notFoundHtml && typeof notFoundHtml.body === "string") {
  check(
    metaContent(notFoundHtml.body, "name", "robots").some((c) =>
      /noindex/i.test(c ?? "")
    ),
    "the 404 page has a noindex robots meta"
  )
  check(
    !/rel="canonical"/.test(notFoundHtml.body),
    "the 404 page has no canonical"
  )
}

if (live) {
  const unknown = await get(`/no-such-page-${Date.now()}`)
  check(
    unknown?.status === 404,
    "an unknown path answers 404, not the home page"
  )
} else {
  // Strip whole-line // comments (not the URL in "$schema") and block comments.
  const wrangler = JSON.parse(
    readFileSync(join(root, "wrangler.jsonc"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
  )
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

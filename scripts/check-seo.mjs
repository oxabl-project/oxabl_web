// Black-box check of the built site (run after `pnpm build`): the files and
// tags that search engines and link previews read must exist in dist/.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const dist = join(import.meta.dirname, "..", "dist")
const site = "https://oxabl.org"
const failures = []
const check = (ok, what) => {
  if (!ok) failures.push(what)
}
const read = (file) =>
  existsSync(join(dist, file)) ? readFileSync(join(dist, file), "utf8") : null

const home = read("index.html")
check(home !== null, "dist/index.html exists")
if (home) {
  check(
    home.includes(`<link rel="canonical" href="${site}/"`),
    "home has canonical https://oxabl.org/"
  )
  check(/<title>[^<]+<\/title>/.test(home), "home has a title")
  check(
    /<meta name="description" content="[^"]{50,}"/.test(home),
    "home has a description"
  )
  for (const tag of [
    'property="og:image" content="https://oxabl.org/og.png"',
    'property="og:url"',
    'name="twitter:card" content="summary_large_image"',
    'name="twitter:image"',
  ]) {
    check(home.includes(tag), `home has ${tag}`)
  }
  check(!/noindex/i.test(home), "home is not noindex")
  const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(
    home
  )
  check(ld !== null, "home has JSON-LD")
  if (ld) {
    try {
      JSON.parse(ld[1])
    } catch {
      check(false, "home JSON-LD parses")
    }
  }
}

const og = join(dist, "og.png")
check(existsSync(og), "dist/og.png exists")
if (existsSync(og)) {
  const png = readFileSync(og)
  check(
    png.subarray(1, 4).toString() === "PNG" &&
      png.readUInt32BE(16) === 1200 &&
      png.readUInt32BE(20) === 630,
    "og.png is a 1200x630 PNG"
  )
}

const robots = read("robots.txt")
check(
  robots?.includes(`Sitemap: ${site}/sitemap-index.xml`) ?? false,
  "robots.txt points to the sitemap"
)
check(
  !/Disallow:\s*\/\s*$/m.test(robots ?? ""),
  "robots.txt does not block the site"
)

check(
  read("sitemap-index.xml")?.includes("sitemap-0.xml") ?? false,
  "sitemap-index.xml lists sitemap-0.xml"
)
check(
  read("sitemap-0.xml")?.includes(`<loc>${site}/</loc>`) ?? false,
  "sitemap-0.xml lists the home page"
)
check(
  !(read("sitemap-0.xml")?.includes("404") ?? false),
  "sitemap-0.xml omits the 404 page"
)
check(read("404.html") !== null, "dist/404.html exists")

const wrangler = readFileSync(join(dist, "..", "wrangler.jsonc"), "utf8")
check(
  /"not_found_handling":\s*"404-page"/.test(wrangler),
  "wrangler.jsonc serves 404.html for unknown paths"
)

if (failures.length > 0) {
  console.error(
    `SEO check failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`
  )
  process.exit(1)
}
console.log("SEO check passed")

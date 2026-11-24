// global.css imports Tailwind's utilities with `source(none)`, so a class is
// generated only if its file has an `@source` line. A missing line fails
// silently: the class is dropped and the layout breaks. This fails instead.
import { readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const cssPath = join(root, "src/styles/global.css")
const css = readFileSync(cssPath, "utf8")
const listed = new Set(
  [...css.matchAll(/@source\s+"([^"]+)"/g)].map((m) =>
    relative(root, resolve(join(root, "src/styles"), m[1]))
  )
)

const walk = (dir) =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  )

const missing = ["src/components", "src/pages", "src/layouts"]
  .flatMap(walk)
  .filter((file) => /\.(astro|tsx)$/.test(file))
  .filter((file) =>
    /\bclass(Name)?=/.test(readFileSync(join(root, file), "utf8"))
  )
  .filter((file) => !listed.has(file))

if (missing.length > 0) {
  console.error(
    `Files with classes but no @source line in src/styles/global.css:\n${missing.map((f) => `  ${f}`).join("\n")}`
  )
  process.exit(1)
}
console.log(`Tailwind sources check passed (${listed.size} sources)`)

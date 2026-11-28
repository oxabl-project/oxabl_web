/**
 * The playground's virtual project: five files, shown in this order in the
 * file rail. `scripts/check-example-project.mjs` runs the same files through
 * the vendored engine and asserts the findings the playground promises.
 */

import type { ProjectOpenRequest } from "@/lib/oxablClient"
import config from "./oxabl.toml?raw"
import orderTotals from "./inc/order-totals.i?raw"
import orderFulfillment from "./src/order-fulfillment.p?raw"
import creditCheck from "./src/credit-check.p?raw"
import sp2k from "./sp2k.df?raw"

export type PlaygroundLanguage = "abl" | "toml" | "abl-df"

export type PlaygroundFile = {
  path: string
  language: PlaygroundLanguage
  text: string
}

export const CONFIG_PATH = "oxabl.toml"
export const DEFAULT_FILE = "src/order-fulfillment.p"

export const DEFAULT_PROJECT: readonly PlaygroundFile[] = [
  { path: CONFIG_PATH, language: "toml", text: config },
  { path: "src/order-fulfillment.p", language: "abl", text: orderFulfillment },
  { path: "src/credit-check.p", language: "abl", text: creditCheck },
  { path: "inc/order-totals.i", language: "abl", text: orderTotals },
  { path: "schema/sp2k.df", language: "abl-df", text: sp2k },
]

/** Folder headings above the file names in the rail. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash === -1 ? "" : path.slice(0, slash)
}

/**
 * The `project_open` payload for the given file texts. `oxabl.toml` and the
 * `.df` schema have their own slots; everything else is a source file.
 */
export function openRequest(
  texts: ReadonlyMap<string, string>
): ProjectOpenRequest {
  const files: Record<string, string> = {}
  const schemas: Record<string, string> = {}
  let configText: string | undefined
  for (const [path, text] of texts) {
    if (path === CONFIG_PATH) configText = text
    else if (path.endsWith(".df")) schemas[path] = text
    else files[path] = text
  }
  const request: ProjectOpenRequest = { files, schemas }
  if (configText !== undefined) request.config = configText
  return request
}

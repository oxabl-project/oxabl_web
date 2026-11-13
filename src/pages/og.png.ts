import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import type { APIRoute } from "astro"
import { Resvg } from "@resvg/resvg-js"
import satori from "satori"
import favicon from "../../public/favicon.svg?raw"
import { OG_IMAGE_SIZE } from "@/lib/seo"

// Satori reads static TTF/OTF/WOFF only, so the card takes the fontsource
// `.woff` files rather than the variable `.woff2` files the page loads.
const require = createRequire(import.meta.url)
const font = (pkg: string, file: string) =>
  readFileSync(require.resolve(`${pkg}/files/${file}`))

// DESIGN.md tokens (global.css) as sRGB: satori cannot read oklch().
const color = {
  paper: "#fbfaf9",
  ink: "#171613",
  ruleStrong: "#a6a4a1",
  screen: "#0a0f0b",
}

// public/favicon.svg, in the icon's own green (DESIGN.md, "The icon").
const markSrc = `data:image/svg+xml;base64,${Buffer.from(favicon).toString("base64")}`

const h = (
  type: string,
  style: Record<string, string | number>,
  children?: unknown
) => ({ type, props: { style: { display: "flex", ...style }, children } })

const card = h(
  "div",
  {
    width: "100%",
    height: "100%",
    background: color.paper,
  },
  h(
    "div",
    {
      margin: 48,
      width: OG_IMAGE_SIZE.width - 96,
      height: OG_IMAGE_SIZE.height - 96,
      border: `1px solid ${color.ruleStrong}`,
    },
    [
      h(
        "div",
        {
          width: OG_IMAGE_SIZE.width - 96 - 340,
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 48,
        },
        [
          h(
            "div",
            {
              fontFamily: "Michroma",
              fontSize: 48,
              color: color.ink,
            },
            "oxabl"
          ),
          h(
            "div",
            {
              fontFamily: "IBM Plex Sans",
              fontWeight: 500,
              fontSize: 64,
              lineHeight: "72px",
              letterSpacing: "-0.02em",
              color: color.ink,
              maxWidth: 600,
            },
            "ABL developers deserve modern toolchains."
          ),
        ]
      ),
      h(
        "div",
        {
          width: 340,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          background: color.screen,
        },
        {
          type: "img",
          props: { src: markSrc, width: 260, height: 260 },
        }
      ),
    ]
  )
)

export const GET: APIRoute = async () => {
  const svg = await satori(card as never, {
    ...OG_IMAGE_SIZE,
    fonts: [
      {
        name: "Michroma",
        data: font("@fontsource/michroma", "michroma-latin-400-normal.woff"),
        weight: 400,
      },
      {
        name: "IBM Plex Sans",
        data: font(
          "@fontsource/ibm-plex-sans",
          "ibm-plex-sans-latin-500-normal.woff"
        ),
        weight: 500,
      },
    ],
  })
  const png = new Resvg(svg).render().asPng()
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png" },
  })
}

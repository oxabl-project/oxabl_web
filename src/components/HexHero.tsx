import * as React from "react"
import {
  createHexFloat,
  supportsWebGL2,
  type HexFloatInstance,
  type HexFloatOptions,
} from "@/components/hex/hexFloat"

// Config mirrors the docs demo, tuned for a decorative backdrop: no bobbing
// (float 0) and no post passes, so the render loop idles to zero cost whenever
// the cursor is still — only waking for the reading-window ripple on hover.
const HERO_CONFIG: HexFloatOptions = {
  size: 160,
  gap: 0,
  bevel: 1.5,
  tilt: 24,
  perspective: 0.5,
  float: 0,
  speed: 1,
  shine: 1,
  lift: 0.1,
  radius: 300,
  flow: 0,
  swirl: 0,
  trail: 0,
  iridescence: 0.35,
}

// Balanced perf guard: below this sustained FPS during the warm-up probe we
// tear the canvas down and hand back to the static CSS grid.
const MIN_FPS = 40
// Below this viewport width we don't even try — small mobile GPUs aren't worth
// the risk, and the CSS grid reads fine there.
const MIN_VIEWPORT = 768

// Cheap, static gates decided once client-side: reduced-motion, viewport, and
// WebGL2 support. Cached so the store snapshot stays referentially stable
// (React may read it several times per render) and we never build throwaway
// probe contexts more than once.
let gateResult: boolean | undefined
function canAttempt(): boolean {
  if (gateResult === undefined) {
    gateResult =
      typeof window !== "undefined" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      window.innerWidth >= MIN_VIEWPORT &&
      supportsWebGL2()
  }
  return gateResult
}

const emptySubscribe = () => () => {}

/**
 * Decorative WebGL2 hex-floor backdrop for the hero. Renders nothing (leaving
 * the server-rendered `.hero-grid` CSS wash visible) unless the device clears
 * every gate: WebGL2 present, no reduced-motion preference, a wide-enough
 * viewport, and a passing FPS probe. When it goes active it sets
 * `data-hex-active` on <html> so CSS can fade the static grid out.
 */
export function HexHero() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  // false during SSR and if any static gate fails; true only client-side on a
  // capable device. useSyncExternalStore keeps this SSR-safe (server always
  // sees false, so no canvas is emitted and there's no hydration mismatch).
  const mount = React.useSyncExternalStore(
    emptySubscribe,
    canAttempt,
    () => false
  )

  React.useEffect(() => {
    if (!mount) return
    const canvas = canvasRef.current
    if (!canvas) return

    let instance: HexFloatInstance | null = null
    let cancelled = false

    const activate = () =>
      document.documentElement.setAttribute("data-hex-active", "")
    const deactivate = () =>
      document.documentElement.removeAttribute("data-hex-active")

    instance = createHexFloat(canvas, HERO_CONFIG, {
      probeMs: 1000,
      onProbe: (fps) => {
        if (cancelled) return
        if (fps < MIN_FPS) {
          // Too slow — reveal the CSS grid and drop the canvas entirely.
          deactivate()
          instance?.destroy()
          instance = null
          canvas.style.display = "none"
        }
      },
    })

    if (!instance) return

    // Optimistically fade the CSS grid while the effect proves itself; the
    // probe reverts this within ~1s if the device can't keep up.
    activate()

    return () => {
      cancelled = true
      deactivate()
      instance?.destroy()
    }
  }, [mount])

  if (!mount) return null

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
    />
  )
}

export default HexHero

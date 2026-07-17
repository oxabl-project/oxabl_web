import * as React from "react"

export function HoverGlow({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [glow, setGlow] = React.useState<{ x: number; y: number } | null>(null)

  const handleMouseMove = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!ref.current) return
      const rect = ref.current.getBoundingClientRect()
      setGlow({
        x: ((e.clientX - rect.left) / rect.width) * 100,
        y: ((e.clientY - rect.top) / rect.height) * 100,
      })
    },
    []
  )

  return (
    <div
      ref={ref}
      className="group/glow relative"
      onMouseMove={handleMouseMove}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-4xl opacity-0 transition-opacity duration-300 group-hover/glow:opacity-100"
        style={
          glow
            ? {
                background: `radial-gradient(circle 240px at ${glow.x}% ${glow.y}%, oklch(0.72 0.14 150 / 0.22), transparent 70%)`,
              }
            : undefined
        }
      />
      {children}
    </div>
  )
}

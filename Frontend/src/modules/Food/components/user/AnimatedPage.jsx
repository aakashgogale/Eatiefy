// CSS-only AnimatedPage - no GSAP dependency
import { useEffect, useRef } from "react"

export default function AnimatedPage({ children, className = "", instant = false }) {
  const containerRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (instant) {
      container.style.opacity = "1"
      container.style.transform = ""
      container.style.transition = ""
      return
    }

    // Keep entrance animation lightweight and remove transform afterwards.
    // Persistent transform breaks descendants that use position: fixed.
    container.style.opacity = '0'
    container.style.transition = 'opacity 120ms ease, transform 120ms ease'
    container.style.transform = 'translateY(8px)'

    // Trigger animation on next frame
    requestAnimationFrame(() => {
      container.style.opacity = '1'
      container.style.transform = 'translateY(0)'
    })

    const cleanupTimer = window.setTimeout(() => {
      container.style.transform = ''
      container.style.transition = ''
    }, 140)

    return () => {
      window.clearTimeout(cleanupTimer)
    }
  }, [instant])

  return (
    <div ref={containerRef} className={`${className}  md:pb-0`}>
      {children}
    </div>
  )
}

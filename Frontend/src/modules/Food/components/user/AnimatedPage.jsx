// CSS-only AnimatedPage - no GSAP dependency
import { useEffect, useRef } from "react"

export default function AnimatedPage({ children, className = "" }) {
  const containerRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Lightweight entrance transition using Apple-standard cubic-bezier
    container.style.opacity = '0'
    container.style.willChange = 'opacity, transform'
    container.style.transition = 'opacity 240ms cubic-bezier(0.16, 1, 0.3, 1), transform 240ms cubic-bezier(0.16, 1, 0.3, 1)'
    container.style.transform = 'translateY(12px)'

    // Trigger animation on next frame
    requestAnimationFrame(() => {
      container.style.opacity = '1'
      container.style.transform = 'translateY(0)'
    })

    const cleanupTimer = window.setTimeout(() => {
      container.style.transform = ''
      container.style.transition = ''
      container.style.willChange = ''
    }, 280)

    return () => {
      window.clearTimeout(cleanupTimer)
    }
  }, [])

  return (
    <div ref={containerRef} className={`${className}  md:pb-0`}>
      {children}
    </div>
  )
}

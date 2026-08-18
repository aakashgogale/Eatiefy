import { ArrowUp } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { useState, useEffect, useRef, useCallback } from "react"

export default function BackToTop() {
  const [show, setShow] = useState(false)

  // Use refs so the scroll handler always reads fresh values without re-registering
  const lastScrollYRef = useRef(0)
  const accumulatorRef = useRef(0)
  const isAutoScrollingRef = useRef(false)
  const pauseTimerRef = useRef(null)

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY

      // Near top → always hide and reset
      if (currentScrollY < 500) {
        setShow(false)
        isAutoScrollingRef.current = false
        accumulatorRef.current = 0
        lastScrollYRef.current = currentScrollY
        clearTimeout(pauseTimerRef.current)
        return
      }

      // Auto-scrolling in progress → skip all logic
      if (isAutoScrollingRef.current) {
        lastScrollYRef.current = currentScrollY
        return
      }

      const delta = lastScrollYRef.current - currentScrollY // positive = scrolling up

      if (currentScrollY > 2500) {
        if (delta > 0) {
          // Scrolling up — accumulate distance
          accumulatorRef.current += delta

          // DEBOUNCE: If user pauses scrolling for 200ms, reset the accumulator.
          // This aggressively prevents casual browsing from building up distance.
          clearTimeout(pauseTimerRef.current)
          pauseTimerRef.current = setTimeout(() => {
            accumulatorRef.current = 0
          }, 200)

          // Show ONLY after 600px of continuous, uninterrupted scroll-up.
          // No velocity shortcut — only sustained intent triggers this.
          if (accumulatorRef.current > 600) {
            setShow(true)
          }
        } else {
          // Scrolling down → reset accumulator and hide
          clearTimeout(pauseTimerRef.current)
          accumulatorRef.current = 0
          if (Math.abs(delta) > 10) {
            setShow(false)
          }
        }
      } else {
        setShow(false)
        accumulatorRef.current = 0
      }

      lastScrollYRef.current = currentScrollY
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", handleScroll)
      clearTimeout(pauseTimerRef.current)
    }
  }, []) // Empty deps — refs keep values fresh

  const scrollToTop = useCallback(() => {
    isAutoScrollingRef.current = true
    accumulatorRef.current = 0
    setShow(false)

    // Zomato-style "warped" scroll: zip up 1000px then snap to top
    const startY = window.scrollY
    const startTime = performance.now()
    const warpDistance = 1000
    const duration = 250

    const step = (currentTime) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      const easeOutQuad = progress * (2 - progress)
      const travel = warpDistance * easeOutQuad

      if (progress < 1) {
        window.scrollTo(0, startY - travel)
        requestAnimationFrame(step)
      } else {
        window.scrollTo(0, 0)
        setTimeout(() => {
          isAutoScrollingRef.current = false
        }, 50)
      }
    }

    requestAnimationFrame(step)
  }, [])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -40, scale: 0.8, x: "-50%" }}
          animate={{ opacity: 1, y: 0, scale: 1, x: "-50%" }}
          exit={{ opacity: 0, y: -20, scale: 0.8, x: "-50%" }}
          transition={{ 
            type: "spring",
            stiffness: 260,
            damping: 20,
            mass: 0.5
          }}
          className="fixed top-80 left-1/2 z-[60] pointer-events-auto"
        >
          <button
            onClick={scrollToTop}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-black/60 dark:bg-black/80 backdrop-blur-xl border border-white/20 rounded-full shadow-lg text-white font-medium text-[11px] group active:scale-95 transition-all"
          >
            <ArrowUp className="w-3.5 h-3.5 group-hover:-translate-y-0.5 transition-transform" strokeWidth={3} />
            <span>Back to top</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

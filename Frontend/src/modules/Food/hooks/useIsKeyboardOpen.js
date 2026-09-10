import { useState, useEffect, useRef } from "react"

/**
 * Hook to detect if a virtual keyboard is visible on mobile devices.
 * Uses Visual Viewport API and input focus tracking to reliably detect
 * mobile software keyboards (Android / iOS).
 */
export default function useIsKeyboardOpen(threshold = 100) {
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return

    let isFocusedOnInput = false

    const checkViewport = () => {
      if (window.visualViewport) {
        const heightDiff = window.innerHeight - window.visualViewport.height
        if (heightDiff > threshold) {
          setIsKeyboardOpen(true)
          return
        }
      }
      if (!isFocusedOnInput) {
        setIsKeyboardOpen(false)
      }
    }

    const handleFocusIn = (e) => {
      const target = e.target
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        const type = (target.type || "").toLowerCase()
        if (["checkbox", "radio", "submit", "button", "file", "image", "reset"].includes(type)) {
          return
        }

        isFocusedOnInput = true
        const isTouchOrMobile =
          window.innerWidth <= 1024 ||
          ("ontouchstart" in window) ||
          (navigator.maxTouchPoints > 0)

        if (isTouchOrMobile) {
          setIsKeyboardOpen(true)
        }
      }
    }

    const handleFocusOut = () => {
      isFocusedOnInput = false
      setTimeout(() => {
        checkViewport()
      }, 150)
    }

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", checkViewport)
      window.visualViewport.addEventListener("scroll", checkViewport)
    }

    document.addEventListener("focusin", handleFocusIn)
    document.addEventListener("focusout", handleFocusOut)

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", checkViewport)
        window.visualViewport.removeEventListener("scroll", checkViewport)
      }
      document.removeEventListener("focusin", handleFocusIn)
      document.removeEventListener("focusout", handleFocusOut)
    }
  }, [threshold])

  return isKeyboardOpen
}

/**
 * How many pixels the on-screen keyboard currently covers, from the Visual
 * Viewport API (0 when closed, or on browsers without the API).
 *
 * A form whose last fields sit near the bottom of the document cannot scroll
 * them above the keyboard — there simply is not enough content below them to
 * scroll to. Padding the form by this value creates exactly that room, without
 * any device-specific constant, and it collapses back to 0 when the keyboard
 * closes so the layout is unchanged.
 */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return undefined

    const viewport = window.visualViewport

    const update = () => {
      // offsetTop matters while the page is pinch-zoomed or scrolled by the UA.
      const covered = window.innerHeight - viewport.height - viewport.offsetTop
      // Ignore small browser-chrome changes (address bar collapse etc.).
      setInset(covered > 100 ? Math.round(covered) : 0)
    }

    update()
    viewport.addEventListener("resize", update)
    viewport.addEventListener("scroll", update)
    return () => {
      viewport.removeEventListener("resize", update)
      viewport.removeEventListener("scroll", update)
    }
  }, [])

  return inset
}

/**
 * Keeps the focused field visible when the keyboard opens.
 *
 * Attach the returned ref to the scrolling form container. On focus it waits a
 * frame for the viewport to settle, then scrolls the field into the middle of
 * the *visible* area using the browser's own smooth scrolling — no wheel
 * hijacking, so one-finger touch scrolling keeps working normally.
 */
export function useKeepFocusedFieldVisible() {
  const containerRef = useRef(null)

  useEffect(() => {
    const node = containerRef.current
    if (!node) return undefined

    const isTextField = (el) =>
      el &&
      (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) &&
      !["checkbox", "radio", "submit", "button", "file", "image", "reset"].includes(
        String(el.type || "").toLowerCase(),
      )

    const handleFocusIn = (event) => {
      const target = event.target
      if (!isTextField(target)) return
      // The keyboard animates in; wait for the viewport to resize first.
      window.setTimeout(() => {
        try {
          target.scrollIntoView({ block: "center", behavior: "smooth" })
        } catch {
          target.scrollIntoView(false)
        }
      }, 250)
    }

    node.addEventListener("focusin", handleFocusIn)
    return () => node.removeEventListener("focusin", handleFocusIn)
  }, [])

  return containerRef
}

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

const NON_TEXT_INPUT_TYPES = ["checkbox", "radio", "submit", "button", "file", "image", "reset", "range", "color"]

const isKeyboardField = (el) =>
  Boolean(el) &&
  (el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable ||
    (el.tagName === "INPUT" && !NON_TEXT_INPUT_TYPES.includes(String(el.type || "").toLowerCase())))

/**
 * Keyboard handling for fixed bottom sheets / modals that contain inputs.
 *
 * Modern Android Chrome/WebView and iOS Safari shrink only the *visual* viewport
 * when the keyboard opens, so an element pinned with `bottom: 0` stays under the
 * keyboard and its inputs cannot be reached. This lifts the sheet by the covered
 * height, caps its height to the visible area, and scrolls the focused field to
 * the middle of the sheet's own scroll area (never the page), so normal
 * one-finger scrolling inside the sheet keeps working.
 *
 * Usage: spread `sheetProps` onto the sheet element that scrolls (overflow-y-auto).
 */
export function useKeyboardAwareSheet({ gap = 8, minHeight = 220 } = {}) {
  const sheetRef = useRef(null)
  const [metrics, setMetrics] = useState({ inset: 0, viewportHeight: 0 })

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return undefined
    const viewport = window.visualViewport

    const update = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop
      const inset = covered > 100 ? Math.round(covered) : 0
      const viewportHeight = Math.round(viewport.height)
      setMetrics((prev) =>
        prev.inset === inset && prev.viewportHeight === viewportHeight ? prev : { inset, viewportHeight },
      )
    }

    update()
    viewport.addEventListener("resize", update)
    viewport.addEventListener("scroll", update)
    return () => {
      viewport.removeEventListener("resize", update)
      viewport.removeEventListener("scroll", update)
    }
  }, [])

  const centerField = (field) => {
    const sheet = sheetRef.current
    if (!sheet || !field || !sheet.contains(field)) return
    // Scroll whichever element inside the sheet actually scrolls (sheets often
    // keep a fixed header and scroll an inner body).
    let container = sheet
    for (let node = field.parentElement; node && node !== sheet; node = node.parentElement) {
      const overflowY = window.getComputedStyle(node).overflowY
      if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
        container = node
        break
      }
    }
    const fieldRect = field.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const offset = fieldRect.top - containerRect.top - (containerRect.height - fieldRect.height) / 2
    if (Math.abs(offset) < 4) return
    container.scrollBy({ top: offset, behavior: "smooth" })
  }

  // The keyboard animates in after focus; re-center once the sheet has resized.
  useEffect(() => {
    if (!metrics.inset) return undefined
    const timer = window.setTimeout(() => {
      if (isKeyboardField(document.activeElement)) centerField(document.activeElement)
    }, 60)
    return () => window.clearTimeout(timer)
  }, [metrics.inset, metrics.viewportHeight])

  const onFocusCapture = (event) => {
    const target = event.target
    if (!isKeyboardField(target)) return
    window.setTimeout(() => centerField(target), 320)
  }

  const keyboardOpen = metrics.inset > 0
  const sheetStyle = keyboardOpen
    ? {
        bottom: `${metrics.inset}px`,
        maxHeight: `${Math.max(minHeight, metrics.viewportHeight - gap)}px`,
      }
    : undefined

  return {
    keyboardInset: metrics.inset,
    keyboardOpen,
    sheetProps: {
      ref: sheetRef,
      style: sheetStyle,
      onFocusCapture,
    },
  }
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

/**
 * Keyboard handling for a full-screen page that scrolls its own body (long
 * forms such as the delivery signup details step).
 *
 * Letting the *document* scroll and calling `scrollIntoView` is unreliable once
 * the keyboard is up: the layout viewport does not shrink, so "centre" is a
 * point that can sit behind the keyboard, and a field near the end of the form
 * has no content below it to scroll against — which is why the last inputs stay
 * hidden and dragging does not help.
 *
 * Instead this locks the page to the height the browser actually leaves visible
 * and gives the form its own scroll area, so the area simply ends where the
 * keyboard begins; the focused field is then scrolled to the middle of that
 * area. Same mechanics as `useKeyboardAwareSheet`, applied to a whole page.
 *
 * Usage:
 *   const { pageProps, scrollProps } = useKeyboardAwarePage()
 *   <div {...pageProps} className="h-screen flex flex-col overflow-hidden">
 *     <header className="shrink-0" />
 *     <div {...scrollProps} className="flex-1 overflow-y-auto">…</div>
 *   </div>
 */
export function useKeyboardAwarePage({ bottomGap = 24 } = {}) {
  const scrollRef = useRef(null)
  const [metrics, setMetrics] = useState({ inset: 0, viewportHeight: 0 })

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return undefined
    const viewport = window.visualViewport

    const update = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop
      const inset = covered > 100 ? Math.round(covered) : 0
      const viewportHeight = Math.round(viewport.height)
      // iOS pans the whole document to reveal the focused field. The page is
      // height-locked, so undo that pan and let the form's scroll area do it.
      if (inset > 0 && window.scrollY !== 0) window.scrollTo(0, 0)
      setMetrics((prev) =>
        prev.inset === inset && prev.viewportHeight === viewportHeight ? prev : { inset, viewportHeight },
      )
    }

    update()
    viewport.addEventListener("resize", update)
    viewport.addEventListener("scroll", update)
    return () => {
      viewport.removeEventListener("resize", update)
      viewport.removeEventListener("scroll", update)
    }
  }, [])

  const centerField = (field) => {
    const container = scrollRef.current
    if (!container || !field || !container.contains(field)) return
    const fieldRect = field.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    // Middle of the visible scroll area; the browser clamps the scroll at the
    // ends, so the last field lands just above the keyboard instead.
    const offset = fieldRect.top - containerRect.top - (containerRect.height - fieldRect.height) / 2
    if (Math.abs(offset) < 4) return
    container.scrollBy({ top: offset, behavior: "smooth" })
  }

  // The keyboard animates in after focus; re-align once the viewport settles.
  // Covers Android (whole viewport resizes, inset stays 0) as well as iOS.
  useEffect(() => {
    if (!metrics.viewportHeight) return undefined
    const timer = window.setTimeout(() => {
      if (isKeyboardField(document.activeElement)) centerField(document.activeElement)
    }, 60)
    return () => window.clearTimeout(timer)
  }, [metrics.inset, metrics.viewportHeight])

  const onFocusCapture = (event) => {
    const target = event.target
    if (!isKeyboardField(target)) return
    window.setTimeout(() => centerField(target), 320)
  }

  return {
    keyboardInset: metrics.inset,
    keyboardOpen: metrics.inset > 0,
    pageProps: {
      style: metrics.viewportHeight ? { height: `${metrics.viewportHeight}px` } : undefined,
    },
    scrollProps: {
      ref: scrollRef,
      onFocusCapture,
      style: { paddingBottom: `${bottomGap}px` },
    },
  }
}

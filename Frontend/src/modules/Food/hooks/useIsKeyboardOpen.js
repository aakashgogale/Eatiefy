import { useState, useEffect } from "react"

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

import Lenis from 'lenis'

const MOBILE_BREAKPOINT = 768

let globalLenisInstance = null

export function getGlobalLenis() {
  return globalLenisInstance
}

export function scrollToTop(options = {}) {
  if (globalLenisInstance) {
    globalLenisInstance.scrollTo(0, {
      duration: options.duration || 1.1,
      immediate: options.immediate || false,
      ...options,
    })
  } else if (typeof window !== 'undefined') {
    window.scrollTo({
      top: 0,
      behavior: options.immediate ? 'auto' : 'smooth',
    })
  }
}

export function scrollToElement(target, options = {}) {
  if (globalLenisInstance && target) {
    globalLenisInstance.scrollTo(target, {
      offset: options.offset || -80,
      duration: options.duration || 1.2,
      ...options,
    })
  } else if (target && typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }
}

function shouldReduceMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function shouldUseNativeScroll() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true
  }

  // Keep mobile/touch devices on native scrolling for stability & 120Hz responsiveness.
  return window.matchMedia('(pointer: coarse)').matches
}

export function setupSmoothScroll({ disabled = false } = {}) {
  if (disabled || typeof window === 'undefined') return () => {}

  if (shouldReduceMotion()) return () => {}
  if (shouldUseNativeScroll()) return () => {}

  const isMobile = window.innerWidth <= MOBILE_BREAKPOINT

  const lenis = new Lenis({
    duration: isMobile ? 0.85 : 1.15,
    smoothWheel: true,
    syncTouch: false,
    wheelMultiplier: isMobile ? 0.85 : 1.05,
    touchMultiplier: 1,
    allowNestedScroll: true,
    autoRaf: false,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // Apple style easeOutExpo
  })

  globalLenisInstance = lenis

  let frameId = null

  const raf = (time) => {
    lenis.raf(time)
    frameId = window.requestAnimationFrame(raf)
  }

  frameId = window.requestAnimationFrame(raf)

  const handleVisibilityChange = () => {
    if (document.hidden) {
      lenis.stop()
      return
    }

    lenis.start()
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)

  return () => {
    if (frameId) window.cancelAnimationFrame(frameId)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    lenis.destroy()
    if (globalLenisInstance === lenis) {
      globalLenisInstance = null
    }
  }
}


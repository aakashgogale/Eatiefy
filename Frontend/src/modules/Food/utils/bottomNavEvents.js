const NAV_SHOW_EVENT = "food-bottom-nav-show"

export function requestBottomNavShow(lockMs = 900) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent(NAV_SHOW_EVENT, { detail: { lockMs } }),
  )
}

export function subscribeBottomNavShow(handler) {
  if (typeof window === "undefined") return () => {}
  const onShow = (e) => handler(e)
  window.addEventListener(NAV_SHOW_EVENT, onShow)
  return () => window.removeEventListener(NAV_SHOW_EVENT, onShow)
}

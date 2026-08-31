import { useRestaurantNotifications } from "@food/hooks/useRestaurantNotifications"

/**
 * Prompts for the one tap browsers require before an alert sound may play.
 *
 * Browsers refuse to play audio on a page the user has never interacted with. For a
 * restaurant panel that is a real operational problem: the order arrives, the alert
 * is blocked, and nothing on screen explains the silence — the staff simply believe
 * the app is broken.
 *
 * The banner shows only while sound is still blocked and disappears on the first
 * interaction anywhere on the page (the unlock listener in useRestaurantNotifications
 * fires for any tap, not just this button), so in practice it is rarely seen twice.
 */
const SoundEnableBanner = () => {
  const { soundReady } = useRestaurantNotifications()

  if (soundReady) return null

  return (
    <button
      type="button"
      // The click itself is the gesture the browser is waiting for; the unlock
      // listener handles it, so no onClick logic is needed here.
      className="fixed bottom-4 left-1/2 z-[9999] flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#EB590E] px-4 py-2.5 text-sm font-semibold text-white shadow-xl transition hover:bg-[#d94f0c] focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      aria-live="polite"
    >
      <span aria-hidden="true">🔔</span>
      Tap to enable order alert sound
    </button>
  )
}

export default SoundEnableBanner

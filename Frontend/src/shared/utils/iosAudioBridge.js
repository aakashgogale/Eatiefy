/**
 * Universal iOS WKWebView & Mobile Audio Bridge
 * Solves iOS WebKit autoplay policy, TestFlight audio playback, and hybrid webview message bridges.
 */

let sharedAudioContext = null
let isUnlocked = false
let currentOscillatorNodes = []
let loopIntervalId = null

const getAudioContext = () => {
  if (typeof window === "undefined") return null
  if (!sharedAudioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (AudioCtx) {
      try {
        sharedAudioContext = new AudioCtx()
      } catch (e) {
        console.warn("[iOSAudioBridge] AudioContext creation error:", e)
      }
    }
  }
  return sharedAudioContext
}

/**
 * Universal one-time unlock listener that runs on the earliest user touch gesture.
 */
export function initializeAudioUnlock() {
  if (typeof window === "undefined" || isUnlocked) return

  const unlock = async () => {
    const ctx = getAudioContext()
    if (ctx) {
      try {
        if (ctx.state === "suspended") {
          await ctx.resume()
        }
        // Play an inaudible 0.001s buffer to fully unlock WebKit audio thread
        const buffer = ctx.createBuffer(1, 1, 22050)
        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.connect(ctx.destination)
        source.start(0)
        isUnlocked = true
      } catch (e) {
        // ignore
      }
    }

    // Cleanup listeners once unlocked
    window.removeEventListener("pointerdown", unlock)
    window.removeEventListener("touchstart", unlock)
    window.removeEventListener("touchend", unlock)
    window.removeEventListener("click", unlock)
    window.removeEventListener("keydown", unlock)
  }

  window.addEventListener("pointerdown", unlock, { once: true, passive: true })
  window.addEventListener("touchstart", unlock, { once: true, passive: true })
  window.addEventListener("touchend", unlock, { once: true, passive: true })
  window.addEventListener("click", unlock, { once: true, passive: true })
  window.addEventListener("keydown", unlock, { once: true, passive: true })
}

// Auto-initialize on import
if (typeof window !== "undefined") {
  initializeAudioUnlock()
}

/**
 * Call native iOS WKWebView or Flutter in-app webview handlers if present
 */
export async function sendNativeNotificationBridge(eventName, payload = {}) {
  if (typeof window === "undefined") return false

  // 1. Check Flutter InAppWebView
  if (
    window.flutter_inappwebview &&
    typeof window.flutter_inappwebview.callHandler === "function"
  ) {
    try {
      await window.flutter_inappwebview.callHandler(eventName, payload)
      return true
    } catch {
      // try next
    }
  }

  // 2. Check Standard iOS WKWebView Message Handlers (Swift / Objective-C)
  if (window.webkit && window.webkit.messageHandlers) {
    const handlers = [
      eventName,
      "playNotificationSound",
      "notificationSound",
      "triggerHaptic",
      "orderAlert",
    ]
    for (const h of handlers) {
      if (
        window.webkit.messageHandlers[h] &&
        typeof window.webkit.messageHandlers[h].postMessage === "function"
      ) {
        try {
          window.webkit.messageHandlers[h].postMessage(payload)
          return true
        } catch {
          // try next
        }
      }
    }
  }

  return false
}

/**
 * Web Audio API synthesized alarm chime.
 * Generates an attention-grabbing multi-tone food order chime (880Hz -> 1046Hz -> 1318Hz -> 1760Hz).
 * Completely immune to network lag, CORS issues, or broken MP3 assets.
 */
export function playSynthesizedChime() {
  const ctx = getAudioContext()
  if (!ctx) return

  try {
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {})
    }

    const now = ctx.currentTime
    const notes = [
      { freq: 880, start: 0, dur: 0.12 },     // A5
      { freq: 1108.73, start: 0.12, dur: 0.14 }, // C#6
      { freq: 1318.51, start: 0.26, dur: 0.16 }, // E6
      { freq: 1760, start: 0.42, dur: 0.35 },    // A6
    ]

    notes.forEach(({ freq, start, dur }) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = "sine"
      osc.frequency.setValueAtTime(freq, now + start)

      // Smooth attack & decay
      gain.gain.setValueAtTime(0.001, now + start)
      gain.gain.exponentialRampToValueAtTime(0.4, now + start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(now + start)
      osc.stop(now + start + dur)

      currentOscillatorNodes.push(osc)
    })

    // Trigger phone vibration if supported
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      try {
        navigator.vibrate([200, 100, 200, 100, 400])
      } catch (_) {}
    }
  } catch (e) {
    console.warn("[iOSAudioBridge] Synthesized chime error:", e)
  }
}

/**
 * Start repeating alarm alert loop with native bridge + audio element + Web Audio synth fallback
 */
export function startUniversalAlertLoop({
  soundUrl = "/assets/media/restaurant_alert.mp3",
  orderData = {},
  intervalMs = 3000,
  maxDurationMs = 60000,
  onTick = null,
} = {}) {
  stopUniversalAlertLoop()

  const payload = {
    title: "New order received!",
    body: `Order #${orderData?.orderId || orderData?.orderMongoId || orderData?._id || ""}`.trim(),
    orderId: orderData?.orderId || orderData?._id || "",
    action: "start",
  }

  // 1. Notify native iOS bridge
  sendNativeNotificationBridge("playNotificationSound", payload).catch(() => {})

  // 2. Play initial sound / chime
  playSingleTone(soundUrl)
  if (typeof onTick === "function") onTick()

  const startTime = Date.now()

  loopIntervalId = setInterval(() => {
    if (Date.now() - startTime >= maxDurationMs) {
      stopUniversalAlertLoop()
      return
    }

    playSingleTone(soundUrl)
    if (typeof onTick === "function") onTick()
  }, intervalMs)
}

/**
 * Play a single sound alert with automatic fallback to synthesized Web Audio chime
 */
export function playSingleTone(soundUrl = "/assets/media/restaurant_alert.mp3") {
  let played = false

  try {
    const audio = new Audio(soundUrl)
    audio.preload = "auto"
    audio.volume = 1.0
    audio.currentTime = 0

    const promise = audio.play()
    if (promise !== undefined) {
      promise
        .then(() => {
          played = true
        })
        .catch((err) => {
          // iOS WebKit blocked HTMLAudioElement -> Fall back to synthesized Web Audio API chime!
          playSynthesizedChime()
        })
    }
  } catch (err) {
    playSynthesizedChime()
  }

  // Also trigger synthesized chime if audio didn't start within 100ms
  setTimeout(() => {
    if (!played) {
      playSynthesizedChime()
    }
  }, 100)
}

/**
 * Stop any active repeating alarm loop
 */
export function stopUniversalAlertLoop() {
  if (loopIntervalId) {
    clearInterval(loopIntervalId)
    loopIntervalId = null
  }

  currentOscillatorNodes.forEach((node) => {
    try {
      node.stop()
      node.disconnect()
    } catch (_) {}
  })
  currentOscillatorNodes = []

  sendNativeNotificationBridge("stopNotificationSound", { action: "stop" }).catch(() => {})
}

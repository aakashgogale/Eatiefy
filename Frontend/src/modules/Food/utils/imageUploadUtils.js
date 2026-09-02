/**
 * Records why a picker attempt took the path it did.
 * The real exception is always surfaced here instead of being swallowed
 * behind a generic toast, and the last few entries stay readable in a
 * production build via window.__eatiefyImagePicker.
 */
export const logPickerDiagnostic = (stage, detail) => {
  const entry = {
    stage,
    at: new Date().toISOString(),
    detail:
      detail instanceof Error
        ? { name: detail.name, message: detail.message, stack: detail.stack }
        : detail,
  }

  console.warn(`[image-picker] ${stage}`, entry.detail)

  if (typeof window !== "undefined") {
    if (!Array.isArray(window.__eatiefyImagePicker)) {
      window.__eatiefyImagePicker = []
    }
    window.__eatiefyImagePicker.push(entry)
    if (window.__eatiefyImagePicker.length > 20) {
      window.__eatiefyImagePicker.shift()
    }
  }
}

const openTransientImageInput = ({
  onSelectFile,
  accept = "image/*",
  capture = undefined,
}) => {
  if (typeof document === "undefined") {
    return
  }

  const input = document.createElement("input")
  input.type = "file"
  input.accept = accept
  input.multiple = false
  if (capture) {
    input.setAttribute("capture", capture)
  }

  input.style.position = "fixed"
  input.style.left = "-9999px"
  input.style.top = "-9999px"
  input.style.width = "1px"
  input.style.height = "1px"
  input.style.opacity = "0"
  input.style.pointerEvents = "none"

  let handled = false
  const cleanup = () => {
    if (handled) return
    handled = true
    setTimeout(() => {
      input.onchange = null
      input.oncancel = null
      if (input.parentNode) {
        input.parentNode.removeChild(input)
      }
    }, 500)
  }

  input.onchange = (event) => {
    const file = event?.target?.files?.[0] || null
    if (file && typeof onSelectFile === "function") {
      onSelectFile(file)
    }
    cleanup()
  }

  input.oncancel = cleanup
  document.body.appendChild(input)

  try {
    if (typeof input.showPicker === "function") {
      input.showPicker()
      return
    }
  } catch {}

  input.click()
}

/**
 * Utility to convert base64 image data from Flutter bridge into a File object
 */
export const convertBase64ToFile = (
  base64Value,
  mimeType = "image/jpeg",
  fileNamePrefix = "upload",
  originalFileName = "",
) => {
  if (!base64Value || typeof base64Value !== "string") {
    throw new Error("Invalid base64 image data")
  }

  let pureBase64 = base64Value.trim()
  if (pureBase64.includes(",")) {
    const parts = pureBase64.split(",")
    pureBase64 = parts[1] || ""
    const metaMatch = parts[0]?.match(/:(.*?);/)
    if (metaMatch && metaMatch[1]) {
      mimeType = metaMatch[1]
    }
  }

  // Remove any whitespace, newlines, or carriage returns from base64
  let cleanBase64 = pureBase64.replace(/[\r\n\s]/g, "")
  // Normalize url-safe base64
  cleanBase64 = cleanBase64.replace(/-/g, "+").replace(/_/g, "/")
  // Pad with '=' if length is not a multiple of 4
  while (cleanBase64.length % 4 !== 0) {
    cleanBase64 += "="
  }

  try {
    const byteCharacters = atob(cleanBase64)
    const byteNumbers = new Array(byteCharacters.length)
    for (let i = 0; i < byteCharacters.length; i += 1) {
      byteNumbers[i] = byteCharacters.charCodeAt(i)
    }

    const byteArray = new Uint8Array(byteNumbers)
    const normalizedFileName = String(originalFileName || "").trim()
    const extension = normalizedFileName.includes(".")
      ? normalizedFileName.split(".").pop()
      : mimeType.includes("png")
        ? "png"
        : mimeType.includes("webp")
          ? "webp"
          : "jpg"
    const blob = new Blob([byteArray], { type: mimeType || "image/jpeg" })
    const fileName = normalizedFileName || `${fileNamePrefix}-${Date.now()}.${extension}`
    return new File([blob], fileName, { type: mimeType || "image/jpeg" })
  } catch (error) {
    console.error("Base64 conversion failed:", error)
    throw new Error("Failed to process image data")
  }
}

/**
 * Standard browser camera fallback
 */
export const openBrowserCameraFallback = (onSelectFile) => {
  try {
    openTransientImageInput({
      onSelectFile,
      accept: "image/*",
      capture: "environment",
    })
  } catch (error) {
    console.error("Browser camera fallback failed:", error)
    openTransientImageInput({ onSelectFile, accept: "image/*" })
  }
}

/**
 * Check if the Flutter InAppWebView bridge is available
 */
export const isFlutterBridgeAvailable = () => {
  return (
    typeof window !== "undefined" &&
    window.flutter_inappwebview &&
    typeof window.flutter_inappwebview.callHandler === "function"
  )
}

/**
 * A native picker is driven by the user: taking a photo or browsing a gallery easily
 * takes longer than any timeout we could justify. So the bridge call is never
 * "given up on" - we only fall back when it answers that it cannot help, or when it
 * stays silent long enough that the handler is almost certainly not registered.
 *
 * Whichever source answers first wins; a late answer from the other one is dropped
 * instead of overwriting the picture the user already picked.
 */
const BRIDGE_SILENCE_FALLBACK_MS = 20000

const createSingleDelivery = (onSelectFile) => {
  let delivered = false
  return {
    isDelivered: () => delivered,
    deliver: (file) => {
      if (delivered || !file) return false
      delivered = true
      try {
        onSelectFile(file)
      } catch (error) {
        logPickerDiagnostic("deliver:handler-threw", error)
      }
      return true
    },
  }
}

const extractBridgeFile = (result, fileNamePrefix) => {
  if (!result || typeof result !== "object") return null

  const base64Value = result?.base64 || result?.base64String || result?.data?.base64
  const mimeType = result?.mimeType || result?.type || result?.data?.mimeType || "image/jpeg"
  const originalFileName = result?.fileName || result?.name || result?.data?.fileName || ""

  if (base64Value) {
    try {
      return convertBase64ToFile(base64Value, mimeType, fileNamePrefix, originalFileName)
    } catch (error) {
      logPickerDiagnostic("bridge:base64-conversion-failed", error)
      return null
    }
  }

  if (result.file instanceof File || result.file instanceof Blob) {
    return result.file
  }

  return null
}

/**
 * Shared driver for the camera and gallery pickers.
 */
const openBridgePicker = async ({
  handlerName,
  payload,
  onSelectFile,
  fileNamePrefix,
  openFallback,
}) => {
  if (typeof onSelectFile !== "function") return

  const delivery = createSingleDelivery(onSelectFile)
  const runFallback = (reason) => {
    if (delivery.isDelivered()) return
    logPickerDiagnostic(`${handlerName}:fallback`, { reason })
    try {
      openFallback(delivery.deliver)
    } catch (error) {
      logPickerDiagnostic(`${handlerName}:fallback-failed`, error)
      openTransientImageInput({ onSelectFile: delivery.deliver, accept: "image/*" })
    }
  }

  // No bridge: open the file input in the SAME tick as the user's tap. Android WebView
  // rejects a programmatic file-input click once the user gesture has expired.
  if (!isFlutterBridgeAvailable()) {
    runFallback("no-flutter-bridge")
    return
  }

  let bridgeAnswered = false
  const bridgePromise = Promise.resolve()
    .then(() => window.flutter_inappwebview.callHandler(handlerName, payload))
    .then((result) => {
      bridgeAnswered = true
      return result
    })

  // A late native answer is still honoured, as long as nothing was delivered meanwhile.
  bridgePromise
    .then((result) => {
      const file = extractBridgeFile(result, fileNamePrefix)
      if (file && delivery.deliver(file)) {
        logPickerDiagnostic(`${handlerName}:bridge-success`, { late: true })
      }
    })
    .catch(() => {})

  const silenceTimeout = new Promise((resolve) =>
    setTimeout(() => resolve("__picker_silence__"), BRIDGE_SILENCE_FALLBACK_MS),
  )

  let result
  try {
    result = await Promise.race([bridgePromise, silenceTimeout])
  } catch (error) {
    logPickerDiagnostic(`${handlerName}:bridge-threw`, error)
    runFallback("bridge-threw")
    return
  }

  if (result === "__picker_silence__" && !bridgeAnswered) {
    // Handler is not registered on the Flutter side, or never answered.
    runFallback("bridge-timeout-or-no-handler")
    return
  }

  if (result === "__picker_silence__") return

  const file = extractBridgeFile(result, fileNamePrefix)
  if (file) {
    if (delivery.deliver(file)) {
      logPickerDiagnostic(`${handlerName}:bridge-success`, { late: false })
    }
    return
  }

  // Bridge answered but gave us nothing usable.
  if (result === null || result === undefined) {
    runFallback("bridge-returned-null")
    return
  }

  if (result?.cancelled === true || result?.canceled === true) {
    logPickerDiagnostic(`${handlerName}:user-cancelled`, { result })
    return
  }

  runFallback({ reason: "bridge-answer-without-usable-file", result })
}

/**
 * Open camera via Flutter bridge or browser fallback.
 * ALWAYS falls back seamlessly if bridge throws or fails.
 */
export const openCamera = async ({ onSelectFile, fileNamePrefix = "camera-photo", quality = 0.8 }) =>
  openBridgePicker({
    handlerName: "openCamera",
    payload: { source: "camera", accept: "image/*", multiple: false, quality },
    onSelectFile,
    fileNamePrefix,
    openFallback: (deliver) => openBrowserCameraFallback(deliver),
  })

/**
 * Open gallery via Flutter bridge or browser fallback.
 * ALWAYS falls back seamlessly to standard file picker if bridge throws, cancels, or fails.
 */
export const openGallery = async ({
  onSelectFile,
  fileNamePrefix = "gallery-photo",
  fallbackInputRef = null,
}) =>
  openBridgePicker({
    handlerName: "openGallery",
    payload: { source: "gallery", accept: "image/*", multiple: false },
    onSelectFile,
    fileNamePrefix,
    openFallback: (deliver) => {
      if (fallbackInputRef?.current && typeof fallbackInputRef.current.click === "function") {
        fallbackInputRef.current.click()
        return
      }
      openTransientImageInput({ onSelectFile: deliver, accept: "image/*" })
    },
  })

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
 * Open camera via Flutter bridge or browser fallback.
 * ALWAYS falls back seamlessly if bridge throws or fails.
 */
export const openCamera = async ({ onSelectFile, fileNamePrefix = "camera-photo", quality = 0.8 }) => {
  if (typeof onSelectFile !== "function") return

  const triggerCameraFallback = (reason) => {
    logPickerDiagnostic("camera:fallback", { reason })
    try {
      openBrowserCameraFallback(onSelectFile)
    } catch (e) {
      logPickerDiagnostic("camera:fallback-failed", e)
      openTransientImageInput({ onSelectFile, accept: "image/*" })
    }
  }

  if (!isFlutterBridgeAvailable()) {
    triggerCameraFallback("no-flutter-bridge")
    return
  }

  try {
    const bridgePromise = window.flutter_inappwebview.callHandler("openCamera", {
      source: "camera",
      accept: "image/*",
      multiple: false,
      quality: quality,
    })

    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 1500))
    const result = await Promise.race([bridgePromise, timeoutPromise])

    const isSuccess =
      result?.success === true ||
      Boolean(result?.base64 || result?.base64String || result?.data?.base64)

    if (result && isSuccess) {
      let selectedFile = null
      const base64Value = result?.base64 || result?.base64String || result?.data?.base64
      const mimeType = result?.mimeType || result?.type || result?.data?.mimeType || "image/jpeg"
      const originalFileName = result?.fileName || result?.name || result?.data?.fileName || ""

      if (base64Value) {
        selectedFile = convertBase64ToFile(
          base64Value,
          mimeType,
          fileNamePrefix,
          originalFileName,
        )
      } else if (result.file instanceof File || result.file instanceof Blob) {
        selectedFile = result.file
      }

      if (selectedFile) {
        onSelectFile(selectedFile)
        return
      }
    }

    if (!result) {
      triggerCameraFallback("bridge-timeout-or-no-handler")
      return
    }

    if (result.success === false) {
      triggerCameraFallback({ reason: "bridge-reported-failure", result })
    }
  } catch (error) {
    logPickerDiagnostic("camera:bridge-threw", error)
    triggerCameraFallback("bridge-threw")
  }
}

/**
 * Open gallery via Flutter bridge or browser fallback.
 * ALWAYS falls back seamlessly to standard file picker if bridge throws, cancels, or fails.
 */
export const openGallery = async ({
  onSelectFile,
  fileNamePrefix = "gallery-photo",
  fallbackInputRef = null,
}) => {
  if (typeof onSelectFile !== "function") return

  const triggerGalleryFallback = (reason) => {
    logPickerDiagnostic("gallery:fallback", {
      reason,
      usingFallbackInputRef: Boolean(fallbackInputRef?.current),
    })
    try {
      if (fallbackInputRef?.current && typeof fallbackInputRef.current.click === "function") {
        fallbackInputRef.current.click()
        return
      }
      openTransientImageInput({
        onSelectFile,
        accept: "image/*",
      })
    } catch (e) {
      logPickerDiagnostic("gallery:fallback-input-click-failed", e)
      openTransientImageInput({
        onSelectFile,
        accept: "image/*",
      })
    }
  }

  if (!isFlutterBridgeAvailable()) {
    triggerGalleryFallback("no-flutter-bridge")
    return
  }

  try {
    const bridgePromise = window.flutter_inappwebview.callHandler("openGallery", {
      source: "gallery",
      accept: "image/*",
      multiple: false,
    })

    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 1500))
    const result = await Promise.race([bridgePromise, timeoutPromise])

    const isSuccess =
      result?.success === true ||
      Boolean(result?.base64 || result?.base64String || result?.data?.base64)

    if (result && isSuccess) {
      let selectedFile = null
      const base64Value = result?.base64 || result?.base64String || result?.data?.base64
      const mimeType = result?.mimeType || result?.type || result?.data?.mimeType || "image/jpeg"
      const originalFileName = result?.fileName || result?.name || result?.data?.fileName || ""

      if (base64Value) {
        selectedFile = convertBase64ToFile(
          base64Value,
          mimeType,
          fileNamePrefix,
          originalFileName,
        )
      } else if (result.file instanceof File || result.file instanceof Blob) {
        selectedFile = result.file
      }

      if (selectedFile) {
        logPickerDiagnostic("gallery:bridge-success", { mimeType, originalFileName })
        onSelectFile(selectedFile)
        return
      }

      triggerGalleryFallback("bridge-success-without-usable-file")
      return
    }

    if (!result) {
      // Handler is not registered on the Flutter side, or never answered.
      triggerGalleryFallback("bridge-timeout-or-no-handler")
      return
    }

    if (result.success === false) {
      triggerGalleryFallback({ reason: "bridge-reported-failure", result })
    }
  } catch (error) {
    logPickerDiagnostic("gallery:bridge-threw", error)
    triggerGalleryFallback("bridge-threw")
  }
}

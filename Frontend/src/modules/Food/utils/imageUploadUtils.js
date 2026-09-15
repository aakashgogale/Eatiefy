import { toast } from "sonner"
import { compressImageForUpload } from "../../../shared/utils/imageCompressor.js"

const IMAGE_EXTENSION_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  bmp: "image/bmp",
}

const IMAGE_MIME_ALIASES = {
  "image/jpg": "image/jpeg",
  "image/x-png": "image/png",
}

export const MAX_IMAGE_UPLOAD_BYTES = 15 * 1024 * 1024

/**
 * Validates a picked image and repairs its MIME type before upload.
 *
 * Gallery pickers and WebView camera bridges often hand back photos with an
 * empty type, `application/octet-stream` or `image/jpg`, which the server's
 * upload filter rejected — the upload then failed with no obvious reason.
 * Returns `{ file }` on success or `{ error }` with a user-facing message.
 */
export const ensureUploadableImageFile = (file, { maxBytes = MAX_IMAGE_UPLOAD_BYTES } = {}) => {
  if (!file || typeof file !== "object" || typeof file.size !== "number") {
    return { error: "No image was selected" }
  }
  if (file.size === 0) {
    return { error: "The selected image is empty. Please choose another photo." }
  }
  if (file.size > maxBytes) {
    return { error: `Image is too large. Maximum size is ${Math.round(maxBytes / (1024 * 1024))}MB.` }
  }

  const rawType = String(file.type || "").toLowerCase().trim()
  const extension = String(file.name || "").split(".").pop().toLowerCase()
  let type = IMAGE_MIME_ALIASES[rawType] || rawType
  if (!type || type === "application/octet-stream") {
    type = IMAGE_EXTENSION_MIME[extension] || ""
  }
  if (!type.startsWith("image/")) {
    return { error: "Please select an image file (JPG, PNG or WebP)." }
  }
  if (type === rawType) {
    return { file }
  }

  try {
    const safeName = file.name || `image-${Date.now()}.${type.split("/")[1] || "jpg"}`
    return { file: new File([file], safeName, { type, lastModified: file.lastModified || Date.now() }) }
  } catch {
    return { file }
  }
}

const openTransientImageInput = ({
  onSelectFile,
  accept = "image/*",
  capture = undefined,
  compressOptions = undefined,
  shouldCompress = true,
}) => {
  if (typeof document === "undefined") {
    throw new Error("Document is not available")
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
  input.style.width = "1px"
  input.style.height = "1px"
  input.style.opacity = "0"
  input.style.pointerEvents = "none"

  const cleanup = () => {
    input.onchange = null
    input.oncancel = null
    if (input.parentNode && input.parentNode.contains(input)) {
      input.parentNode.removeChild(input)
    }
  }

  input.onchange = (event) => {
    const file = event?.target?.files?.[0] || null
    if (file) {
      void notifySelectedFile(file, onSelectFile, compressOptions, shouldCompress)
    }
    cleanup()
  }

  input.oncancel = cleanup
  document.body.appendChild(input)

  if (typeof input.showPicker === "function") {
    try {
      input.showPicker()
      return
    } catch {
      // Fall back to the standard click-based picker below.
    }
  }

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

  let pureBase64 = base64Value
  if (base64Value.includes(",")) {
    pureBase64 = base64Value.split(",")[1]
  }

  try {
    const byteCharacters = atob(pureBase64)
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
    const blob = new Blob([byteArray], { type: mimeType })
    const fileName = normalizedFileName || `${fileNamePrefix}-${Date.now()}.${extension}`
    return new File([blob], fileName, { type: mimeType })
  } catch (error) {
    console.error("Base64 conversion failed:", error)
    throw new Error("Failed to process image data")
  }
}

const isSuccessfulFlutterImageResult = (result) =>
  result?.success === true ||
  Boolean(result?.base64 || result?.base64String || result?.data?.base64 || result?.file)

const notifySelectedFile = async (file, onSelectFile, compressOptions, shouldCompress = true) => {
  if (!shouldCompress || !file || !String(file.type || "").startsWith("image/")) {
    onSelectFile(file)
    return
  }

  try {
    const compressed = await compressImageForUpload(file, compressOptions)
    onSelectFile(compressed)
  } catch (error) {
    console.warn("Image compression failed during selection:", error)
    onSelectFile(file)
  }
}

const fileFromFlutterImageResult = (result, fileNamePrefix) => {
  const base64Value = result?.base64 || result?.base64String || result?.data?.base64
  const mimeType = result?.mimeType || result?.type || result?.data?.mimeType || "image/jpeg"
  const originalFileName = result?.fileName || result?.name || result?.data?.fileName || ""

  if (base64Value) {
    return convertBase64ToFile(base64Value, mimeType, fileNamePrefix, originalFileName)
  }

  if (result?.file instanceof File) {
    return result.file
  }

  if (result?.file instanceof Blob) {
    const extension = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg"
    return new File([result.file], `${fileNamePrefix}-${Date.now()}.${extension}`, { type: mimeType })
  }

  return null
}

const openBrowserGalleryFallback = (onSelectFile, fallbackInputRef = null, options = {}) => {
  const { compressOptions, shouldCompress = true } = options
  if (fallbackInputRef?.current) {
    fallbackInputRef.current.click()
    return
  }

  openTransientImageInput({
    onSelectFile,
    accept: "image/*",
    compressOptions,
    shouldCompress,
  })
}

/**
 * Standard browser camera fallback
 */
export const openBrowserCameraFallback = (onSelectFile, fallbackInputRef = null, options = {}) => {
  const { compressOptions, shouldCompress = true } = options
  if (!onSelectFile || typeof onSelectFile !== "function") {
    console.warn("openBrowserCameraFallback: onSelectFile callback not provided")
    return
  }

  try {
    if (fallbackInputRef?.current) {
      fallbackInputRef.current.click()
      return
    }

    openTransientImageInput({
      onSelectFile,
      accept: "image/*",
      capture: "environment",
      compressOptions,
      shouldCompress,
    })
  } catch (error) {
    console.error("Browser camera fallback failed:", error)
    if (error?.message && !error.message.includes("canceled") && !error.message.includes("cancelled")) {
      toast.error("Could not open camera")
    }
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

const CAMERA_BRIDGE_HANDLERS = ["openCamera", "takePhoto", "captureImage"]
const GALLERY_BRIDGE_HANDLERS = [
  "openGallery",
  "pickImage",
  "pickImageFromGallery",
  "selectImageFromGallery",
]

const isFlutterImageSelectionCancelled = (result) => {
  if (result == null) return true
  if (result?.cancelled === true || result?.canceled === true) return true
  if (result?.success === false && !result?.error) return true
  return false
}

const buildFlutterImageHandlerArgs = (handlerName, { isCamera, quality }) => {
  const source = isCamera ? "camera" : "gallery"
  const baseArgs = {
    source,
    accept: "image/*",
    multiple: false,
    quality,
    type: "image",
  }

  if (handlerName === "openCamera" || handlerName === "openGallery") {
    return baseArgs
  }

  if (
    handlerName === "pickImage" ||
    handlerName === "pickImageFromGallery" ||
    handlerName === "selectImageFromGallery"
  ) {
    return {
      source,
      quality,
      mediaType: "photo",
      allowMultiple: false,
    }
  }

  return baseArgs
}

const invokeFlutterImageHandlers = async ({
  isCamera,
  onSelectFile,
  fileNamePrefix,
  quality = 0.8,
  onCancel,
  compressOptions,
  shouldCompress = true,
}) => {
  const handlerNames = isCamera ? CAMERA_BRIDGE_HANDLERS : GALLERY_BRIDGE_HANDLERS
  let lastError = null

  for (const handlerName of handlerNames) {
    try {
      const handlerArgs = buildFlutterImageHandlerArgs(handlerName, { isCamera, quality })
      const result = await window.flutter_inappwebview.callHandler(handlerName, handlerArgs)

      if (isFlutterImageSelectionCancelled(result)) {
        if (typeof onCancel === "function") {
          onCancel()
        }
        return { status: "cancelled" }
      }

      if (!isSuccessfulFlutterImageResult(result)) {
        lastError = new Error(`Handler "${handlerName}" returned an unsuccessful result`)
        continue
      }

      const selectedFile = fileFromFlutterImageResult(result, fileNamePrefix)
      if (!selectedFile || !String(selectedFile.type || "").startsWith("image/")) {
        lastError = new Error(`Handler "${handlerName}" returned invalid image data`)
        continue
      }

      await notifySelectedFile(selectedFile, onSelectFile, compressOptions, shouldCompress)
      return { status: "success", handlerName }
    } catch (error) {
      lastError = error
    }
  }

  return { status: "failed", lastError }
}

/**
 * Unified image picker for Flutter WebView and standard browsers.
 */
export const handleImageUpload = async ({
  source = "gallery",
  onSelectFile,
  fallbackInputRef = null,
  fileNamePrefix = "upload",
  quality = 0.8,
  onCancel,
  compress = true,
  compressOptions = undefined,
}) => {
  if (!onSelectFile || typeof onSelectFile !== "function") {
    console.warn("handleImageUpload: onSelectFile callback not provided")
    return
  }

  const isCamera = source === "camera"

  const pickerOptions = {
    compressOptions,
    shouldCompress: compress,
  }

  if (isFlutterBridgeAvailable()) {
    const outcome = await invokeFlutterImageHandlers({
      isCamera,
      onSelectFile,
      fileNamePrefix,
      quality,
      onCancel,
      compressOptions,
      shouldCompress: compress,
    })

    if (outcome.status === "failed") {
      console.error(
        `Flutter ${isCamera ? "camera" : "gallery"} bridge failed:`,
        outcome.lastError,
      )
      toast.error(
        isCamera
          ? "Could not open camera. Please try again."
          : "Could not open gallery. Please try again.",
      )
    }

    // Never fall back to the browser file input inside the Flutter shell.
    // That path shows Android's generic Photos/Files chooser instead of the native gallery.
    return
  }

  if (isCamera) {
    openBrowserCameraFallback(onSelectFile, fallbackInputRef, pickerOptions)
    return
  }

  openBrowserGalleryFallback(onSelectFile, fallbackInputRef, pickerOptions)
}

/**
 * Open camera via Flutter bridge or browser fallback
 */
export const openCamera = async ({
  onSelectFile,
  fileNamePrefix = "camera-photo",
  quality = 0.8,
  fallbackInputRef = null,
  onCancel,
  compress = true,
  compressOptions = undefined,
}) => {
  return handleImageUpload({
    source: "camera",
    onSelectFile,
    fallbackInputRef,
    fileNamePrefix,
    quality,
    onCancel,
    compress,
    compressOptions,
  })
}

/**
 * Open gallery via Flutter bridge (compressed images) or browser fallback
 */
export const openGallery = async ({
  onSelectFile,
  fileNamePrefix = "gallery-photo",
  fallbackInputRef = null,
  onCancel,
  compress = true,
  compressOptions = undefined,
}) => {
  return handleImageUpload({
    source: "gallery",
    onSelectFile,
    fallbackInputRef,
    fileNamePrefix,
    onCancel,
    compress,
    compressOptions,
  })
}

const DEFAULT_MAX_WIDTH = 2048
const DEFAULT_MAX_HEIGHT = 2048
const DEFAULT_QUALITY = 0.88
const DEFAULT_MAX_BYTES = 4.5 * 1024 * 1024

const PROFILE_PRESET = {
  maxWidth: 1024,
  maxHeight: 1024,
  maxBytes: 2 * 1024 * 1024,
  quality: 0.88,
}

const isImageFile = (file) =>
  file instanceof Blob && String(file.type || "").startsWith("image/")

const buildFileName = (originalName, extension) => {
  const base = String(originalName || "upload")
    .replace(/\.[^/.]+$/, "")
    .replace(/[^\w.-]+/g, "-")
    .slice(0, 80)
  return `${base || "upload"}-${Date.now()}.${extension}`
}

const scaleDimensions = (width, height, maxWidth, maxHeight) => {
  if (width <= maxWidth && height <= maxHeight) {
    return { width, height }
  }

  const ratio = Math.min(maxWidth / width, maxHeight / height)
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  }
}

const canvasToBlob = (canvas, mimeType, quality) =>
  new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality)
  })

const loadImageSource = async (file) => {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file)
      return {
        draw: (ctx, width, height) => ctx.drawImage(bitmap, 0, 0, width, height),
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close?.(),
      }
    } catch {
      // Fall back to HTMLImageElement below.
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve({
        draw: (ctx, width, height) => ctx.drawImage(img, 0, 0, width, height),
        width: img.width,
        height: img.height,
        cleanup: () => {},
      })
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error("Could not read image file"))
    }

    img.src = objectUrl
  })
}

const encodeCanvas = async (canvas, { maxBytes, quality }) => {
  const attempts = [
    { mimeType: "image/webp", extension: "webp" },
    { mimeType: "image/jpeg", extension: "jpg" },
  ]

  for (const attempt of attempts) {
    let currentQuality = quality

    while (currentQuality >= 0.55) {
      const blob = await canvasToBlob(canvas, attempt.mimeType, currentQuality)
      if (!blob) break

      if (blob.size <= maxBytes || currentQuality <= 0.58) {
        return { blob, mimeType: attempt.mimeType, extension: attempt.extension }
      }

      currentQuality -= 0.08
    }
  }

  throw new Error("Could not compress image to an uploadable size")
}

/**
 * Compress an image before upload while keeping visual quality high.
 * Returns the original file for non-images and animated GIFs.
 */
export async function compressImageForUpload(file, options = {}) {
  if (!isImageFile(file)) return file
  if (file.type === "image/gif") return file

  const {
    maxWidth = DEFAULT_MAX_WIDTH,
    maxHeight = DEFAULT_MAX_HEIGHT,
    maxBytes = DEFAULT_MAX_BYTES,
    quality = DEFAULT_QUALITY,
  } = options

  if (
    file.size <= maxBytes &&
    (file.type === "image/webp" || file.type === "image/jpeg") &&
    file.size <= 900 * 1024
  ) {
    return file
  }

  let imageSource
  try {
    imageSource = await loadImageSource(file)
  } catch (error) {
    console.warn("Image compression skipped:", error)
    return file
  }

  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    imageSource.cleanup()
    return file
  }

  try {
    const { width, height } = scaleDimensions(
      imageSource.width,
      imageSource.height,
      maxWidth,
      maxHeight,
    )

    canvas.width = width
    canvas.height = height
    imageSource.draw(ctx, width, height)

    const encoded = await encodeCanvas(canvas, { maxBytes, quality })
    const compressedFile = new File(
      [encoded.blob],
      buildFileName(file.name, encoded.extension),
      {
        type: encoded.mimeType,
        lastModified: Date.now(),
      },
    )

    if (compressedFile.size >= file.size && file.size <= maxBytes) {
      return file
    }

    return compressedFile
  } catch (error) {
    console.warn("Image compression failed, using original file:", error)
    return file
  } finally {
    imageSource.cleanup()
  }
}

export async function compressImagesForUpload(files = [], options = {}) {
  const normalized = Array.from(files || []).filter(Boolean)
  return Promise.all(normalized.map((file) => compressImageForUpload(file, options)))
}

export async function prepareUploadFile(file, options = {}) {
  if (!file) return file

  const preset =
    options.preset === "profile"
      ? PROFILE_PRESET
      : {}

  return compressImageForUpload(file, { ...preset, ...options })
}

export async function prepareUploadFiles(files = [], options = {}) {
  const normalized = Array.from(files || []).filter(Boolean)
  return Promise.all(normalized.map((file) => prepareUploadFile(file, options)))
}

export async function appendCompressedImageToFormData(formData, fieldName, file, options = {}) {
  if (!file || !formData) return formData
  const prepared = await prepareUploadFile(file, options)
  formData.append(fieldName, prepared)
  return formData
}

export async function appendCompressedImagesToFormData(formData, fieldName, files = [], options = {}) {
  if (!formData) return formData
  const preparedFiles = await prepareUploadFiles(files, options)
  preparedFiles.forEach((file) => formData.append(fieldName, file))
  return formData
}

export { DEFAULT_MAX_BYTES, PROFILE_PRESET }

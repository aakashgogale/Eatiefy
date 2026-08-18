import { clearModuleAuth } from "@food/utils/auth"
import { clearOnboardingFcmLocal } from "@food/utils/firebaseMessaging"

export const DELIVERY_SIGNUP_DOC_TYPES = [
  "profilePhoto",
  "aadharPhoto",
  "panPhoto",
  "drivingLicensePhoto",
]

const ONBOARDING_SESSION_KEYS = [
  "deliverySignupDetails",
  "deliverySignupDocs",
  "deliveryNeedsRegistration",
  "deliveryAuthData",
]

const DELIVERY_FILES_DB = "DeliveryOnboardingFiles"
const DELIVERY_FILES_STORE = "files"
const IDB_OPERATION_TIMEOUT_MS = 3000

let deliveryFilesDbPromise = null

const withTimeout = (promise, timeoutMs, timeoutValueFactory) =>
  new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      try {
        resolve(timeoutValueFactory())
      } catch (error) {
        reject(error)
      }
    }, timeoutMs)

    promise
      .then((value) => {
        clearTimeout(timeoutId)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timeoutId)
        reject(error)
      })
  })

const openDeliveryFilesDB = () => {
  if (deliveryFilesDbPromise) {
    return deliveryFilesDbPromise
  }

  deliveryFilesDbPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      deliveryFilesDbPromise = null
      reject(new Error("IndexedDB connection timeout"))
    }, IDB_OPERATION_TIMEOUT_MS)

    try {
      if (typeof indexedDB === "undefined") {
        clearTimeout(timeout)
        deliveryFilesDbPromise = null
        reject(new Error("IndexedDB not supported"))
        return
      }

      const request = indexedDB.open(DELIVERY_FILES_DB, 1)
      request.onupgradeneeded = (event) => {
        const db = event.target.result
        if (!db.objectStoreNames.contains(DELIVERY_FILES_STORE)) {
          db.createObjectStore(DELIVERY_FILES_STORE)
        }
      }
      request.onsuccess = (event) => {
        clearTimeout(timeout)
        const db = event.target.result
        db.onversionchange = () => {
          db.close()
          deliveryFilesDbPromise = null
        }
        resolve(db)
      }
      request.onerror = (event) => {
        clearTimeout(timeout)
        deliveryFilesDbPromise = null
        reject(event.target.error)
      }
      request.onblocked = () => {
        clearTimeout(timeout)
        deliveryFilesDbPromise = null
        reject(new Error("IndexedDB blocked"))
      }
    } catch (error) {
      clearTimeout(timeout)
      deliveryFilesDbPromise = null
      reject(error)
    }
  })

  return deliveryFilesDbPromise
}

const isUploadableFile = (file) => file instanceof File || file instanceof Blob
const IMAGE_COMPRESS_TIMEOUT_MS = 8000

/** In-memory fallback when IndexedDB write hangs/fails (common in WebViews). */
const signupDocumentMemory = Object.create(null)

const toSignupFile = (file, fallbackName = "document.jpg") => {
  if (file instanceof File) return file
  const type = file?.type || "image/jpeg"
  const extension = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg"
  const name = String(fallbackName || "document").replace(/\.[^.]+$/, "") + `.${extension}`
  return new File([file], name, { type, lastModified: Date.now() })
}

const canvasToJpegBlob = (canvas, quality) =>
  new Promise((resolve, reject) => {
    try {
      // Prefer toBlob; fall back to dataURL if the callback never fires (WebView hang).
      let settled = false
      const settle = (blob) => {
        if (settled) return
        settled = true
        if (blob) resolve(blob)
        else reject(new Error("Image compression failed"))
      }

      canvas.toBlob((result) => settle(result), "image/jpeg", quality)

      // Some WebViews never invoke toBlob callback — recover via toDataURL.
      setTimeout(() => {
        if (settled) return
        try {
          const dataUrl = canvas.toDataURL("image/jpeg", quality)
          const [header, base64] = dataUrl.split(",")
          if (!base64) {
            settle(null)
            return
          }
          const binary = atob(base64)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i)
          }
          settle(new Blob([bytes], { type: header.match(/:(.*?);/)?.[1] || "image/jpeg" }))
        } catch {
          settle(null)
        }
      }, 2500)
    } catch (error) {
      reject(error)
    }
  })

const compressSignupDocumentFile = async (file) => {
  const maxBytes = 1.5 * 1024 * 1024
  const maxDimension = 1600
  const original = toSignupFile(file)

  const bitmap = await createImageBitmap(original)
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height, 1))
    const targetWidth = Math.max(1, Math.round(bitmap.width * scale))
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement("canvas")
    canvas.width = targetWidth
    canvas.height = targetHeight
    const context = canvas.getContext("2d")
    if (!context) return original

    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight)

    const blob = await canvasToJpegBlob(canvas, 0.82)
    if (!blob || blob.size >= original.size || blob.size > maxBytes) {
      return original
    }

    const baseName = String(original.name || "document").replace(/\.[^.]+$/, "")
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() })
  } finally {
    bitmap.close?.()
  }
}

export const prepareSignupDocumentFile = async (file) => {
  if (!isUploadableFile(file) || !String(file.type || "").startsWith("image/")) {
    throw new Error("Invalid image file")
  }

  const original = toSignupFile(file)

  // Keep small images as-is (including webp) — avoid canvas/toBlob hangs.
  if (original.size <= 400 * 1024) {
    return original
  }

  try {
    return await withTimeout(
      compressSignupDocumentFile(original),
      IMAGE_COMPRESS_TIMEOUT_MS,
      () => original,
    )
  } catch {
    return original
  }
}

export const saveSignupDocumentToDB = async (docType, file) => {
  if (!DELIVERY_SIGNUP_DOC_TYPES.includes(docType) || !isUploadableFile(file)) return

  const prepared = toSignupFile(file, `${docType}.jpg`)
  signupDocumentMemory[docType] = prepared

  try {
    await withTimeout(
      (async () => {
        const db = await openDeliveryFilesDB()
        const tx = db.transaction(DELIVERY_FILES_STORE, "readwrite")
        tx.objectStore(DELIVERY_FILES_STORE).put(prepared, docType)
        await new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve(true)
          tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"))
          tx.onabort = () => reject(tx.error || new Error("IndexedDB write aborted"))
        })
      })(),
      IDB_OPERATION_TIMEOUT_MS,
      () => {
        throw new Error("IndexedDB write timeout")
      },
    )
  } catch {
    // Session memory still holds the file for preview + submit.
  }
}

export const getSignupDocumentFromDB = async (docType) => {
  if (!DELIVERY_SIGNUP_DOC_TYPES.includes(docType)) return null

  const documents = await getAllSignupDocumentsFromDB()
  return documents[docType] || null
}

export const getAllSignupDocumentsFromDB = async () => {
  const emptyResult = DELIVERY_SIGNUP_DOC_TYPES.reduce((acc, docType) => {
    acc[docType] = null
    return acc
  }, {})

  let fromDb = emptyResult

  try {
    const db = await openDeliveryFilesDB()
    const tx = db.transaction(DELIVERY_FILES_STORE, "readonly")
    const store = tx.objectStore(DELIVERY_FILES_STORE)

    fromDb = await withTimeout(
      new Promise((resolve) => {
        const documents = { ...emptyResult }
        let pending = DELIVERY_SIGNUP_DOC_TYPES.length

        const finish = () => {
          pending -= 1
          if (pending <= 0) {
            resolve(documents)
          }
        }

        DELIVERY_SIGNUP_DOC_TYPES.forEach((docType) => {
          const request = store.get(docType)
          request.onsuccess = () => {
            const result = request.result
            documents[docType] = isUploadableFile(result) ? result : null
            finish()
          }
          request.onerror = () => finish()
        })

        tx.onabort = () => resolve(documents)
      }),
      IDB_OPERATION_TIMEOUT_MS,
      () => emptyResult,
    )
  } catch {
    fromDb = emptyResult
  }

  // Prefer in-memory copies so a hung IndexedDB write never blocks signup.
  return DELIVERY_SIGNUP_DOC_TYPES.reduce((acc, docType) => {
    const memoryFile = signupDocumentMemory[docType]
    acc[docType] = isUploadableFile(memoryFile)
      ? memoryFile
      : isUploadableFile(fromDb[docType])
        ? fromDb[docType]
        : null
    return acc
  }, { ...emptyResult })
}

export const deleteSignupDocumentFromDB = async (docType) => {
  if (!DELIVERY_SIGNUP_DOC_TYPES.includes(docType)) return

  delete signupDocumentMemory[docType]

  try {
    const db = await openDeliveryFilesDB()
    const tx = db.transaction(DELIVERY_FILES_STORE, "readwrite")
    tx.objectStore(DELIVERY_FILES_STORE).delete(docType)
    await withTimeout(
      new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed"))
        tx.onabort = () => reject(tx.error || new Error("IndexedDB delete aborted"))
      }),
      IDB_OPERATION_TIMEOUT_MS,
      () => true,
    )
  } catch {
    // Ignore delete failures during cleanup.
  }
}

export const clearSignupDocumentsFromDB = async () => {
  DELIVERY_SIGNUP_DOC_TYPES.forEach((docType) => {
    delete signupDocumentMemory[docType]
  })

  try {
    if (typeof indexedDB === "undefined") return
    await Promise.all(DELIVERY_SIGNUP_DOC_TYPES.map((docType) => deleteSignupDocumentFromDB(docType)))
  } catch {
    try {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(DELIVERY_FILES_DB)
        request.onsuccess = () => resolve(true)
        request.onerror = () => reject(request.error)
        request.onblocked = () => resolve(true)
      })
    } catch {
      // Ignore cleanup failures.
    }
  }
}

const deserializeLegacySignupDocument = (stored) => {
  if (!stored) return null

  const dataUrl =
    typeof stored === "string"
      ? stored
      : typeof stored?.dataUrl === "string"
        ? stored.dataUrl
        : ""

  if (!dataUrl.startsWith("data:image")) return null

  try {
    const [header, base64] = dataUrl.split(",")
    const mimeType = stored?.type || header.match(/:(.*?);/)?.[1] || "image/jpeg"
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }

    return new File([bytes], stored?.name || "document.jpg", { type: mimeType })
  } catch {
    return null
  }
}

const migrateLegacySignupDocsToIndexedDB = async () => {
  if (typeof sessionStorage === "undefined") return

  const saved = sessionStorage.getItem("deliverySignupDocs")
  if (!saved) return

  try {
    const parsed = JSON.parse(saved)
    let migrated = false

    for (const docType of DELIVERY_SIGNUP_DOC_TYPES) {
      const legacyFile = deserializeLegacySignupDocument(parsed?.[docType])
      if (legacyFile) {
        const prepared = await prepareSignupDocumentFile(legacyFile)
        await saveSignupDocumentToDB(docType, prepared)
        migrated = true
      }
    }

    if (migrated) {
      sessionStorage.removeItem("deliverySignupDocs")
    }
  } catch {
    sessionStorage.removeItem("deliverySignupDocs")
  }
}

export const loadSignupDocumentPreviews = async () => {
  await migrateLegacySignupDocsToIndexedDB()

  const documents = await getAllSignupDocumentsFromDB()
  const previews = {}

  for (const docType of DELIVERY_SIGNUP_DOC_TYPES) {
    const file = documents[docType]
    if (file) {
      previews[docType] = URL.createObjectURL(file)
    }
  }

  return previews
}

export const hasDeliveryStep1Progress = (formData = {}) => {
  const textFields = [
    "name",
    "email",
    "address",
    "city",
    "state",
    "vehicleName",
    "vehicleNumber",
    "drivingLicenseNumber",
    "panNumber",
    "aadharNumber",
  ]

  if (textFields.some((field) => String(formData[field] || "").trim())) {
    return true
  }

  if (formData.vehicleType && formData.vehicleType !== "bike") {
    return true
  }

  return false
}

const getOnboardingPhoneDigits = () => {
  if (typeof sessionStorage === "undefined") return ""

  try {
    const details = JSON.parse(sessionStorage.getItem("deliverySignupDetails") || "{}")
    return String(details.phone || "").replace(/\D/g, "")
  } catch {
    return ""
  }
}

export async function clearDeliveryOnboardingData() {
  if (typeof sessionStorage !== "undefined") {
    const phone = getOnboardingPhoneDigits()

    ONBOARDING_SESSION_KEYS.forEach((key) => sessionStorage.removeItem(key))

    if (phone) {
      sessionStorage.removeItem(`delivery_block_expires_at_${phone}`)
      sessionStorage.removeItem(`delivery_resend_expires_at_${phone}`)
    }

    sessionStorage.removeItem("delivery_block_expires_at")
    sessionStorage.removeItem("delivery_resend_expires_at")
  }

  deliveryFilesDbPromise = null
  await clearSignupDocumentsFromDB()
  clearOnboardingFcmLocal("delivery")
  clearModuleAuth("delivery")
}

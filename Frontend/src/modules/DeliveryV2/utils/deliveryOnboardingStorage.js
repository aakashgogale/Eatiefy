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

const LEGACY_DOCS_KEY = "deliverySignupDocs"

/**
 * Durable fallback for when IndexedDB is unavailable — common in the WebView
 * shell. Without it a failed IDB write left the photo only in module memory,
 * which a refresh wipes, so the uploaded image vanished and had to be taken
 * again. sessionStorage matches the lifetime of the rest of the signup data.
 */
const saveSignupDocumentToSession = (docType, file) =>
  new Promise((resolve) => {
    if (typeof sessionStorage === "undefined" || !isUploadableFile(file)) {
      resolve(false)
      return
    }
    try {
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const existing = JSON.parse(sessionStorage.getItem(LEGACY_DOCS_KEY) || "{}")
          existing[docType] = {
            dataUrl: String(reader.result || ""),
            type: file.type || "image/jpeg",
            name: file.name || `${docType}.jpg`,
          }
          sessionStorage.setItem(LEGACY_DOCS_KEY, JSON.stringify(existing))
          resolve(true)
        } catch {
          // Quota exceeded, private mode, etc.
          resolve(false)
        }
      }
      reader.onerror = () => resolve(false)
      reader.readAsDataURL(file)
    } catch {
      resolve(false)
    }
  })

const removeSignupDocumentFromSession = (docType) => {
  if (typeof sessionStorage === "undefined") return
  try {
    const raw = sessionStorage.getItem(LEGACY_DOCS_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    delete parsed[docType]
    if (Object.keys(parsed).length) {
      sessionStorage.setItem(LEGACY_DOCS_KEY, JSON.stringify(parsed))
    } else {
      sessionStorage.removeItem(LEGACY_DOCS_KEY)
    }
  } catch {
    // Nothing to clean up.
  }
}

/**
 * Persists an uploaded document. Returns `{ persisted }` so the caller can tell
 * the user when a photo is only held for this session — previously every
 * failure was swallowed and the UI reported success regardless.
 */
export const saveSignupDocumentToDB = async (docType, file) => {
  if (!DELIVERY_SIGNUP_DOC_TYPES.includes(docType) || !isUploadableFile(file)) {
    return { persisted: false, storage: "none" }
  }

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
    // IndexedDB owns the file now; drop any older session copy so the two
    // stores cannot disagree and the same upload is never restored twice.
    removeSignupDocumentFromSession(docType)
    return { persisted: true, storage: "indexeddb" }
  } catch {
    const sessionSaved = await saveSignupDocumentToSession(docType, prepared)
    return {
      persisted: sessionSaved,
      storage: sessionSaved ? "session" : "memory",
    }
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

  removeSignupDocumentFromSession(docType)

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

/**
 * Synchronously pulls any session-stored documents into the in-memory cache.
 *
 * This is a plain base64 decode — no IndexedDB round trip and no image
 * re-encoding — so a refresh can show the already-uploaded photos right away
 * instead of waiting on the store-to-store migration.
 */
const hydrateSessionDocumentsIntoMemory = () => {
  if (typeof sessionStorage === "undefined") return
  let parsed = null
  try {
    const saved = sessionStorage.getItem(LEGACY_DOCS_KEY)
    if (!saved) return
    parsed = JSON.parse(saved)
  } catch {
    return
  }

  for (const docType of DELIVERY_SIGNUP_DOC_TYPES) {
    if (isUploadableFile(signupDocumentMemory[docType])) continue
    try {
      const file = deserializeLegacySignupDocument(parsed?.[docType])
      if (file) signupDocumentMemory[docType] = file
    } catch {
      // A single unreadable entry must not stop the others.
    }
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
        // Already compressed at upload time — store as-is.
        const result = await saveSignupDocumentToDB(docType, legacyFile)
        // Only IndexedDB supersedes the session copy. When it is unavailable
        // the session entry is the durable one and must survive.
        if (result?.storage === "indexeddb") migrated = true
      }
    }

    if (migrated) {
      sessionStorage.removeItem(LEGACY_DOCS_KEY)
    }
  } catch {
    sessionStorage.removeItem(LEGACY_DOCS_KEY)
  }
}

/**
 * Restores previews for every already-uploaded document.
 *
 * Reads whatever is stored (memory -> IndexedDB -> session copy) and hands back
 * object URLs immediately. Nothing is re-uploaded and nothing is re-encoded;
 * the store-to-store migration runs afterwards in the background so it can
 * never delay the image appearing.
 *
 * @param {(docType: string, url: string) => void} [onPreview]
 *   Called as each document resolves, so the UI can show the first image
 *   without waiting for the rest.
 */
export const loadSignupDocumentPreviews = async (onPreview) => {
  // Pull the session copy into memory first — a plain base64 decode, no
  // compression — so a refresh can paint straight away.
  hydrateSessionDocumentsIntoMemory()

  const documents = await getAllSignupDocumentsFromDB()
  const previews = {}

  for (const docType of DELIVERY_SIGNUP_DOC_TYPES) {
    const file = documents[docType]
    if (file) {
      const url = URL.createObjectURL(file)
      previews[docType] = url
      if (typeof onPreview === "function") {
        try {
          onPreview(docType, url)
        } catch {
          // A rendering callback must never break restore.
        }
      }
    }
  }

  // Background only: never awaited by the caller.
  void migrateLegacySignupDocsToIndexedDB()

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

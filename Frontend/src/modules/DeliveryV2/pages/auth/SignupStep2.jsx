import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Upload, X, Check, Camera, Image as ImageIcon, FileText } from "lucide-react"
import { deliveryAPI } from "@food/api"
import { toast } from "sonner"
import { openCamera, openGallery, convertBase64ToFile } from "@food/utils/imageUploadUtils"
import { clearModuleAuth, isModuleAuthenticated } from "@food/utils/auth"
import useDeliveryBackNavigation from "../../hooks/useDeliveryBackNavigation"
import { useDeliveryOnboardingStore } from "../../store/useDeliveryOnboardingStore"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const createEmptyUploadedDocs = () => ({
  profilePhoto: null,
  aadharPhoto: null,
  panPhoto: null,
  drivingLicensePhoto: null
})

const sanitizeUploadedDocValue = (value) => {
  if (!value) return null

  if (typeof value === "string") {
    return value.startsWith("blob:") ? null : value
  }

  if (typeof value === "object") {
    const url = typeof value.url === "string" ? value.url : ""
    if (url.startsWith("blob:")) {
      return null
    }
    return value
  }

  return null
}

const sanitizeUploadedDocs = (docs) => ({
  profilePhoto: sanitizeUploadedDocValue(docs?.profilePhoto),
  aadharPhoto: sanitizeUploadedDocValue(docs?.aadharPhoto),
  panPhoto: sanitizeUploadedDocValue(docs?.panPhoto),
  drivingLicensePhoto: sanitizeUploadedDocValue(docs?.drivingLicensePhoto)
})

const MAX_DOCUMENT_IMAGE_BYTES = 5 * 1024 * 1024
const TARGET_DOCUMENT_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_DOCUMENT_IMAGE_EDGE = 1600

const loadImageFromFile = (file) =>
  new Promise((resolve, reject) => {
    try {
      const objectUrl = URL.createObjectURL(file)
      const image = new Image()
      image.onload = () => {
        URL.revokeObjectURL(objectUrl)
        resolve(image)
      }
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl)
        reject(new Error("Failed to load image"))
      }
      image.src = objectUrl
    } catch (e) {
      reject(e)
    }
  })

const canvasToBlob = (canvas, type, quality) =>
  new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, type, quality)
    } catch {
      resolve(null)
    }
  })

const optimizeDocumentImage = async (file) => {
  if (!file) return file

  const isImageMime = String(file.type || "").startsWith("image/")
  const isImageName = /\.(jpg|jpeg|png|webp|heic|heif|jfif|bmp)$/i.test(String(file.name || ""))

  if (!isImageMime && !isImageName) {
    return file
  }

  if (typeof document === "undefined" || typeof URL === "undefined") {
    return file
  }

  try {
    const image = await loadImageFromFile(file)
    const originalWidth = Number(image.naturalWidth || image.width || 0)
    const originalHeight = Number(image.naturalHeight || image.height || 0)
    if (!originalWidth || !originalHeight) return file

    const longestEdge = Math.max(originalWidth, originalHeight)
    const scale = longestEdge > MAX_DOCUMENT_IMAGE_EDGE
      ? MAX_DOCUMENT_IMAGE_EDGE / longestEdge
      : 1

    const targetWidth = Math.max(1, Math.round(originalWidth * scale))
    const targetHeight = Math.max(1, Math.round(originalHeight * scale))
    const shouldProcess =
      scale < 1 || file.size > TARGET_DOCUMENT_IMAGE_BYTES

    if (!shouldProcess) return file

    const canvas = document.createElement("canvas")
    canvas.width = targetWidth
    canvas.height = targetHeight
    const context = canvas.getContext("2d", { alpha: false })
    if (!context) return file

    context.drawImage(image, 0, 0, targetWidth, targetHeight)

    const preferredType =
      file.type === "image/png" ? "image/jpeg" : (file.type || "image/jpeg")
    const optimizedBlob = await canvasToBlob(canvas, preferredType, 0.82)
    if (!optimizedBlob) return file

    if (optimizedBlob.size >= file.size && scale === 1) {
      return file
    }

    const baseName = String(file.name || "document").replace(/\.[^.]+$/, "")
    const extension = preferredType === "image/png"
      ? "png"
      : preferredType === "image/webp"
        ? "webp"
        : "jpg"

    return new File([optimizedBlob], `${baseName}.${extension}`, {
      type: preferredType,
      lastModified: Date.now()
    })
  } catch (error) {
    debugWarn("Skipping image canvas compression (using original file):", error)
    return file
  }
}

const getFriendlyRegistrationError = (error) => {
  const rawMessage =
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    ""

  if (/E11000 duplicate key error/i.test(rawMessage)) {
    if (/vehicleNumber_1/i.test(rawMessage) || /vehicleNumber/i.test(rawMessage)) {
      return "This vehicle number is already registered. Please use a different vehicle number."
    }

    if (/panNumber_1/i.test(rawMessage) || /panNumber/i.test(rawMessage)) {
      return "This PAN number is already registered."
    }

    if (/aadharNumber_1/i.test(rawMessage) || /aadharNumber/i.test(rawMessage)) {
      return "This Aadhar number is already registered."
    }

    if (/drivingLicense/i.test(rawMessage)) {
      return "This driving license number is already registered."
    }

    return "This account detail is already registered. Please check your information."
  }

  return rawMessage || "Failed to register. Please try again."
}

const DELIVERY_ONBOARDING_DB_CANDIDATES = [
  "deliveryOnboardingFiles",
  "delivery-onboarding-files",
  "deliverySignupFiles",
  "delivery-signup-files",
  "delivery_signup_files"
]

const deleteIndexedDbByName = (dbName) =>
  new Promise((resolve) => {
    if (!dbName || typeof indexedDB === "undefined") {
      resolve(false)
      return
    }
    try {
      const request = indexedDB.deleteDatabase(dbName)
      request.onsuccess = () => resolve(true)
      request.onerror = () => resolve(false)
      request.onblocked = () => resolve(false)
    } catch {
      resolve(false)
    }
  })

const cleanupDeliveryOnboardingIndexedDb = async () => {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return

  const candidateNames = new Set(DELIVERY_ONBOARDING_DB_CANDIDATES)
  try {
    if (typeof indexedDB.databases === "function") {
      const dbs = await indexedDB.databases()
      dbs
        .map((db) => String(db?.name || "").trim())
        .filter((name) => name && /delivery/i.test(name) && /onboard|signup|upload|doc/i.test(name))
        .forEach((name) => candidateNames.add(name))
    }
  } catch {
    // Ignore discovery failure and fallback to static allow-list only.
  }

  await Promise.all(Array.from(candidateNames).map((name) => deleteIndexedDbByName(name)))
}


const DOCUMENT_FIELDS = [
  { docType: "profilePhoto", label: "Profile Photo" },
  { docType: "aadharPhoto", label: "Aadhar Card Photo" },
  { docType: "panPhoto", label: "PAN Card Photo" },
  { docType: "drivingLicensePhoto", label: "Driving License Photo" },
]

/**
 * Rendered as a stable component type (module scope on purpose).
 *
 * It used to be declared inside SignupStep2, which gave React a brand-new component
 * type on every render: the whole card - including the hidden <input type="file"> and
 * the <img> preview - was torn down and rebuilt whenever any state changed. A file
 * chosen from the camera/gallery landed on an input that no longer existed, so the
 * change never arrived and the picked photo silently disappeared.
 */
const DocumentUploadCard = ({
  docType,
  label,
  required = true,
  uploadedName,
  isUploading,
  previewSrc,
  hasDocument,
  controlsDisabled,
  inputRef,
  onTakePhoto,
  onPickGallery,
  onRemove,
  onFileSelected,
}) => (
  <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-xs">
    <div className="flex items-center justify-between mb-2.5">
      <label className="block text-sm font-bold text-gray-800">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {hasDocument && (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
          Selected
        </span>
      )}
    </div>

    {hasDocument ? (
      <div className="relative w-full h-52 bg-gray-900/5 rounded-xl overflow-hidden border border-gray-200 shadow-inner flex items-center justify-center group">
        {previewSrc ? (
          <img
            src={previewSrc}
            alt={label}
            className="w-full h-full object-cover rounded-xl transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex flex-col items-center justify-center p-4 text-center">
            <FileText className="w-12 h-12 text-[#00B761] mb-2" />
            <p className="text-sm font-semibold text-gray-800">{uploadedName || "Document attached"}</p>
            <span className="text-xs text-gray-500 mt-0.5">Ready for upload</span>
          </div>
        )}

        {/* Remove / Replace Photo Button */}
        <button
          type="button"
          disabled={controlsDisabled}
          onClick={onRemove}
          className={`absolute top-2.5 right-2.5 text-white p-2 rounded-full transition-all shadow-md z-10 ${
            controlsDisabled
              ? "bg-red-300 cursor-not-allowed"
              : "bg-red-500 hover:bg-red-600 active:scale-90 cursor-pointer"
          }`}
          aria-label="Remove document"
          title="Remove document"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Uploaded Badge Overlay */}
        <div className="absolute bottom-2.5 left-2.5 bg-emerald-600 text-white px-3 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-bold shadow-md z-10 backdrop-blur-xs">
          <Check className="w-3.5 h-3.5 stroke-[3]" />
          <span>Uploaded</span>
        </div>
      </div>
    ) : (
      <div className="flex flex-col items-center justify-center w-full min-h-[190px] border-2 border-dashed border-gray-300 rounded-xl hover:border-[#00B761] transition-all px-4 py-5 bg-gray-50/50">
        <div className="flex flex-col items-center justify-center mb-3">
          {isUploading ? (
            <>
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00B761] mb-2" />
              <p className="text-xs font-medium text-gray-600">Processing photo...</p>
            </>
          ) : (
            <>
              <Upload className="w-8 h-8 text-gray-400 mb-1.5" />
              <p className="text-sm font-semibold text-gray-700 mb-0.5">Upload document</p>
              <p className="text-xs text-gray-400">PNG, JPG up to 5MB</p>
            </>
          )}
        </div>

        {!isUploading && (
          <div className="w-full grid grid-cols-2 gap-2.5 mt-1">
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={onTakePhoto}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-white text-xs font-bold transition-all shadow-xs ${
                controlsDisabled
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-gray-900 hover:bg-black active:scale-95 cursor-pointer"
              }`}
            >
              <Camera className="w-4 h-4" />
              <span>Take Photo</span>
            </button>
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={onPickGallery}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-white text-xs font-bold transition-all shadow-xs ${
                controlsDisabled
                  ? "bg-[#8fd8b6] cursor-not-allowed"
                  : "bg-[#00B761] hover:bg-[#00A055] active:scale-95 cursor-pointer"
              }`}
            >
              <ImageIcon className="w-4 h-4" />
              <span>Gallery</span>
            </button>
          </div>
        )}
      </div>
    )}

    {/* Kept outside the conditional branches so the input survives selecting,
        replacing and removing a document. */}
    <input
      ref={inputRef}
      type="file"
      className="hidden"
      accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
      onClick={(e) => {
        e.target.value = ""
      }}
      onChange={(e) => {
        const selectedFile = e.target.files?.[0]
        if (selectedFile) {
          onFileSelected(selectedFile)
        }
        e.target.value = ""
      }}
      disabled={controlsDisabled}
    />
  </div>
)

export default function SignupStep2() {
  const navigate = useNavigate()
  const goBack = useDeliveryBackNavigation()
  const isMobileDevice =
    typeof navigator !== "undefined" &&
    /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || "")
  const fileInputRefs = useRef({
    profilePhoto: null,
    aadharPhoto: null,
    panPhoto: null,
    drivingLicensePhoto: null
  })
  const { documents, setDocument, removeDocument, clearOnboardingState } = useDeliveryOnboardingStore()
  const [uploadedDocs, setUploadedDocs] = useState(() => {
    const initial = createEmptyUploadedDocs()
    Object.keys(documents).forEach(key => {
      if (documents[key]) initial[key] = { file: true }
    })
    return initial
  })
  const [previews, setPreviews] = useState(() => {
    const initial = {}
    Object.keys(documents).forEach(key => {
      const doc = documents[key]
      if (doc instanceof File || doc instanceof Blob) {
        try { initial[key] = URL.createObjectURL(doc) } catch {}
      } else if (typeof doc === 'string') {
        initial[key] = doc
      }
    })
    return initial
  })
  const [activePicker, setActivePicker] = useState(null) // { docType: string, title: string, ref: any }
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [uploading, setUploading] = useState({})
  const [keyboardInset, setKeyboardInset] = useState(0)
  const [isInputFocused, setIsInputFocused] = useState(false)
  const documentTypes = DOCUMENT_FIELDS.map((field) => field.docType)
  const isMountedRef = useRef(true)

  // Sync previews whenever documents change from external sources
  useEffect(() => {
    Object.keys(documents).forEach(key => {
      const doc = documents[key]
      if (doc && !previews[key]) {
        if (doc instanceof File || doc instanceof Blob) {
          try {
            const url = URL.createObjectURL(doc)
            setPreviews(prev => ({ ...prev, [key]: url }))
          } catch {}
        } else if (typeof doc === 'string') {
          setPreviews(prev => ({ ...prev, [key]: doc }))
        }
      }
    })
  }, [documents])

  useEffect(() => {
    const handleFocusIn = (e) => {
      const isInput = ["INPUT", "TEXTAREA", "SELECT"].includes(e.target?.tagName)
      if (isInput) {
        setIsInputFocused(true)
        setTimeout(() => {
          e.target?.scrollIntoView({ behavior: "smooth", block: "center" })
        }, 320)
      }
    }

    const handleFocusOut = () => {
      setTimeout(() => {
        const active = document.activeElement
        const isStillInput = active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)
        if (!isStillInput) {
          setIsInputFocused(false)
        }
      }, 150)
    }

    const updateKeyboardInset = () => {
      if (typeof window === "undefined" || !window.visualViewport) return
      const viewport = window.visualViewport
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      setKeyboardInset(inset > 0 ? inset : 0)
    }

    window.addEventListener("focusin", handleFocusIn)
    window.addEventListener("focusout", handleFocusOut)

    if (typeof window !== "undefined" && window.visualViewport) {
      updateKeyboardInset()
      window.visualViewport.addEventListener("resize", updateKeyboardInset)
      window.visualViewport.addEventListener("scroll", updateKeyboardInset)
    }

    return () => {
      window.removeEventListener("focusin", handleFocusIn)
      window.removeEventListener("focusout", handleFocusOut)
      if (typeof window !== "undefined" && window.visualViewport) {
        window.visualViewport.removeEventListener("resize", updateKeyboardInset)
        window.visualViewport.removeEventListener("scroll", updateKeyboardInset)
      }
    }
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" })
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }, [])

  useEffect(() => {
    const saved = sessionStorage.getItem("deliverySignupDocs")
    if (!saved) return
    if (/\"dataUrl\"\s*:/.test(saved) || saved.length > 250000) {
      sessionStorage.removeItem("deliverySignupDocs")
    }
  }, [])

  const documentsRef = useRef(documents)
  useEffect(() => {
    documentsRef.current = documents
  }, [documents])

  useEffect(() => {
    return () => {
      isMountedRef.current = false
      // Do NOT revokeObjectURL here anymore because we want to preserve 
      // the previews when navigating back and forth between steps.
      // The browser will clean them up when the tab is closed or 
      // when we explicitly revoke them during file replacement/removal.
    }
  }, [])

  const navigateWithFallback = (path) => {
    navigate(path, { replace: true })

    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        if (!isMountedRef.current) return
        if (window.location.pathname !== path) {
          window.location.replace(path)
        }
      }, 250)
    }
  }

  const getPreviewSrc = (docType) => {
    if (previews[docType]) return previews[docType]

    const localFile = documents[docType]
    if (localFile instanceof File || localFile instanceof Blob) {
      if (!localFile._previewUrl) {
        try {
          localFile._previewUrl = URL.createObjectURL(localFile)
        } catch (e) {
          debugWarn("Failed to create preview object URL:", e)
        }
      }
      return localFile._previewUrl || null
    }

    const uploaded = uploadedDocs[docType]
    if (typeof uploaded === "string") return uploaded
    if (uploaded?.url) return uploaded.url

    return null
  }

  const handleOpenUploadOptions = (docType) => {
    fileInputRefs.current[docType]?.click()
  }

  const handleFileSelect = async (docType, file) => {
    if (!file) return

    setUploading((prev) => ({ ...prev, [docType]: true }))

    const isImageMime = String(file.type || "").startsWith("image/")
    const isImageName = /\.(jpg|jpeg|png|webp|heic|heif|jfif|bmp)$/i.test(String(file.name || ""))

    if (!isImageMime && !isImageName) {
      setUploading((prev) => ({ ...prev, [docType]: false }))
      toast.error("Please select a valid image file (JPG, PNG, WEBP)")
      return
    }

    try {
      // Ensure file has valid image mime type if missing
      let validFile = file
      if (!file.type || !file.type.startsWith("image/")) {
        validFile = new File([file], file.name || `${docType}.jpg`, { type: "image/jpeg" })
      }

      // Immediately generate and set preview URL so user sees instant feedback
      let instantPreview = null
      try {
        instantPreview = URL.createObjectURL(validFile)
        setPreviews(prev => ({ ...prev, [docType]: instantPreview }))
      } catch {}

      const normalizedFile = await optimizeDocumentImage(validFile)

      if (normalizedFile.size > MAX_DOCUMENT_IMAGE_BYTES) {
        toast.error("Image size should be less than 5MB")
        return
      }

      const oldFile = documents[docType]
      if (oldFile instanceof File && oldFile._previewUrl && String(oldFile._previewUrl).startsWith("blob:")) {
        try { URL.revokeObjectURL(oldFile._previewUrl) } catch {}
      }

      let optimizedPreview = instantPreview
      try {
        optimizedPreview = URL.createObjectURL(normalizedFile)
        normalizedFile._previewUrl = optimizedPreview
        setPreviews(prev => ({ ...prev, [docType]: optimizedPreview }))
      } catch (e) {
        debugWarn("Preview URL creation failed:", e)
      }

      // Read as DataURL for permanent display in WebViews
      if (typeof FileReader !== "undefined") {
        const reader = new FileReader()
        reader.onload = (e) => {
          const result = e.target?.result
          if (result) {
            setPreviews(prev => ({ ...prev, [docType]: result }))
          }
        }
        reader.readAsDataURL(normalizedFile)
      }

      setDocument(docType, normalizedFile)
      setUploadedDocs((prev) => ({
        ...prev,
        [docType]: {
          name: normalizedFile.name || `${docType}.jpg`,
          type: normalizedFile.type || "image/jpeg",
          size: normalizedFile.size,
          file: true
        }
      }))
      toast.success(`${docType.replace(/([A-Z])/g, " $1").trim()} selected`)
    } catch (error) {
      debugError("Failed to process selected file:", error)
      // Fallback: save raw file directly
      try {
        let rawPreview = null
        try {
          rawPreview = URL.createObjectURL(file)
          setPreviews(prev => ({ ...prev, [docType]: rawPreview }))
        } catch {}

        setDocument(docType, file)
        setUploadedDocs((prev) => ({
          ...prev,
          [docType]: {
            name: file.name || `${docType}.jpg`,
            type: file.type || "image/jpeg",
            size: file.size || 0,
            file: true
          }
        }))
        toast.success(`${docType.replace(/([A-Z])/g, " $1").trim()} selected`)
      } catch {
        toast.error("Failed to process image. Please try another photo.")
      }
    } finally {
      setUploading((prev) => ({ ...prev, [docType]: false }))
    }
  }

  const handleTakeCameraPhoto = (docType, label) => {
    openCamera({
      onSelectFile: (file) => handleFileSelect(docType, file),
      fileNamePrefix: `signup-${docType}`
    })
  }

  const handlePickFromGallery = async (docType) => {
    await openGallery({
      onSelectFile: (file) => handleFileSelect(docType, file),
      fileNamePrefix: `signup-${docType}`
    })
  }

  const handleRemove = (docType) => {
    const file = documents[docType]
    if (file instanceof File && file._previewUrl && String(file._previewUrl).startsWith("blob:")) {
      try { URL.revokeObjectURL(file._previewUrl) } catch {}
    }
    const currentPreview = previews[docType]
    if (currentPreview && String(currentPreview).startsWith("blob:")) {
      try { URL.revokeObjectURL(currentPreview) } catch {}
    }
    removeDocument(docType)
    setPreviews(prev => ({ ...prev, [docType]: null }))
    setUploadedDocs(prev => ({
      ...prev,
      [docType]: null
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    const isAnyUploading = Object.values(uploading).some(Boolean)
    if (isAnyUploading) {
      toast.error("Please wait until all image previews are ready")
      return
    }

    if (!documents.profilePhoto || !documents.aadharPhoto || !documents.panPhoto || !documents.drivingLicensePhoto) {
      toast.error("Please upload all required documents")
      return
    }

    const raw = sessionStorage.getItem("deliverySignupDetails")
    if (!raw) {
      toast.error("Session expired. Please start from Create Account.")
      navigate("/food/delivery/signup", { replace: true })
      return
    }

    let details
    try {
      details = JSON.parse(raw)
    } catch {
      toast.error("Invalid session. Please start from Create Account.")
      navigate("/food/delivery/signup", { replace: true })
      return
    }

    const formData = new FormData()
    formData.append("name", details.name || "")
    formData.append("phone", String(details.phone || "").replace(/\D/g, "").slice(0, 15))
    if (details.email) formData.append("email", String(details.email).trim())
    if (details.ref) formData.append("ref", String(details.ref).trim())
    if (details.countryCode) formData.append("countryCode", details.countryCode)
    if (details.address) formData.append("address", details.address)
    if (details.city) formData.append("city", details.city)
    if (details.state) formData.append("state", details.state)
    if (details.vehicleType) formData.append("vehicleType", details.vehicleType)
    if (details.vehicleName) formData.append("vehicleName", details.vehicleName)
    if (details.vehicleNumber) formData.append("vehicleNumber", details.vehicleNumber)
    if (details.drivingLicenseNumber) {
      formData.append("drivingLicenseNumber", details.drivingLicenseNumber)
      formData.append("documents[drivingLicense][number]", details.drivingLicenseNumber)
    }
    if (details.panNumber) formData.append("panNumber", details.panNumber)
    if (details.aadharNumber) formData.append("aadharNumber", details.aadharNumber)

    const appendDocumentFile = (fieldName, docValue) => {
      if (!docValue) return
      if (docValue instanceof File || docValue instanceof Blob) {
        formData.append(fieldName, docValue, docValue.name || `${fieldName}.jpg`)
      } else if (typeof docValue === 'string' && docValue.startsWith('data:')) {
        try {
          const converted = convertBase64ToFile(docValue, 'image/jpeg', fieldName)
          formData.append(fieldName, converted, `${fieldName}.jpg`)
        } catch {
          formData.append(fieldName, docValue)
        }
      } else if (docValue?.file instanceof File || docValue?.file instanceof Blob) {
        formData.append(fieldName, docValue.file, docValue.name || `${fieldName}.jpg`)
      }
    }

    appendDocumentFile("profilePhoto", documents.profilePhoto)
    appendDocumentFile("aadharPhoto", documents.aadharPhoto)
    appendDocumentFile("panPhoto", documents.panPhoto)
    appendDocumentFile("drivingLicensePhoto", documents.drivingLicensePhoto)

    // Non-blocking FCM token retrieval (max 200ms timeout)
    let fcmToken = null
    let platform = "web"
    try {
      if (typeof window !== "undefined") {
        if (window.flutter_inappwebview) {
          platform = "mobile"
          const handlerNames = ["getFcmToken", "getFCMToken", "getPushToken", "getFirebaseToken"]
          for (const handlerName of handlerNames) {
            try {
              const bridgePromise = window.flutter_inappwebview.callHandler(handlerName, { module: "delivery" })
              const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 200))
              const t = await Promise.race([bridgePromise, timeoutPromise])
              if (t && typeof t === "string" && t.length > 20) {
                fcmToken = t.trim()
                break
              }
            } catch {}
          }
        }
        if (!fcmToken) {
          fcmToken = localStorage.getItem("fcm_web_registered_token_delivery") || localStorage.getItem("delivery_fcm_token") || null
        }
      }
    } catch (e) {
      debugWarn("Failed to get FCM token during signup", e)
    }

    if (fcmToken) {
      formData.append("fcmToken", fcmToken)
      formData.append("platform", platform)
    }

    setIsSubmitting(true)

    try {
      const response = await deliveryAPI.register(formData)

      if (response?.data?.success) {
        sessionStorage.removeItem("deliverySignupDetails")
        sessionStorage.removeItem("deliverySignupDocs")
        sessionStorage.removeItem("deliveryAuthData")
        sessionStorage.removeItem("deliveryNeedsRegistration")
        clearOnboardingState()
        void cleanupDeliveryOnboardingIndexedDb().catch((error) => {
          debugWarn("Failed to cleanup onboarding IndexedDB", error)
        })
        
        clearModuleAuth("delivery")
        toast.success("Application submitted successfully! Please wait for admin approval.")
        navigateWithFallback("/food/delivery/login")
        return
      } else {
        throw new Error(response?.data?.message || "Registration failed")
      }
    } catch (error) {
      debugError("Error submitting registration:", error)
      const message = getFriendlyRegistrationError(error)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const isAnyUploading = documentTypes.some((docType) => Boolean(uploading[docType]))
  const hasAllDocuments = documentTypes.every((docType) => documents[docType])
  const disableSubmit = isSubmitting || isAnyUploading || !hasAllDocuments

  return (
    <div
      className="min-h-[100dvh] bg-gray-100 flex flex-col overflow-x-hidden overflow-y-auto overscroll-contain"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      {/* Sticky Header */}
      <div className="sticky top-0 z-30 bg-white px-4 py-3.5 flex items-center gap-4 border-b border-gray-200 shadow-2xs">
        <button
          onClick={goBack}
          type="button"
          className="p-2 hover:bg-gray-100 active:bg-gray-200 rounded-full transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5 text-gray-800" />
        </button>
        <h1 className="text-lg font-bold text-gray-900">Upload Documents</h1>
      </div>

      {/* Content */}
      <div
        className="flex-1 px-4 py-6 max-w-lg mx-auto w-full transition-all duration-300"
        style={{
          paddingBottom: isInputFocused
            ? "420px"
            : keyboardInset > 0
              ? `${keyboardInset + 120}px`
              : "140px",
          minHeight: "100%"
        }}
      >
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Document Verification</h2>
          <p className="text-sm text-gray-600">Please upload clear photos of your documents</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {DOCUMENT_FIELDS.map(({ docType, label }) => (
            <DocumentUploadCard
              key={docType}
              docType={docType}
              label={label}
              required
              uploadedName={uploadedDocs[docType]?.name}
              isUploading={Boolean(uploading[docType])}
              previewSrc={previews[docType] || getPreviewSrc(docType)}
              hasDocument={Boolean(documents[docType] || uploadedDocs[docType] || previews[docType])}
              controlsDisabled={Boolean(uploading[docType]) || isSubmitting}
              inputRef={(node) => {
                fileInputRefs.current[docType] = node
              }}
              onTakePhoto={() => handleTakeCameraPhoto(docType, label)}
              onPickGallery={() => handlePickFromGallery(docType)}
              onRemove={() => handleRemove(docType)}
              onFileSelected={(file) => handleFileSelect(docType, file)}
            />
          ))}

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={disableSubmit}
              className={`w-full py-4 rounded-xl font-bold text-white text-base shadow-lg transition-all active:scale-[0.98] ${disableSubmit
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-[#00B761] hover:bg-[#00A055] shadow-green-600/20"
                }`}
            >
              {isSubmitting ? "Submitting..." : isAnyUploading ? "Preparing images..." : "Complete Signup"}
            </button>
          </div>

          {/* Extra Scroll Space when typing on mobile keyboard */}
          {isInputFocused && (
            <div className="h-44 w-full pointer-events-none" aria-hidden="true" />
          )}
        </form>
      </div>
    </div>
  )
}

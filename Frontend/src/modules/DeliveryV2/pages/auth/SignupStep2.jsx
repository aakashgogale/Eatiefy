import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Upload, X, Check, Camera, Image as ImageIcon, RefreshCw } from "lucide-react"
import { deliveryAPI } from "@food/api"
import { toast } from "sonner"
import {
  getUserFacingApiError,
  isAlreadyExistsError,
  showUserFacingApiError,
} from "@/shared/utils/apiError"
import { openCamera, openGallery, ensureUploadableImageFile } from "@food/utils/imageUploadUtils"
import { prepareUploadFile } from "@/shared/utils/imageCompressor"
import { getDeliveryRegistrationToken, clearDeliveryRegistrationToken } from "@food/utils/auth"
import useDeliveryOnboardingExitGuard from "../../hooks/useDeliveryOnboardingExitGuard"
import {
  DELIVERY_SIGNUP_DOC_TYPES,
  clearSignupDocumentsFromDB,
  deleteSignupDocumentFromDB,
  getAllSignupDocumentsFromDB,
  loadSignupDocumentPreviews,
  prepareSignupDocumentFile,
  saveSignupDocumentToDB,
} from "../../utils/deliveryOnboardingStorage"
import {
  collectFcmTokenForSignup,
  finalizeDeliveryPendingSubmission,
  prefetchModuleFcmToken,
} from "@food/utils/firebaseMessaging"

const debugError = (...args) => { }

// Matches the server's per-file limit. Phone-side compression is best effort only:
// on iOS WebViews it can fail for large camera photos, and rejecting the original
// then made the card fall back to empty after "Processing…". The server resizes.
const MAX_PICKED_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_UPLOAD_IMAGE_BYTES = 25 * 1024 * 1024

const NO_UPLOAD_SESSION = "NO_UPLOAD_SESSION"

const getDocumentUploadErrorMessage = (error) => {
  if (error?.code === NO_UPLOAD_SESSION) {
    return "Verification session expired. Verify your phone again, or the photo will be sent when you submit."
  }
  const status = Number(error?.response?.status || 0)
  if (status === 413) return "This photo is too large. Please retake it or choose a smaller photo."
  if (!error?.response && (error?.code === "ECONNABORTED" || error?.code === "ERR_NETWORK")) {
    return "Network problem while uploading. Check your connection and retry."
  }
  return getUserFacingApiError(error, "Upload failed. Please retry.")
}

const DOC_LABELS = {
  profilePhoto: "Profile Photo",
  aadharPhoto: "Aadhar Card Photo",
  panPhoto: "PAN Card Photo",
  drivingLicensePhoto: "Driving License Photo",
}

const createEmptyDocState = (value = null) =>
  DELIVERY_SIGNUP_DOC_TYPES.reduce((acc, docType) => {
    acc[docType] = value
    return acc
  }, {})

const hasDeliveryAuthSession = () =>
  typeof localStorage !== "undefined" &&
  localStorage.getItem("delivery_authenticated") === "true" &&
  Boolean(localStorage.getItem("delivery_accessToken"))

export default function SignupStep2() {
  const navigate = useNavigate()
  const { handleBack } = useDeliveryOnboardingExitGuard("documents")
  const fileInputRefs = useRef({
    profilePhoto: null,
    aadharPhoto: null,
    panPhoto: null,
    drivingLicensePhoto: null,
  })
  // Local blob previews, used only until the server copy exists.
  const previewUrlsRef = useRef(createEmptyDocState())
  const [previewUrls, setPreviewUrls] = useState(createEmptyDocState)
  // URLs of documents stored on the server (source of truth after refresh).
  const [serverUrls, setServerUrls] = useState(() => createEmptyDocState(""))
  const serverUrlsRef = useRef(createEmptyDocState(""))
  // docType -> upload progress (0-100) while uploading.
  const [uploading, setUploading] = useState({})
  const [uploadErrors, setUploadErrors] = useState({})
  const pendingFilesRef = useRef({})
  // docType -> true while a pick is being processed/uploaded (synchronous guard).
  const uploadInFlightRef = useRef({})
  // docType -> true when the stored image URL could not be displayed.
  const [serverImageFailed, setServerImageFailed] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  // True only while previously uploaded documents are being restored on load.
  const [restoringDocs, setRestoringDocs] = useState(true)

  useEffect(() => {
    prefetchModuleFcmToken("delivery")
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" })
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }, [])

  const setServerUrl = (docType, url) => {
    serverUrlsRef.current = { ...serverUrlsRef.current, [docType]: url || "" }
    setServerUrls((prev) => ({ ...prev, [docType]: url || "" }))
  }

  const setLocalPreview = (docType, url) => {
    const previous = previewUrlsRef.current[docType]
    if (previous && previous !== url) {
      try {
        URL.revokeObjectURL(previous)
      } catch {
        // Ignore revoke errors.
      }
    }
    previewUrlsRef.current = { ...previewUrlsRef.current, [docType]: url }
    setPreviewUrls((prev) => ({ ...prev, [docType]: url }))
  }

  /**
   * Sends one document to server storage. New partners use the signup draft
   * (registration token from OTP); a signed-in partner completing a profile
   * saves straight onto their account. Returns the stored URL, or null when no
   * server session exists (the file is then submitted with the form).
   */
  const uploadDocumentToServer = async (docType, file) => {
    const onUploadProgress = (event) => {
      if (!event?.total) return
      const progress = Math.min(99, Math.round((event.loaded / event.total) * 100))
      setUploading((prev) => (prev[docType] === undefined ? prev : { ...prev, [docType]: progress }))
    }

    const registrationToken = getDeliveryRegistrationToken()
    if (registrationToken) {
      try {
        const res = await deliveryAPI.uploadOnboardingDocument(registrationToken, docType, file, { onUploadProgress })
        const url = res?.data?.data?.url
        if (!url) throw new Error("The server did not return the document URL")
        return url
      } catch (error) {
        if (error?.response?.status === 401) clearDeliveryRegistrationToken()
        throw error
      }
    }

    if (hasDeliveryAuthSession()) {
      const formData = new FormData()
      formData.append(docType, file)
      const res = await deliveryAPI.updateProfileMultipart(formData, { onUploadProgress })
      const url = res?.data?.data?.partner?.[docType]
      if (!url) throw new Error("The server did not return the document URL")
      return url
    }

    // No way to reach server storage (e.g. OTP verified before registration
    // tokens existed, or the token expired). Surface it instead of quietly
    // keeping the photo on the device only.
    const sessionError = new Error("No upload session")
    sessionError.code = NO_UPLOAD_SESSION
    throw sessionError
  }

  const clearUploading = (docType) => {
    uploadInFlightRef.current = { ...uploadInFlightRef.current, [docType]: false }
    setUploading((prev) => {
      if (prev[docType] === undefined) return prev
      const next = { ...prev }
      delete next[docType]
      return next
    })
  }

  const startUpload = async (docType, file, { silent = false } = {}) => {
    // One upload per document at a time (double taps, retry while uploading).
    if (uploadInFlightRef.current[docType] && pendingFilesRef.current[docType] === file) return
    uploadInFlightRef.current = { ...uploadInFlightRef.current, [docType]: true }
    pendingFilesRef.current = { ...pendingFilesRef.current, [docType]: file }
    setUploadErrors((prev) => ({ ...prev, [docType]: "" }))
    setUploading((prev) => ({ ...prev, [docType]: 0 }))
    try {
      const url = await uploadDocumentToServer(docType, file)
      // A newer photo replaced this one while it was uploading.
      if (pendingFilesRef.current[docType] !== file) return
      setServerUrl(docType, url)
      setServerImageFailed((prev) => ({ ...prev, [docType]: false }))
      // The device copy is no longer needed; the local preview is released once
      // the server image has actually loaded (see onLoad), so nothing flickers away.
      await deleteSignupDocumentFromDB(docType)
    } catch (error) {
      if (pendingFilesRef.current[docType] !== file) return
      debugError("Document upload failed:", error)
      const message = getDocumentUploadErrorMessage(error)
      setUploadErrors((prev) => ({ ...prev, [docType]: message }))
      if (!silent) toast.error(`${DOC_LABELS[docType]}: ${message}`)
    } finally {
      if (pendingFilesRef.current[docType] === file) {
        clearUploading(docType)
      }
    }
  }

  useEffect(() => {
    let cancelled = false

    const hydrateDocuments = async () => {
      try {
        // Server copies first: they survive refresh, re-login and a new device.
        const registrationToken = getDeliveryRegistrationToken()
        let serverUploads = null
        if (registrationToken) {
          try {
            const res = await deliveryAPI.getOnboardingUploads(registrationToken)
            serverUploads = res?.data?.data?.uploads || null
          } catch (error) {
            if (error?.response?.status === 401) clearDeliveryRegistrationToken()
            debugError("Failed to load uploaded documents:", error)
          }
        } else if (hasDeliveryAuthSession()) {
          // Signed-in partner completing a profile: documents live on the account.
          try {
            const res = await deliveryAPI.refreshMe()
            const partner = res?.data?.data?.user ?? res?.data?.data
            if (partner) {
              serverUploads = DELIVERY_SIGNUP_DOC_TYPES.reduce((acc, docType) => {
                acc[docType] = typeof partner[docType] === "string" ? partner[docType] : ""
                return acc
              }, {})
            }
          } catch (error) {
            debugError("Failed to load account documents:", error)
          }
        }
        if (cancelled) return
        if (serverUploads) {
          DELIVERY_SIGNUP_DOC_TYPES.forEach((docType) => setServerUrl(docType, serverUploads[docType]))
        }

        // Photos still on the device never reached the server (offline, app closed
        // mid-upload). Show them and retry the upload.
        const previews = await loadSignupDocumentPreviews()
        if (cancelled) {
          Object.values(previews).forEach((url) => url && URL.revokeObjectURL(url))
          return
        }
        const localFiles = await getAllSignupDocumentsFromDB()
        DELIVERY_SIGNUP_DOC_TYPES.forEach((docType) => {
          if (!previews[docType]) return
          setLocalPreview(docType, previews[docType])
          if (localFiles[docType]) {
            void startUpload(docType, localFiles[docType], { silent: true })
          }
        })
      } catch (error) {
        debugError("Failed to hydrate signup documents:", error)
      } finally {
        if (!cancelled) setRestoringDocs(false)
      }
    }

    void hydrateDocuments()

    return () => {
      cancelled = true
      pendingFilesRef.current = {}
      Object.values(previewUrlsRef.current).forEach((url) => {
        if (url) {
          try {
            URL.revokeObjectURL(url)
          } catch {
            // Ignore revoke errors.
          }
        }
      })
      previewUrlsRef.current = createEmptyDocState()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const getPreviewSrc = (docType) => {
    const serverUrl = serverUrls[docType]
    const localUrl = previewUrls[docType]
    // Keep the on-device preview visible until the stored image is loadable.
    if (serverUrl && serverImageFailed[docType] && localUrl) return localUrl
    return serverUrl || localUrl || null
  }

  const hasUploadedDoc = (docType) => Boolean(serverUrls[docType] || previewUrls[docType])

  const handlePreviewLoad = (docType, src) => {
    if (src && src === serverUrlsRef.current[docType] && previewUrlsRef.current[docType]) {
      setLocalPreview(docType, null)
    }
  }

  const handlePreviewError = (docType, src) => {
    if (src && src === serverUrlsRef.current[docType]) {
      setServerImageFailed((prev) => (prev[docType] ? prev : { ...prev, [docType]: true }))
    }
  }

  const handleFileSelect = async (docType, pickedFile) => {
    if (!pickedFile) return
    // Ignore a second pick while this document is still being processed/uploaded.
    if (uploadInFlightRef.current[docType]) return

    const { file, error } = ensureUploadableImageFile(pickedFile, { maxBytes: MAX_PICKED_IMAGE_BYTES })
    if (error) {
      toast.error(error)
      return
    }

    uploadInFlightRef.current = { ...uploadInFlightRef.current, [docType]: true }
    setUploadErrors((prev) => ({ ...prev, [docType]: "" }))
    setServerImageFailed((prev) => ({ ...prev, [docType]: false }))
    // Show the picked photo straight away instead of a "Processing…" placeholder.
    setLocalPreview(docType, URL.createObjectURL(file))
    setUploading((prev) => ({ ...prev, [docType]: 0 }))

    let preparedFile = file
    try {
      preparedFile = await prepareSignupDocumentFile(file)
    } catch (err) {
      debugError("Failed to process document image:", err)
      preparedFile = file
    }

    if (preparedFile.size > MAX_UPLOAD_IMAGE_BYTES) {
      clearUploading(docType)
      const message = "This photo is too large. Please retake it or choose a smaller photo."
      setUploadErrors((prev) => ({ ...prev, [docType]: message }))
      toast.error(message)
      return
    }

    // Device copy is only a safety net until the server upload succeeds.
    void saveSignupDocumentToDB(docType, preparedFile)
    uploadInFlightRef.current = { ...uploadInFlightRef.current, [docType]: false }
    await startUpload(docType, preparedFile)
  }

  const handleRetry = async (docType) => {
    const localFiles = await getAllSignupDocumentsFromDB()
    const file = pendingFilesRef.current[docType] || localFiles[docType]
    if (!file) {
      toast.error("Please select the photo again.")
      return
    }
    await startUpload(docType, file)
  }

  // compress: false — the picker's extra canvas pass had no timeout and could stall
  // on large iPhone photos before this screen even received the file.
  // prepareSignupDocumentFile compresses once, with a timeout.
  const handleTakeCameraPhoto = (docType) => {
    openCamera({
      onSelectFile: (file) => handleFileSelect(docType, file),
      fileNamePrefix: `signup-${docType}`,
      compress: false,
    })
  }

  const handlePickFromGallery = (docType) => {
    openGallery({
      onSelectFile: (file) => handleFileSelect(docType, file),
      fileNamePrefix: `signup-${docType}`,
      fallbackInputRef: { current: fileInputRefs.current[docType] },
      compress: false,
    })
  }

  const handleRemove = async (docType) => {
    const serverUrl = serverUrlsRef.current[docType]
    const registrationToken = getDeliveryRegistrationToken()

    if (serverUrl && registrationToken) {
      try {
        await deliveryAPI.removeOnboardingDocument(registrationToken, docType, serverUrl)
      } catch (error) {
        showUserFacingApiError(error, "Could not remove the photo. Please try again.")
        return
      }
    }

    pendingFilesRef.current = { ...pendingFilesRef.current, [docType]: undefined }
    clearUploading(docType)
    setUploadErrors((prev) => ({ ...prev, [docType]: "" }))
    setServerImageFailed((prev) => ({ ...prev, [docType]: false }))
    await deleteSignupDocumentFromDB(docType)
    setServerUrl(docType, "")
    setLocalPreview(docType, null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (Object.keys(uploading).length > 0) {
      toast.info("Please wait for your documents to finish uploading")
      return
    }

    const resolvedDocuments = await getAllSignupDocumentsFromDB()
    const currentServerUrls = serverUrlsRef.current

    const missingDocument = DELIVERY_SIGNUP_DOC_TYPES.find(
      (docType) => !currentServerUrls[docType] && !resolvedDocuments[docType],
    )
    if (missingDocument) {
      toast.error(`Please upload your ${DOC_LABELS[missingDocument]}`)
      return
    }

    const raw = sessionStorage.getItem("deliverySignupDetails")
    if (!raw) {
      navigate("/food/delivery/signup", { replace: true })
      return
    }

    let details
    try {
      details = JSON.parse(raw)
    } catch {
      navigate("/food/delivery/signup", { replace: true })
      return
    }

    setIsSubmitting(true)

    const hasDeliveryAuth = hasDeliveryAuthSession()
    const shouldRegister =
      sessionStorage.getItem("deliveryNeedsRegistration") === "true" ||
      !hasDeliveryAuth

    let fcmToken = null
    let platform = "web"

    try {
      const fcm = await collectFcmTokenForSignup("delivery")
      fcmToken = fcm?.fcmToken || null
      platform = fcm?.platform || "web"

      const formData = new FormData()
      formData.append("name", details.name || "")
      formData.append("phone", String(details.phone || "").replace(/\D/g, "").slice(0, 15))
      formData.append("email", String(details.email || "").trim().toLowerCase())
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

      // Server-stored documents are referenced by URL (registration) or are already
      // on the account (profile completion); only device-only photos go as files.
      for (const docType of DELIVERY_SIGNUP_DOC_TYPES) {
        const serverUrl = currentServerUrls[docType]
        if (serverUrl) {
          if (shouldRegister) formData.append(`${docType}Url`, serverUrl)
          continue
        }
        formData.append(
          docType,
          await prepareUploadFile(
            resolvedDocuments[docType],
            docType === "profilePhoto" ? { preset: "profile" } : undefined,
          ),
        )
      }

      if (fcmToken) {
        formData.append("fcmToken", fcmToken)
        formData.append("platform", platform)
      }

      const response = shouldRegister
        ? await deliveryAPI.register(formData)
        : await deliveryAPI.completeProfile(formData)

      if (response?.data?.success) {
        sessionStorage.removeItem("deliverySignupDetails")
        sessionStorage.removeItem("deliverySignupDocs")
        await clearSignupDocumentsFromDB()
        if (shouldRegister) {
          clearDeliveryRegistrationToken()
          sessionStorage.removeItem("deliveryNeedsRegistration")
          const phone = String(details.phone || "").replace(/\D/g, "").slice(-10)
          finalizeDeliveryPendingSubmission(navigate, phone, { fcmToken, platform })
        } else {
          toast.success("Profile submitted. Waiting for admin approval.")
          setTimeout(() => navigate("/food/delivery", { replace: true }), 1500)
        }
      }
    } catch (error) {
      debugError("Error submitting registration:", error)
      const errorMsg = getUserFacingApiError(
        error,
        "Registration failed. Please try again.",
      )
      // Already registered / pending — send user to verification screen instead of raw API error.
      if (isAlreadyExistsError(errorMsg) || isAlreadyExistsError(error)) {
        const phone = String(details.phone || "").replace(/\D/g, "").slice(-10)
        sessionStorage.removeItem("deliveryNeedsRegistration")
        finalizeDeliveryPendingSubmission(navigate, phone, { fcmToken, platform })
        return
      }
      showUserFacingApiError(error, "Registration failed. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const DocumentUpload = ({ docType, label, required = true }) => {
    const uploadProgress = uploading[docType]
    const isUploading = uploadProgress !== undefined
    const uploaded = hasUploadedDoc(docType)
    const isOnServer = Boolean(serverUrls[docType])
    const uploadError = uploadErrors[docType]

    return (
      <div className="bg-white rounded-lg p-4 border border-gray-200">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {label} {required && <span className="text-red-500">*</span>}
        </label>

        {!uploaded && restoringDocs ? (
          /* Restoring a previously uploaded photo — show that it is coming back
             rather than an empty "upload" box the user might tap again. */
          <div className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-gray-200 rounded-lg bg-gray-50 gap-2">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-green-600" />
            <p className="text-xs font-medium text-gray-500">Restoring your upload…</p>
          </div>
        ) : uploaded ? (
          <div className="relative">
            <img
              src={getPreviewSrc(docType)}
              alt={label}
              className="w-full h-48 object-cover rounded-lg bg-gray-100"
              onLoad={(e) => handlePreviewLoad(docType, e.currentTarget.getAttribute("src"))}
              onError={(e) => handlePreviewError(docType, e.currentTarget.getAttribute("src"))}
            />
            {!isUploading && (
              <button
                type="button"
                onClick={() => handleRemove(docType)}
                className="absolute top-2 right-2 bg-red-500 text-white p-2 rounded-full hover:bg-red-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            {isUploading ? (
              <div className="absolute inset-0 rounded-lg bg-black/45 flex flex-col items-center justify-center gap-2 text-white">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/30 border-t-white" />
                <p className="text-sm font-semibold">
                  Uploading{uploadProgress > 0 ? ` ${uploadProgress}%` : "..."}
                </p>
              </div>
            ) : uploadError ? (
              <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2 rounded-lg bg-black/75 px-3 py-2 text-white">
                <span className="text-xs font-medium line-clamp-2">{uploadError}</span>
                <button
                  type="button"
                  onClick={() => handleRetry(docType)}
                  className="shrink-0 flex items-center gap-1 rounded-md bg-white px-2.5 py-1.5 text-xs font-bold text-gray-900 active:scale-95"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retry
                </button>
              </div>
            ) : (
              <div
                className="absolute bottom-2 left-2 text-white px-2.5 py-1 rounded-full flex items-center gap-1 text-xs font-semibold shadow-md"
                style={{ backgroundColor: isOnServer ? "#00B761" : "#D97706" }}
              >
                <Check className="w-3.5 h-3.5" />
                <span>{isOnServer ? "Uploaded" : "Saved on device"}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-gray-300 rounded-lg hover:border-green-500 transition-colors px-4">
            <div className="flex flex-col items-center justify-center pt-5 pb-3">
              {isUploading ? (
                <>
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-transparent mb-2" style={{ borderBottomColor: "#00B761" }}></div>
                  <p className="text-sm text-gray-500">Processing...</p>
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-gray-400 mb-2" />
                  <p className="text-sm text-gray-500 mb-1">Upload document</p>
                  <p className="text-xs text-gray-400">JPG, PNG or WebP photo</p>
                </>
              )}
            </div>

            {!isUploading && (
              <div className="w-full grid grid-cols-2 gap-2 pb-4">
                <button
                  type="button"
                  onClick={() => handleTakeCameraPhoto(docType)}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gray-900 text-white text-xs font-bold cursor-pointer hover:bg-black transition-all active:scale-95"
                >
                  <Camera className="w-4 h-4" />
                  <span>Take Photo</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePickFromGallery(docType)}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-[#00B761] text-white text-xs font-bold cursor-pointer hover:bg-[#00A055] transition-all active:scale-95"
                >
                  <ImageIcon className="w-4 h-4" />
                  <span>Gallery</span>
                </button>
              </div>
            )}

            <input
              ref={(node) => {
                fileInputRefs.current[docType] = node
              }}
              type="file"
              className="hidden"
              accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
              onClick={(e) => {
                e.target.value = ""
              }}
              onChange={(e) => {
                const selectedFile = e.target.files[0]
                if (selectedFile) {
                  handleFileSelect(docType, selectedFile)
                }
                e.target.value = ""
              }}
              disabled={isUploading}
            />
          </div>
        )}
      </div>
    )
  }

  const allDocumentsUploaded = DELIVERY_SIGNUP_DOC_TYPES.every((docType) => hasUploadedDoc(docType))
  const anyUploading = Object.keys(uploading).length > 0

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="sticky top-0 z-30 bg-white px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] flex items-center gap-4 border-b border-gray-200">
        <button
          onClick={handleBack}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-medium">Upload Documents</h1>
      </div>

      <div className="px-4 py-6">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Document Verification</h2>
          <p className="text-sm text-gray-600">Please upload clear photos of your documents</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <DocumentUpload docType="profilePhoto" label="Profile Photo" required={true} />
          <DocumentUpload docType="aadharPhoto" label="Aadhar Card Photo" required={true} />
          <DocumentUpload docType="panPhoto" label="PAN Card Photo" required={true} />
          <DocumentUpload docType="drivingLicensePhoto" label="Driving License Photo" required={true} />

          <button
            type="submit"
            disabled={isSubmitting || !allDocumentsUploaded || anyUploading}
            className={`w-full py-4 rounded-lg font-bold text-white text-base transition-all mt-6 active:scale-[0.98] ${isSubmitting || !allDocumentsUploaded || anyUploading
              ? "bg-gray-400 cursor-not-allowed shadow-none"
              : "bg-gradient-to-r from-[#0E4B9C] to-[#021024] hover:from-[#1157b5] hover:to-[#041630] shadow-[0_8px_20px_rgba(14,75,156,0.3)]"
              }`}
          >
            {isSubmitting ? "Submitting..." : anyUploading ? "Uploading documents..." : "Complete Signup"}
          </button>
        </form>
      </div>
    </div>
  )
}

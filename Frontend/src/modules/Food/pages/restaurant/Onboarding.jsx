import { useCallback, useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Input } from "@food/components/ui/input"
import { Button } from "@food/components/ui/button"
import { Label } from "@food/components/ui/label"
import { Image as ImageIcon, Upload, Clock, Calendar as CalendarIcon, Sparkles, X, LogOut, FileText, ShoppingBag, ArrowLeft } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@food/components/ui/popover"
import { Calendar } from "@food/components/ui/calendar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@food/components/ui/select"
import { restaurantAPI, zoneAPI, uploadAPI, api } from "@food/api"
import { MobileTimePicker } from "@mui/x-date-pickers/MobileTimePicker"
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider"
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns"
import { determineStepToShow, clearOnboardingFromLocalStorage, clearAllFilesFromDB, hasRestaurantStep1Progress } from "@food/utils/onboardingUtils"
import { toast } from "sonner"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { getGoogleMapsApiKey } from "@food/utils/googleMapsApiKey"
import { clearModuleAuth, clearAuthData, isModuleAuthenticated, getModuleToken } from "@food/utils/auth"
import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { prepareUploadFile, prepareUploadFiles } from "@/shared/utils/imageCompressor"
import { EMAIL_REGEX } from "@/shared/utils/emailValidation"
import { OnboardingSkeleton } from "@food/components/ui/loading-skeletons"
import OnboardingExitModal from "@/shared/components/OnboardingExitModal"
import useOnboardingExitGuard from "@/shared/hooks/useOnboardingExitGuard"
import { collectFcmTokenForSignup, persistModuleFcmToken, syncPendingPartnerFcmQuick, clearOnboardingFcmLocal, prefetchModuleFcmToken } from "@food/utils/firebaseMessaging"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

const normalizePhoneDigits = (value) => {
  const digits = String(value || "").replace(/\D/g, "")
  return digits.slice(-10)
}

async function finalizeRestaurantPendingSubmission(navigate, phone, fcmOptions = {}) {
  const { fcmToken, platform } = fcmOptions
  const normalizedPhone = normalizePhoneDigits(phone || "")

  try {
    const userStr = localStorage.getItem("restaurant_user")
    if (userStr) {
      const user = JSON.parse(userStr)
      user.status = "pending"
      localStorage.setItem("restaurant_user", JSON.stringify(user))
    }
  } catch {}

  if (normalizedPhone) {
    localStorage.setItem("restaurant_pendingPhone", normalizedPhone)
  }
  localStorage.setItem("restaurant_pendingStatus", "pending")
  localStorage.removeItem("restaurant_pendingMessage")

  try {
    syncPendingPartnerFcmQuick("restaurant", normalizedPhone, { fcmToken, platform })
  } catch {}

  if (localStorage.getItem("restaurant_accessToken")) {
    try {
      persistModuleFcmToken("restaurant", { fcmToken, platform }).catch(() => {})
    } catch {}
  }

  navigate("/food/restaurant/pending-verification", {
    replace: true,
    state: { phone: normalizedPhone },
  })
}


const daysOfWeek = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const ONBOARDING_STORAGE_KEY = "restaurant_onboarding_data"
const PAN_NUMBER_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const GST_NUMBER_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const FSSAI_NUMBER_REGEX = /^\d{14}$/
const BANK_ACCOUNT_NUMBER_REGEX = /^\d{9,18}$/
const IFSC_CODE_REGEX = /^[A-Z0-9]{11}$/
const OWNER_NAME_REGEX = /^[A-Za-z ]+$/
const ACCOUNT_HOLDER_NAME_REGEX = /^[A-Za-z ]+$/
const GST_LEGAL_NAME_REGEX = /^[A-Za-z ]+$/
const LOCAL_IMAGE_FILE_ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.heif"
const GALLERY_IMAGE_ACCEPT =
  ".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif"
let onboardingFileCache = {
  step2: {
    menuImages: [],
    profileImage: null,
  },
  step3: {
    panImage: null,
    gstImage: null,
    fssaiImage: null,
  },
}

// IndexedDB helpers for persistent file storage
const ONBOARDING_FILES_DB = "RestaurantOnboardingFiles"
const FILES_STORE = "files"

const openOnboardingFilesDB = () => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("IndexedDB connection timeout"))
    }, 2000)

    try {
      if (typeof indexedDB === "undefined") {
        clearTimeout(timeout)
        return reject(new Error("IndexedDB not supported"))
      }
      const request = indexedDB.open(ONBOARDING_FILES_DB, 1)
      request.onupgradeneeded = (e) => {
        const db = e.target.result
        if (!db.objectStoreNames.contains(FILES_STORE)) {
          db.createObjectStore(FILES_STORE)
        }
      }
      request.onsuccess = (e) => {
        clearTimeout(timeout)
        resolve(e.target.result)
      }
      request.onerror = (e) => {
        clearTimeout(timeout)
        reject(e.target.error)
      }
      request.onblocked = () => {
        clearTimeout(timeout)
        reject(new Error("IndexedDB blocked"))
      }
    } catch (err) {
      clearTimeout(timeout)
      reject(err)
    }
  })
}

const saveFileToDB = async (key, file) => {
  if (!file || !isUploadableFile(file)) return
  try {
    const db = await openOnboardingFilesDB()
    const tx = db.transaction(FILES_STORE, "readwrite")
    tx.objectStore(FILES_STORE).put(file, key)
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => reject(tx.error || new Error("IndexedDB write transaction failed"))
      tx.onabort = () => reject(tx.error || new Error("IndexedDB write transaction aborted"))
    })
  } catch (err) {
    debugError("IndexedDB save failed:", err)
  }
}

const getFileFromDB = async (key) => {
  try {
    const db = await openOnboardingFilesDB()
    const tx = db.transaction(FILES_STORE, "readonly")
    const request = tx.objectStore(FILES_STORE).get(key)
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    })
  } catch (err) {
    debugError("IndexedDB load failed:", err)
    return null
  }
}

const deleteFileFromDB = async (key) => {
  try {
    const db = await openOnboardingFilesDB()
    const tx = db.transaction(FILES_STORE, "readwrite")
    tx.objectStore(FILES_STORE).delete(key)
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => reject(tx.error || new Error("IndexedDB delete transaction failed"))
      tx.onabort = () => reject(tx.error || new Error("IndexedDB delete transaction aborted"))
    })
  } catch (err) {
    debugError("IndexedDB delete failed:", err)
  }
}

const getUploadableMenuFiles = (menuImages = []) =>
  (Array.isArray(menuImages) ? menuImages : [])
    .filter((img) => isUploadableFile(img))
    .slice(0, 10)

const persistMenuImagesToDB = async (menuImages = []) => {
  const uploadableMenuFiles = getUploadableMenuFiles(menuImages)
  for (let i = 0; i < 10; i++) {
    const file = uploadableMenuFiles[i]
    if (file) {
      await saveFileToDB(`menuImage_${i}`, file)
    } else {
      await deleteFileFromDB(`menuImage_${i}`)
    }
  }
}


const isUploadableFile = (value) => {
  if (!value || typeof value !== "object") return false

  if (typeof File !== "undefined" && value instanceof File) return true
  if (typeof Blob !== "undefined" && value instanceof Blob) return true

  return (
    typeof value.size === "number" &&
    (typeof value.slice === "function" || typeof value.arrayBuffer === "function")
  )
}

const normalizePincode = (value) => String(value || "").replace(/\D/g, "").slice(0, 6)


const getVerifiedPhoneFromStoredRestaurant = () => {
  try {
    const pending = localStorage.getItem("restaurant_pendingPhone")
    if (pending && pending.trim()) {
      return pending.trim()
    }

    const storedUser = localStorage.getItem("restaurant_user")
    if (!storedUser) return ""
    const user = JSON.parse(storedUser)
    const candidates = [
      user?.ownerPhone,
      user?.primaryContactNumber,
      user?.phone,
      user?.phoneNumber,
      user?.mobile,
      user?.contactNumber,
      user?.contact?.phone,
      user?.owner?.phone,
      user?.restaurant?.phone,
    ]
    const phone = candidates.find((value) => typeof value === "string" && value.trim())
    return phone ? phone.trim() : ""
  } catch {
    return ""
  }
}

const normalizeEmail = (val) => {
  let email = String(val || "").toLowerCase().trim()
  // Auto-correct common Gmail typos
  email = email.replace(/@(gnail|gamil|gimail|gnil)\.com$/i, "@gmail.com")
  return email
}

const normalizeAccountTypeValue = (value) => {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized === "saving" || normalized === "savings") return "Saving"
  if (normalized === "current") return "Current"
  return ""
}

const formatNameToCapital = (str) => {
  if (!str) return ""
  return str.split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ")
}

const normalizeIFSC = (val) => String(val || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11)
const normalizePAN = (val) => String(val || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)
const normalizeGST = (val) => String(val || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15)
const normalizeBankAcc = (val) => String(val || "").replace(/\D/g, "").slice(0, 18)

const getTodayLocalYMD = () => formatDateToLocalYMD(new Date())

// Helper functions for localStorage
const saveOnboardingToLocalStorage = (step1, step2, step3, currentStep) => {
  try {
    // Persist only stable URL-based values. File/Blob objects are not serializable and
    // restoring metadata-only placeholders breaks preview/upload flows.
    const serializableStep2 = {
      ...step2,
      menuImages: (step2.menuImages || []).filter(
        (img) => !isUploadableFile(img) && (img?.url || (typeof img === "string" && img.trim()))
      ),
      profileImage:
        !isUploadableFile(step2.profileImage) &&
        (step2.profileImage?.url || (typeof step2.profileImage === "string" && step2.profileImage.trim()))
          ? step2.profileImage
          : null,
    }

    const serializableStep3 = {
      ...step3,
      panImage:
        !isUploadableFile(step3.panImage) &&
        (step3.panImage?.url || (typeof step3.panImage === "string" && step3.panImage.trim()))
          ? step3.panImage
          : null,
      gstImage:
        !isUploadableFile(step3.gstImage) &&
        (step3.gstImage?.url || (typeof step3.gstImage === "string" && step3.gstImage.trim()))
          ? step3.gstImage
          : null,
      fssaiImage:
        !isUploadableFile(step3.fssaiImage) &&
        (step3.fssaiImage?.url || (typeof step3.fssaiImage === "string" && step3.fssaiImage.trim()))
          ? step3.fssaiImage
          : null,
    }

    const dataToSave = {
      step1,
      step2: serializableStep2,
      step3: serializableStep3,
      currentStep,
      timestamp: Date.now(),
    }

    const userStr = localStorage.getItem("restaurant_user")
    let key = ONBOARDING_STORAGE_KEY
    if (userStr) {
      const user = JSON.parse(userStr)
      const userId = user._id || user.id
      if (userId) key = `restaurant_onboarding_data_${userId}`
    }
    localStorage.setItem(key, JSON.stringify(dataToSave))
  } catch (error) {
    debugError("Failed to save onboarding data to localStorage:", error)
  }
}

const loadOnboardingFromLocalStorage = () => {
  try {
    const userStr = localStorage.getItem("restaurant_user")
    let key = ONBOARDING_STORAGE_KEY
    if (userStr) {
      const user = JSON.parse(userStr)
      const userId = user._id || user.id
      if (userId) key = `restaurant_onboarding_data_${userId}`
    }
    const stored = localStorage.getItem(key)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (error) {
    debugError("Failed to load onboarding data from localStorage:", error)
  }
  return null
}


const syncOnboardingFileCache = (step2, step3) => {
  onboardingFileCache = {
    step2: {
      menuImages: (step2?.menuImages || []).filter((img) => isUploadableFile(img)),
      profileImage: isUploadableFile(step2?.profileImage) ? step2.profileImage : null,
    },
    step3: {
      panImage: isUploadableFile(step3?.panImage) ? step3.panImage : null,
      gstImage: isUploadableFile(step3?.gstImage) ? step3.gstImage : null,
      fssaiImage: isUploadableFile(step3?.fssaiImage) ? step3.fssaiImage : null,
    },
  }
}

const clearOnboardingFileCache = () => {
  onboardingFileCache = {
    step2: {
      menuImages: [],
      profileImage: null,
    },
    step3: {
      panImage: null,
      gstImage: null,
      fssaiImage: null,
    },
  }
}

// Helper function to convert "HH:mm" string to Date object
const stringToTime = (timeString) => {
  const normalized = normalizeTimeValue(timeString)
  if (!normalized || !normalized.includes(":")) {
    return null
  }
  const [hours, minutes] = normalized.split(":").map(Number)
  return new Date(2000, 0, 1, hours || 0, minutes || 0)
}

// Helper function to convert Date object to "HH:mm" string
const timeToString = (date) => {
  if (!date) return ""
  const hours = date.getHours().toString().padStart(2, "0")
  const minutes = date.getMinutes().toString().padStart(2, "0")
  return `${hours}:${minutes}`
}

const normalizeTimeValue = (value) => {
  if (!value) return ""

  const raw = String(value).trim()
  if (!raw) return ""

  const to24Hour = (h, m, period) => {
    let hours = Number(h)
    const minutes = Number(m)
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return ""
    if (minutes < 0 || minutes > 59) return ""
    const p = String(period || "").toUpperCase()
    if (p === "AM") {
      if (hours === 12) hours = 0
    } else if (p === "PM") {
      if (hours !== 12) hours += 12
    }
    if (hours < 0 || hours > 23) return ""
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
  }

  // Already in HH:mm format
  if (/^\d{2}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(":").map(Number)
    if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
      return ""
    }
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
  }

  // Handle H:mm by zero-padding hour
  if (/^\d{1}:\d{2}$/.test(raw)) {
    const [h, m] = raw.split(":")
    return to24Hour(h, m, "")
  }

  // Handle 12-hour format (e.g. "10:00 AM", "9:30pm")
  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/)
  if (ampm) {
    return to24Hour(ampm[1], ampm[2], ampm[3])
  }

  // Fallback for ISO / Date-like strings
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) {
    return timeToString(parsed)
  }

  return ""
}

const timeStringToMinutes = (value) => {
  const normalized = normalizeTimeValue(value)
  if (!normalized || !/^\d{2}:\d{2}$/.test(normalized)) return null
  const [hours, minutes] = normalized.split(":").map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

const formatTime12Hour = (timeStr) => {
  if (!timeStr || typeof timeStr !== "string" || !timeStr.includes(":")) return "--:-- --"
  const [h, m] = timeStr.split(":").map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return timeStr
  const period = h >= 12 ? "PM" : "AM"
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, "0")} ${period}`
}

const formatDateToLocalYMD = (date) => {
  if (!date || Number.isNaN(date.getTime?.())) return ""
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const parseLocalYMDDate = (value) => {
  if (!value || typeof value !== "string") return undefined
  const parts = value.split("-").map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) return undefined
  const [year, month, day] = parts
  return new Date(year, month - 1, day)
}

function TimeSelector({ label, value, onChange }) {
  const timeValue = stringToTime(value)

  const handleTimeChange = (newValue) => {
    if (!newValue) {
      onChange("")
      return
    }
    const timeString = timeToString(newValue)
    onChange(timeString)
  }

  return (
    <div className="border border-gray-200 rounded-md px-3 py-2 bg-gray-50/60">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-4 h-4 text-gray-800" />
        <span className="text-xs font-medium text-gray-900">{label}</span>
      </div>
      <MobileTimePicker ampm={true}
        value={timeValue}
        onChange={handleTimeChange}
        onAccept={handleTimeChange}
        slotProps={{
          textField: {
            variant: "outlined",
            size: "small",
            placeholder: "Select time",
            sx: {
              "& .MuiOutlinedInput-root": {
                height: "36px",
                fontSize: "12px",
                backgroundColor: "white",
                "& fieldset": {
                  borderColor: "#e5e7eb",
                },
                "&:hover fieldset": {
                  borderColor: "#d1d5db",
                },
                "&.Mui-focused fieldset": {
                  borderColor: "#000",
                },
              },
              "& .MuiInputBase-input": {
                padding: "8px 12px",
                fontSize: "12px",
              },
            },
            onBlur: (event) => {
              const normalized = normalizeTimeValue(event?.target?.value)
              if (normalized) {
                onChange(normalized)
              }
            },
          },
        }}
        format="hh:mm a"
      />
    </div>
  )
}

export default function RestaurantOnboarding() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  useEffect(() => {
    prefetchModuleFcmToken("restaurant")
  }, [])

  const handleExitAnyway = useCallback(() => {
    navigate("/food/restaurant/login", { replace: true })

    void (async () => {
      try {
        clearOnboardingFcmLocal("restaurant")
        clearOnboardingFromLocalStorage()
        clearOnboardingFileCache()
        await clearAllFilesFromDB()

        const hasSession = Boolean(localStorage.getItem("restaurant_refreshToken"))
        if (hasSession) {
          await restaurantAPI.logout().catch(() => {})
        }
        clearModuleAuth("restaurant")
        clearAuthData()
        window.dispatchEvent(new Event("restaurantAuthChanged"))
      } catch (e) {
        debugError("Error clearing onboarding data on exit:", e)
      }
    })()
  }, [navigate])

  const goToPreviousOnboardingStep = useCallback(() => {
    setStep((currentStep) => Math.max(1, currentStep - 1))
    window.scrollTo({ top: 0, behavior: "instant" })
  }, [])

  const handleLogout = async () => {
    if (isLoggingOut) return
    setIsLoggingOut(true)
    try {
      await restaurantAPI.logout()
      clearModuleAuth("restaurant")
      clearAuthData()
      // Clear onboarding data and files
      clearOnboardingFromLocalStorage()
      await clearAllFilesFromDB()
      
      window.dispatchEvent(new Event("restaurantAuthChanged"))
      navigate("/food/restaurant/login", { replace: true })
    } catch (error) {
      debugError("Logout failed:", error)
      clearModuleAuth("restaurant")
      navigate("/food/restaurant/login", { replace: true })
    } finally {
      setIsLoggingOut(false)
    }
  }

  const [verifiedPhoneNumber, setVerifiedPhoneNumber] = useState(() => getVerifiedPhoneFromStoredRestaurant())
  const [keyboardInset, setKeyboardInset] = useState(0)
  const [isEditing, setIsEditing] = useState(true)
  const [hasExistingRestaurantProfile, setHasExistingRestaurantProfile] = useState(false)
  const [isFssaiCalendarOpen, setIsFssaiCalendarOpen] = useState(false)
  const [zones, setZones] = useState([])
  const [zonesLoading, setZonesLoading] = useState(false)
  const [isOnboardingHydrated, setIsOnboardingHydrated] = useState(false)
  const isHydratingRef = useRef(false)

  const [step1, setStep1] = useState({
    restaurantName: "",
    pureVegRestaurant: null,
    pureVeganRestaurant: false,
    ownerName: "",
    ownerEmail: "",
    ownerPhone: "",
    primaryContactNumber: "",
    zoneId: "",
    location: {
      formattedAddress: "",
      addressLine1: "",
      addressLine2: "",
      area: "",
      city: "",
      state: "",
      pincode: "",
      landmark: "",
      latitude: "",
      longitude: "",
    },
  })

  const [step2, setStep2] = useState({
    menuImages: [],
    profileImage: null,
    cuisines: [],
    estimatedDeliveryTime: "",
    openingTime: "",
    closingTime: "",
    openDays: [],
    isTakeawayEnabled: false,
    isTakeawayCodEnabled: false,
  })

  const [step3, setStep3] = useState({
    panNumber: "",
    nameOnPan: "",
    panImage: null,
    gstRegistered: false,
    gstNumber: "",
    gstLegalName: "",
    gstAddress: "",
    gstImage: null,
    fssaiNumber: "",
    fssaiExpiry: "",
    fssaiImage: null,
    accountNumber: "",
    confirmAccountNumber: "",
    ifscCode: "",
    accountHolderName: "",
    accountType: "",
  })

  const hasStep1UnsavedProgress = useCallback(
    () => hasRestaurantStep1Progress(step1),
    [step1],
  )

  const {
    showExitModal,
    handleBack,
    handleStay,
    handleExit,
    requestExit,
  } = useOnboardingExitGuard({
    isFirstStep: step === 1,
    onPreviousStep: goToPreviousOnboardingStep,
    onExit: handleExitAnyway,
    hasUnsavedProgress: hasStep1UnsavedProgress,
  })

  const previewUrlCacheRef = useRef(new Map())
  const locationSearchInputRef = useRef(null)
  const locationSearchContainerRef = useRef(null)
  const placesAutocompleteRef = useRef(null)
  const mapsScriptLoadedRef = useRef(false)
  const menuImagesInputRef = useRef(null)
  const profileImageInputRef = useRef(null)
  const panImageInputRef = useRef(null)
  const gstImageInputRef = useRef(null)
  const fssaiImageInputRef = useRef(null)
  const [sourcePicker, setSourcePicker] = useState({
    isOpen: false,
    title: "",
    onSelectFile: null,
    fileNamePrefix: "camera-image",
    fallbackInputRef: null,
  })

  // Manual search states for fallback
  const [locationSearchValue, setLocationSearchValue] = useState("")
  const [locationSuggestions, setLocationSuggestions] = useState([])
  const [isSearchingLocation, setIsSearchingLocation] = useState(false)
  const [isLocationSearchFocused, setIsLocationSearchFocused] = useState(false)

  const getPreviewImageUrl = (value) => {
    if (!value) return null
    if (typeof value === "string") return value
    if (value?.url && typeof value.url === "string") return value.url

    if (isUploadableFile(value)) {
      const cache = previewUrlCacheRef.current
      const cached = cache.get(value)
      if (cached) return cached
      try {
        const objectUrl = URL.createObjectURL(value)
        cache.set(value, objectUrl)
        return objectUrl
      } catch {
        return null
      }
    }

    return null
  }

  const openImageSourcePicker = ({ title, onSelectFile, fileNamePrefix, fallbackInputRef }) => {
    setSourcePicker({
      isOpen: true,
      title: title || "Select image source",
      onSelectFile,
      fileNamePrefix: fileNamePrefix || "camera-image",
      fallbackInputRef: fallbackInputRef || null,
    })
  }

  const closeImageSourcePicker = () => {
    setSourcePicker((prev) => ({ ...prev, isOpen: false }))
  }

  const handleMenuImagesSelected = (files = []) => {
    if (!files.length) return
    const nextMenuImages = [...(step2.menuImages || []), ...files]
    setStep2((prev) => ({
      ...prev,
      menuImages: nextMenuImages,
    }))
    void persistMenuImagesToDB(nextMenuImages)
  }



  const handleProfileImageSelected = (file) => {
    if (!file) return
    setStep2((prev) => ({
      ...prev,
      profileImage: file,
    }))
    void saveFileToDB("profileImage", file)
  }

  const handlePanImageSelected = (file) => {
    if (!file) return
    setStep3((prev) => ({ ...prev, panImage: file }))
  }

  const handleGstImageSelected = (file) => {
    if (!file) return
    setStep3((prev) => ({ ...prev, gstImage: file }))
  }

  const handleFssaiImageSelected = (file) => {
    if (!file) return
    setStep3((prev) => ({ ...prev, fssaiImage: file }))
  }

  const isPersistedImageValue = (value) =>
    !isUploadableFile(value) &&
    ((typeof value === "string" && value.trim()) ||
      (value?.url && typeof value.url === "string"))

  const getPersistedImagePayload = (value) => {
    if (typeof value === "string" && value.trim()) {
      return { url: value.trim(), publicId: null }
    }

    if (value?.url && typeof value.url === "string" && value.url.trim()) {
      return {
        url: value.url.trim(),
        publicId: value.publicId || null,
      }
    }

    return null
  }

  const toPersistedMenuImagesPayload = (menuImages = []) =>
    (Array.isArray(menuImages) ? menuImages : [])
      .filter((img) => isPersistedImageValue(img))
      .map((img) =>
        typeof img === "string"
          ? img
          : {
              url: img.url,
              publicId: img.publicId || null,
            },
      )

  const handleRemoveMenuImage = async (indexToRemove) => {
    const currentMenuImages = step2.menuImages || []
    const imageToRemove = currentMenuImages[indexToRemove]
    const nextMenuImages = currentMenuImages.filter((_, i) => i !== indexToRemove)

    setStep2((prev) => ({
      ...prev,
      menuImages: nextMenuImages,
    }))
    await persistMenuImagesToDB(nextMenuImages)

    if (!isPersistedImageValue(imageToRemove)) {
      return
    }

    try {
      await restaurantAPI.updateProfile({
        menuImages: toPersistedMenuImagesPayload(nextMenuImages),
      })
    } catch (error) {
      setStep2((prev) => ({
        ...prev,
        menuImages: currentMenuImages,
      }))
      await persistMenuImagesToDB(currentMenuImages)
      setError(error?.response?.data?.message || "Failed to remove menu image")
    }
  }

  const handleRemoveProfileImage = async () => {
    const currentProfileImage = step2.profileImage
    setStep2((prev) => ({
      ...prev,
      profileImage: null,
    }))

    if (!isPersistedImageValue(currentProfileImage)) {
      return
    }

    try {
      await restaurantAPI.updateProfile({ profileImage: "" })
    } catch (error) {
      setStep2((prev) => ({
        ...prev,
        profileImage: currentProfileImage,
      }))
      setError(error?.response?.data?.message || "Failed to remove profile image")
    }
  }

  const resolveImageForProfileUpdate = async (value, folder) => {
    if (!value) return null

    if (isUploadableFile(value)) {
      const uploaded = await handleUpload(value, folder)
      return uploaded || null
    }

    return getPersistedImagePayload(value)
  }


  const resolveMenuImagesForProfileUpdate = async (menuImages = []) => {
    const items = Array.isArray(menuImages) ? menuImages : []
    const resolved = await Promise.all(
      items.map(async (image) => {
        if (isUploadableFile(image)) {
          return handleUpload(image, "food/restaurants/menu")
        }

        return getPersistedImagePayload(image)
      }),
    )

    return resolved.filter((image) => image?.url)
  }


  // Load from localStorage on mount and check URL parameter
  useEffect(() => {
    if (isOnboardingHydrated || isHydratingRef.current) return;
    isHydratingRef.current = true;
    
    // Check if step is specified in URL (from OTP login redirect)
    const stepParam = new URLSearchParams(window.location.search).get("step")

    const loadData = async () => {
      try {
        setLoading(true);
        // Fail-safe: Force loading off after 7 seconds if something hangs on mobile
        const failSafeTimer = setTimeout(() => {
          if (!isOnboardingHydrated) {
            debugWarn("Hydration fail-safe triggered")
            setIsOnboardingHydrated(true)
            setLoading(false)
          }
        }, 7000)

        const currentPhone = getVerifiedPhoneFromStoredRestaurant()
        let localData = loadOnboardingFromLocalStorage()
        
        // 1. First fetch API data to have the latest backend state
        let apiData = null;
        try {
          // Only fetch if we have a token (existing user session)
          if (getModuleToken("restaurant")) {
            const res = await restaurantAPI.getCurrentRestaurant()
            apiData = res?.data?.data?.restaurant || res?.data?.restaurant
          }
        } catch (err) {
          debugError("API fetch skipped/failed:", err)
        }

        // 2. Hydrate from API if exists
        if (apiData) {
          setHasExistingRestaurantProfile(true)
          const onboarding = apiData.onboarding || {}
          const s1 = onboarding.step1 || {}
          const s2 = onboarding.step2 || {}
          const s3 = onboarding.step3 || {}
          const loc = s1.location || apiData.location || {}
          const pay = s3.bank || apiData.bankAccount || {}

          setStep1(prev => ({
            ...prev,
            restaurantName: s1.restaurantName || apiData.name || apiData.restaurantName || "",
            pureVegRestaurant: typeof s1.pureVegRestaurant === 'boolean' ? s1.pureVegRestaurant : (apiData.pureVegRestaurant ?? null),
            pureVeganRestaurant: typeof s1.pureVeganRestaurant === 'boolean' ? s1.pureVeganRestaurant : (apiData.pureVeganRestaurant === true),
            ownerName: s1.ownerName || apiData.ownerName || "",
            ownerEmail: s1.ownerEmail || apiData.ownerEmail || apiData.email || "",
            ownerPhone: s1.ownerPhone || apiData.ownerPhone || apiData.phone || "",
            primaryContactNumber: s1.primaryContactNumber || apiData.primaryContactNumber || "",
            zoneId: s1.zoneId || apiData.zoneId || "",
            location: {
              ...prev.location,
              formattedAddress: loc.formattedAddress || loc.address || apiData.address || "",
              addressLine1: loc.addressLine1 || "",
              addressLine2: loc.addressLine2 || "",
              area: loc.area || apiData.area || "",
              city: loc.city || apiData.city || "",
              state: loc.state || apiData.state || "",
              pincode: loc.pincode || apiData.pincode || "",
              landmark: loc.landmark || "",
              latitude: loc.latitude || "",
              longitude: loc.longitude || "",
            }
          }))

          setStep2(prev => ({
            ...prev,
            menuImages: s2.menuImageUrls || apiData.menuImages || [],
            profileImage: s2.profileImageUrl || apiData.profileImage || null,
            cuisines: s2.cuisines || apiData.cuisines || [],
            estimatedDeliveryTime: s2.estimatedDeliveryTime || apiData.estimatedDeliveryTime || "",
            openingTime: normalizeTimeValue(s2.openingTime || apiData.openingTime),
            closingTime: normalizeTimeValue(s2.closingTime || apiData.closingTime),
            openDays: s2.openDays || apiData.openDays || [],
            isTakeawayEnabled: s2.isTakeawayEnabled || apiData.takeawaySettings?.isEnabled || false,
          }))

          setStep3(prev => ({
            ...prev,
            panNumber: s3.pan?.panNumber || apiData.panNumber || "",
            nameOnPan: s3.pan?.nameOnPan || apiData.nameOnPan || "",
            panImage: s3.pan?.image || apiData.panImage || null,
            gstRegistered: s3.gst?.isRegistered ?? apiData.gstRegistered ?? false,
            gstNumber: s3.gst?.gstNumber || apiData.gstNumber || "",
            gstLegalName: s3.gst?.legalName || apiData.gstLegalName || "",
            gstAddress: s3.gst?.address || apiData.gstAddress || "",
            gstImage: s3.gst?.image || apiData.gstImage || null,
            fssaiNumber: s3.fssai?.registrationNumber || apiData.fssaiNumber || "",
            fssaiExpiry: s3.fssai?.expiryDate ? String(s3.fssai.expiryDate).split('T')[0] : (apiData.fssaiExpiry ? String(apiData.fssaiExpiry).split('T')[0] : ""),
            fssaiImage: s3.fssai?.image || apiData.fssaiImage || null,
            accountNumber: pay.accountNumber || apiData.accountNumber || "",
            confirmAccountNumber: pay.accountNumber || apiData.accountNumber || "",
            ifscCode: normalizeIFSC(pay.ifscCode || apiData.ifscCode),
            accountHolderName: pay.accountHolderName || apiData.accountHolderName || "",
            accountType: normalizeAccountTypeValue(pay.accountType || apiData.accountType),
          }))
        }

        // 3. APPLY LOCAL OVERRIDES (The "Persistence" fix)
        // If localStorage has unsaved changes for this user, apply them over the API/Initial state.
        if (localData) {
          const savedPhone = normalizePhoneDigits(localData.step1?.ownerPhone || "")
          const normalizedCurrent = normalizePhoneDigits(currentPhone)
          
          // Only use local data if it belongs to the same user
          if (savedPhone && normalizedCurrent && savedPhone === normalizedCurrent) {
            debugLog("? Matching local session found. Resuming with unsaved changes.")
            
            if (localData.step1) {
              setStep1(prev => ({ ...prev, ...localData.step1, location: { ...prev.location, ...localData.step1.location } }));
            }
            if (localData.step2) {
              // Note: Files/Images must be re-hydrated from IndexedDB (handled below)
              setStep2(prev => ({ 
                ...prev, 
                ...localData.step2,
                openingTime: normalizeTimeValue(localData.step2.openingTime),
                closingTime: normalizeTimeValue(localData.step2.closingTime),
              }));
            }
            if (localData.step3) {
              setStep3(prev => ({ ...prev, ...localData.step3 }));
            }

            // Restore Step
            if (localData.currentStep && !stepParam) {
              setStep(Math.min(3, Math.max(1, Number(localData.currentStep))))
            }
          } else if (savedPhone && normalizedCurrent && savedPhone !== normalizedCurrent) {
             debugLog("? Phone mismatch, data belongs to different user. Clearing local cache.")
             localData = null; // Bypass IndexedDB check for mismatched user
             clearOnboardingFromLocalStorage()
             clearAllFilesFromDB().catch(e => debugError("Cleanup failed:", e))
          }
        }

        // 4. Finally re-hydrate heavy files from IndexedDB if they exist 
        // (IndexedDB is reliable for large files which don't fit in localStorage)
        // Optimization: Only attempt this if we have existing local or API data to restore.
        if (localData || apiData) {
          debugLog("? Checking IndexedDB for saved files...")
          const [prof, pan, gst, fs] = await Promise.all([
            getFileFromDB("profileImage"),
            getFileFromDB("panImage"),
            getFileFromDB("gstImage"),
            getFileFromDB("fssaiImage"),
          ]);

          if (prof) setStep2(p => ({ ...p, profileImage: prof }));
          if (pan) setStep3(p => ({ ...p, panImage: pan }));
          if (gst) setStep3(p => ({ ...p, gstImage: gst }));
          if (fs) setStep3(p => ({ ...p, fssaiImage: fs }));

          // Parallelize menu images hydration
          const menuPromises = Array.from({ length: 10 }, (_, i) => getFileFromDB(`menuImage_${i}`))
          const restoredMenuImages = (await Promise.all(menuPromises)).filter(Boolean)
          
          if (restoredMenuImages.length) {
            setStep2(p => ({ ...p, menuImages: [...p.menuImages.filter(im => !isUploadableFile(im)), ...restoredMenuImages] }));
          }
        }

        // If step is explicitly in URL, use it
        if (stepParam) {
          const s = parseInt(stepParam, 10);
          if (s >= 1 && s <= 3) setStep(s);
        }

        clearTimeout(failSafeTimer)
      } catch (err) {
        debugError("Onboarding hydration failed:", err)
      } finally {
        setIsOnboardingHydrated(true)
        setLoading(false)
        isHydratingRef.current = false
      }
    }

    loadData()
  }, [])

  useEffect(() => {
    if (!verifiedPhoneNumber) return
    setStep1((prev) => ({
      ...prev,
      ownerPhone: verifiedPhoneNumber,
    }))
  }, [verifiedPhoneNumber])

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return undefined

    const updateInset = () => {
      const vv = window.visualViewport
      const inset = Math.max(0, Math.round(window.innerHeight - vv.height))
      setKeyboardInset(inset > 120 ? inset : 0)
    }

    updateInset()
    window.visualViewport.addEventListener("resize", updateInset)
    window.visualViewport.addEventListener("scroll", updateInset)
    return () => {
      window.visualViewport.removeEventListener("resize", updateInset)
      window.visualViewport.removeEventListener("scroll", updateInset)
    }
  }, [])

  // Save to localStorage whenever step data changes
  useEffect(() => {
    if (!isOnboardingHydrated) return
    saveOnboardingToLocalStorage(step1, step2, step3, step)
    
    // Save images to IndexedDB
    const saveFiles = async () => {
      if (step2.profileImage && isUploadableFile(step2.profileImage)) {
        await saveFileToDB("profileImage", step2.profileImage)
      } else if (!step2.profileImage) {
        await deleteFileFromDB("profileImage")
      }
      if (step3.panImage && isUploadableFile(step3.panImage)) {
        await saveFileToDB("panImage", step3.panImage)
      }
      if (step3.gstImage && isUploadableFile(step3.gstImage)) {
        await saveFileToDB("gstImage", step3.gstImage)
      }
      if (step3.fssaiImage && isUploadableFile(step3.fssaiImage)) {
        await saveFileToDB("fssaiImage", step3.fssaiImage)
      }
      
      await persistMenuImagesToDB(step2.menuImages || [])
    }
    saveFiles()
  }, [isOnboardingHydrated, step1, step2, step3, step])

  useEffect(() => {
    syncOnboardingFileCache(step2, step3)
  }, [step2, step3])

  useEffect(() => {
    return () => {
      previewUrlCacheRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url)
        } catch {
          // Ignore revoke errors
        }
      })
      previewUrlCacheRef.current.clear()
    }
  }, [])

  // REMOVED redundancy: The hydration is now handled in a single loadData effect above 
  // to avoid race conditions between localStorage and API data.

  const handleUpload = async (file, folder) => {
    try {
      if (!isUploadableFile(file)) {
        throw new Error("Invalid image file")
      }

      const response = await uploadAPI.uploadMedia(file, { folder })
      const uploadedImage = response?.data?.data

      if (!uploadedImage?.url) {
        throw new Error("Uploaded image URL was not returned")
      }

      return uploadedImage
    } catch (err) {
      // Provide more informative error message for upload failures
      const errorMsg = err?.response?.data?.message || err?.response?.data?.error || err?.message || "Failed to upload image"
      debugError("Upload error:", errorMsg, err)
      throw new Error(`Image upload failed: ${errorMsg}`)
    }
  }


  // Validation functions for each step
  const validateStep1 = () => {
    const errors = []

    if (!step1.restaurantName?.trim()) {
      errors.push("Restaurant name is required")
    } else if (/[\/-]/.test(step1.restaurantName)) {
      errors.push("Restaurant name cannot contain slashes (/) or hyphens (-)")
    }
    if (typeof step1.pureVegRestaurant !== "boolean") {
      errors.push("Please select whether your restaurant is pure veg")
    }
    if (!step1.ownerName?.trim()) {
      errors.push("Owner name is required")
    } else if (!OWNER_NAME_REGEX.test(step1.ownerName.trim())) {
      errors.push("Owner name must contain only letters")
    }
    if (!step1.ownerEmail?.trim()) {
      errors.push("Owner email is required")
    } else if (!EMAIL_REGEX.test(step1.ownerEmail.trim())) {
      errors.push("Please enter a valid email address")
    } else if (step1.ownerEmail.toLowerCase().includes("@gnail.com") || step1.ownerEmail.toLowerCase().includes("@gnil.com")) {
      errors.push("Invalid email domain. Did you mean '@gmail.com'?")
    }
    if (!step1.ownerPhone?.trim()) {
      errors.push("Owner phone number is required")
    } else if (!/^\d{10}$/.test(normalizePhoneDigits(step1.ownerPhone))) {
      errors.push("Owner phone number must be exactly 10 digits")
    }
    if (!step1.primaryContactNumber?.trim()) {
      errors.push("Primary contact number is required")
    } else if (!/^\d{10}$/.test(normalizePhoneDigits(step1.primaryContactNumber))) {
       errors.push("Primary contact number must be exactly 10 digits")
    }
    if (!step1.zoneId?.trim()) {
      errors.push("Service zone is required")
    }
    if (!step1.location?.area?.trim()) {
      errors.push("Area/Sector/Locality is required")
    }
    if (!step1.location?.city?.trim()) {
      errors.push("City is required")
    }
    if (!step1.location?.pincode?.trim()) {
      errors.push("Pincode is required")
    } else if (!/^\d{6}$/.test(normalizePincode(step1.location.pincode))) {
      errors.push("Pincode must be exactly 6 digits")
    }

    return errors
  }

  const validateStep2 = () => {
    const errors = []

    // Check menu images - must have at least one File or existing URL
    const hasMenuImages = step2.menuImages && step2.menuImages.length > 0
    if (!hasMenuImages) {
      errors.push("At least one menu image is required")
    } else {
      // Verify that menu images are either File objects or have valid URLs
      const validMenuImages = step2.menuImages.filter(img => {
        if (isUploadableFile(img)) return true
        if (img?.url && typeof img.url === 'string') return true
        if (typeof img === 'string' && img.trim()) return true
        return false
      })
      if (validMenuImages.length === 0) {
        errors.push("Please upload at least one valid menu image")
      }
    }

    // Check profile image - must be a File or existing URL
    if (!step2.profileImage) {
      errors.push("Restaurant profile image is required")
    } else {
      // Verify profile image is either a File or has a valid URL
      const isValidProfileImage =
        isUploadableFile(step2.profileImage) ||
        (step2.profileImage?.url && typeof step2.profileImage.url === 'string') ||
        (typeof step2.profileImage === 'string' && step2.profileImage.trim())
      if (!isValidProfileImage) {
        errors.push("Please upload a valid restaurant profile image")
      }
    }

    if (!step2.openingTime?.trim()) {
      errors.push("Opening time is required")
    }
    if (!step2.closingTime?.trim()) {
      errors.push("Closing time is required")
    }
    const openingMinutes = timeStringToMinutes(step2.openingTime)
    const closingMinutes = timeStringToMinutes(step2.closingTime)
    if (openingMinutes !== null && closingMinutes !== null) {
      if (openingMinutes === closingMinutes) {
        errors.push("Opening time and closing time cannot be same")
      } else if (closingMinutes < openingMinutes) {
        errors.push("Closing time cannot be less than opening time")
      }
    }
    if (!step2.openDays || step2.openDays.length === 0) {
      errors.push("Please select at least one open day")
    }
    if (!step2.estimatedDeliveryTime?.trim()) {
      errors.push("Estimated delivery time is required")
    }

    return errors
  }

  const validateStep3 = () => {
    const errors = []

    if (!step3.panNumber?.trim()) {
      errors.push("PAN number is required")
    } else if (!PAN_NUMBER_REGEX.test(step3.panNumber.trim().toUpperCase())) {
      errors.push("PAN number must be valid (e.g., ABCDE1234F)")
    }
    if (!step3.nameOnPan?.trim()) {
      errors.push("Name on PAN is required")
    }
    // Validate PAN image - must be a File or existing URL
    if (!step3.panImage) {
      errors.push("PAN image is required")
    } else {
      const isValidPanImage =
        isUploadableFile(step3.panImage) ||
        (step3.panImage?.url && typeof step3.panImage.url === 'string') ||
        (typeof step3.panImage === 'string' && step3.panImage.trim())
      if (!isValidPanImage) {
        errors.push("Please upload a valid PAN image")
      }
    }

    if (!step3.fssaiNumber?.trim()) {
      errors.push("FSSAI number is required")
    } else if (!FSSAI_NUMBER_REGEX.test(step3.fssaiNumber.trim())) {
      errors.push("FSSAI number must contain exactly 14 digits")
    }
    if (!step3.fssaiExpiry?.trim()) {
      errors.push("FSSAI expiry date is required")
    } else if (step3.fssaiExpiry < getTodayLocalYMD()) {
      errors.push("FSSAI expiry date cannot be in the past")
    }
    // Validate FSSAI image - must be a File or existing URL
    if (!step3.fssaiImage) {
      errors.push("FSSAI image is required")
    } else {
      const isValidFssaiImage =
        isUploadableFile(step3.fssaiImage) ||
        (step3.fssaiImage?.url && typeof step3.fssaiImage.url === 'string') ||
        (typeof step3.fssaiImage === 'string' && step3.fssaiImage.trim())
      if (!isValidFssaiImage) {
        errors.push("Please upload a valid FSSAI image")
      }
    }

    // Validate GST details if GST registered
    if (step3.gstRegistered) {
      if (!step3.gstNumber?.trim()) {
        errors.push("GST number is required when GST registered")
      } else if (!GST_NUMBER_REGEX.test(step3.gstNumber.trim().toUpperCase())) {
        errors.push("GST number must be a valid 15-character GSTIN")
      }
      if (!step3.gstLegalName?.trim()) {
        errors.push("GST legal name is required when GST registered")
      } else if (!GST_LEGAL_NAME_REGEX.test(step3.gstLegalName.trim())) {
        errors.push("GST legal name must contain only letters")
      }
      if (!step3.gstAddress?.trim()) {
        errors.push("GST registered address is required when GST registered")
      }
      // Validate GST image if GST registered
      if (!step3.gstImage) {
        errors.push("GST image is required when GST registered")
      } else {
        const isValidGstImage =
          isUploadableFile(step3.gstImage) ||
          (step3.gstImage?.url && typeof step3.gstImage.url === 'string') ||
          (typeof step3.gstImage === 'string' && step3.gstImage.trim())
        if (!isValidGstImage) {
          errors.push("Please upload a valid GST image")
        }
      }
    }

    if (!step3.accountNumber?.trim()) {
      errors.push("Account number is required")
    } else if (!BANK_ACCOUNT_NUMBER_REGEX.test(step3.accountNumber.trim())) {
      errors.push("Account number must contain 9 to 18 digits only")
    }
    if (!step3.confirmAccountNumber?.trim()) {
      errors.push("Please confirm your account number")
    } else if (!BANK_ACCOUNT_NUMBER_REGEX.test(step3.confirmAccountNumber.trim())) {
      errors.push("Confirm account number must contain 9 to 18 digits only")
    }
    if (step3.accountNumber && step3.confirmAccountNumber && step3.accountNumber !== step3.confirmAccountNumber) {
      errors.push("Account number and confirmation do not match")
    }
    if (!step3.ifscCode?.trim()) {
      errors.push("IFSC code is required")
    } else if (!IFSC_CODE_REGEX.test(step3.ifscCode.trim().toUpperCase())) {
      errors.push("IFSC code must contain exactly 11 alphanumeric characters")
    }
    if (!step3.accountHolderName?.trim()) {
      errors.push("Account holder name is required")
    } else if (!ACCOUNT_HOLDER_NAME_REGEX.test(step3.accountHolderName.trim())) {
      errors.push("Account holder name must contain only letters")
    }
    if (!step3.accountType?.trim()) {
      errors.push("Account type is required")
    } else if (!["Saving", "Current"].includes(step3.accountType.trim())) {
      errors.push("Account type must be either Saving or Current")
    }

    return errors
  }

  const handleNext = async () => {
    setError("")

    // Validate current step before proceeding
    let validationErrors = []
    if (step === 1) {
      validationErrors = validateStep1()
    } else if (step === 2) {
      validationErrors = validateStep2()
    } else if (step === 3) {
      validationErrors = validateStep3()
    }

    if (validationErrors.length > 0) {
      setError(validationErrors[0])
      toast.error(validationErrors[0])
      debugLog('? Validation failed:', validationErrors)
      return
    }

    setSaving(true)
    try {
      if (step === 1) {
        setStep(2)
        window.scrollTo({ top: 0, behavior: "instant" })
      } else if (step === 2) {
        setStep(3)
        window.scrollTo({ top: 0, behavior: "instant" })
      } else if (step === 3) {
        const { fcmToken, platform } = await collectFcmTokenForSignup("restaurant")

        if (hasExistingRestaurantProfile) {
          const [
            menuImagesPayload,
            profileImagePayload,
            panImagePayload,
            gstImagePayload,
            fssaiImagePayload,
          ] = await Promise.all([
            resolveMenuImagesForProfileUpdate(step2.menuImages || []),
            resolveImageForProfileUpdate(step2.profileImage, "food/restaurants/profile"),
            resolveImageForProfileUpdate(step3.panImage, "food/restaurants/pan"),
            step3.gstRegistered
              ? resolveImageForProfileUpdate(step3.gstImage, "food/restaurants/gst")
              : Promise.resolve(null),
            resolveImageForProfileUpdate(step3.fssaiImage, "food/restaurants/fssai"),
          ])

          const updatePayload = {
            restaurantName: step1.restaurantName || "",
            pureVegRestaurant: step1.pureVegRestaurant === true || step1.pureVeganRestaurant === true,
            pureVeganRestaurant: step1.pureVeganRestaurant === true,
            ownerName: step1.ownerName || "",
            ownerEmail: (step1.ownerEmail || "").trim(),
            ownerPhone: normalizePhoneDigits(step1.ownerPhone),
            primaryContactNumber: normalizePhoneDigits(step1.primaryContactNumber),
            zoneId: step1.zoneId || "",
            location: {
              formattedAddress: step1.location?.formattedAddress || "",
              addressLine1: step1.location?.addressLine1 || "",
              addressLine2: step1.location?.addressLine2 || "",
              area: step1.location?.area || "",
              city: step1.location?.city || "",
              state: step1.location?.state || "",
              pincode: step1.location?.pincode || "",
              landmark: step1.location?.landmark || "",
              latitude: step1.location?.latitude || "",
              longitude: step1.location?.longitude || "",
            },
            cuisines: Array.isArray(step2.cuisines) ? step2.cuisines : [],
            estimatedDeliveryTime: (step2.estimatedDeliveryTime || "").trim(),
            openingTime: normalizeTimeValue(step2.openingTime) || "",
            closingTime: normalizeTimeValue(step2.closingTime) || "",
            openDays: Array.isArray(step2.openDays) ? step2.openDays : [],
            menuImages: menuImagesPayload,
            profileImage: profileImagePayload || "",
            panNumber: step3.panNumber || "",
            nameOnPan: step3.nameOnPan || "",
            panImage: panImagePayload || "",
            gstRegistered: Boolean(step3.gstRegistered),
            gstNumber: step3.gstRegistered ? step3.gstNumber || "" : "",
            gstLegalName: step3.gstRegistered ? step3.gstLegalName || "" : "",
            gstAddress: step3.gstRegistered ? step3.gstAddress || "" : "",
            gstImage: step3.gstRegistered ? (gstImagePayload || "") : "",
            fssaiNumber: step3.fssaiNumber || "",
            fssaiExpiry: step3.fssaiExpiry || "",
            fssaiImage: fssaiImagePayload || "",
            accountNumber: step3.accountNumber || "",
            ifscCode: (step3.ifscCode || "").toUpperCase(),
            accountHolderName: step3.accountHolderName || "",
            accountType: step3.accountType || "",
            isTakeawayEnabled: step2.isTakeawayEnabled === true,
            isTakeawayCodEnabled: step2.isTakeawayCodEnabled === true,
          }

          if (fcmToken) {
            updatePayload.fcmToken = fcmToken
            updatePayload.platform = platform
          }

          await restaurantAPI.updateProfile(updatePayload)

          clearOnboardingFromLocalStorage()
          clearOnboardingFileCache()
          await clearAllFilesFromDB()

          toast.success("Registration submitted. Awaiting admin approval.", { duration: 4000 })
          await finalizeRestaurantPendingSubmission(navigate, step1.ownerPhone, { fcmToken, platform })
          return
        }

        // Final submit: create restaurant in DB using backend multipart endpoint.
        const formData = new FormData()

        // Step 1
        formData.append("restaurantName", step1.restaurantName || "")
        formData.append(
          "pureVegRestaurant",
          step1.pureVegRestaurant === true || step1.pureVeganRestaurant === true ? "true" : "false",
        )
        formData.append(
          "pureVeganRestaurant",
          step1.pureVeganRestaurant === true ? "true" : "false",
        )
        formData.append("ownerName", step1.ownerName || "")
        formData.append("ownerEmail", (step1.ownerEmail || "").trim())
        formData.append("ownerPhone", normalizePhoneDigits(step1.ownerPhone))
        formData.append("primaryContactNumber", normalizePhoneDigits(step1.primaryContactNumber))
        formData.append("zoneId", step1.zoneId || "")
        formData.append("addressLine1", step1.location?.addressLine1 || "")
        formData.append("addressLine2", step1.location?.addressLine2 || "")
        formData.append("area", step1.location?.area || "")
        formData.append("city", step1.location?.city || "")
        formData.append("state", step1.location?.state || "")
        formData.append("pincode", step1.location?.pincode || "")
        formData.append("landmark", step1.location?.landmark || "")
        formData.append("formattedAddress", step1.location?.formattedAddress || "")
        formData.append("latitude", String(step1.location?.latitude || ""))
        formData.append("longitude", String(step1.location?.longitude || ""))

        // Step 2
        formData.append("cuisines", (step2.cuisines || []).join(","))
        formData.append("estimatedDeliveryTime", (step2.estimatedDeliveryTime || "").trim())
        formData.append("openingTime", normalizeTimeValue(step2.openingTime) || "")
        formData.append("closingTime", normalizeTimeValue(step2.closingTime) || "")
        formData.append("openDays", (step2.openDays || []).join(","))
        formData.append("isTakeawayEnabled", step2.isTakeawayEnabled ? "true" : "false")
        formData.append("isTakeawayCodEnabled", step2.isTakeawayCodEnabled ? "true" : "false")

        const menuFiles = (step2.menuImages || []).filter((f) => isUploadableFile(f))
        if (menuFiles.length === 0) {
          throw new Error("At least one menu image must be uploaded")
        }
        const preparedMenuFiles = await prepareUploadFiles(menuFiles)
        preparedMenuFiles.forEach((file) => formData.append("menuImages", file))

        if (!isUploadableFile(step2.profileImage)) {
          throw new Error("Restaurant profile image is required")
        }
        formData.append(
          "profileImage",
          await prepareUploadFile(step2.profileImage, { preset: "profile" }),
        )

        // Step 3
        formData.append("panNumber", step3.panNumber || "")
        formData.append("nameOnPan", step3.nameOnPan || "")
        if (!isUploadableFile(step3.panImage)) {
          throw new Error("PAN image is required")
        }
        formData.append("panImage", await prepareUploadFile(step3.panImage))

        formData.append("gstRegistered", step3.gstRegistered ? "true" : "false")
        if (step3.gstRegistered) {
          formData.append("gstNumber", step3.gstNumber || "")
          formData.append("gstLegalName", step3.gstLegalName || "")
          formData.append("gstAddress", step3.gstAddress || "")
          if (!isUploadableFile(step3.gstImage)) {
            throw new Error("GST image is required when GST registered")
          }
          formData.append("gstImage", await prepareUploadFile(step3.gstImage))
        }

        formData.append("fssaiNumber", step3.fssaiNumber || "")
        formData.append("fssaiExpiry", step3.fssaiExpiry || "")
        if (!isUploadableFile(step3.fssaiImage)) {
          throw new Error("FSSAI image is required")
        }
        formData.append("fssaiImage", await prepareUploadFile(step3.fssaiImage))

        formData.append("accountNumber", step3.accountNumber || "")
        formData.append("ifscCode", (step3.ifscCode || "").toUpperCase())
        formData.append("accountHolderName", step3.accountHolderName || "")
        formData.append("accountType", step3.accountType || "")

        if (fcmToken) {
          formData.append("fcmToken", fcmToken)
          formData.append("platform", platform)
        }

        await restaurantAPI.register(formData)

        // Clear localStorage when onboarding is complete
        clearOnboardingFromLocalStorage()
        clearOnboardingFileCache()
        try {
          await clearAllFilesFromDB()
        } catch {}

        toast.success("Registration submitted. Awaiting admin approval.", { duration: 4000 })
        await finalizeRestaurantPendingSubmission(navigate, step1.ownerPhone, { fcmToken, platform })
      }
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to save onboarding data"
      setError(msg)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }



  const toggleDay = (day) => {
    setStep2((prev) => {
      const exists = prev.openDays.includes(day)
      if (exists) {
        return { ...prev, openDays: prev.openDays.filter((d) => d !== day) }
      }
      return { ...prev, openDays: [...prev.openDays, day] }
    })
  }
  
  const renderStep1 = () => (
    <div className="space-y-6">
      <section className="bg-white p-4 sm:p-6 rounded-md">
        <h2 className="text-lg font-semibold text-black mb-4">Restaurant information</h2>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-gray-700">Restaurant name*</Label>
            <Input
              value={step1.restaurantName || ""}
              onChange={(e) => {
                const sanitizedVal = e.target.value.replace(/[\/-]/g, "");
                setStep1({ ...step1, restaurantName: formatNameToCapital(sanitizedVal) });
              }}
              className="mt-1 bg-white text-sm"
              placeholder="Customers will see this name"
              disabled={!isEditing}
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">Restaurant diet type?*</Label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  isEditing &&
                  setStep1({
                    ...step1,
                    pureVegRestaurant: true,
                    pureVeganRestaurant: false,
                  })
                }
                className={`px-3 py-1.5 text-xs rounded-full border ${
                  step1.pureVegRestaurant === true && step1.pureVeganRestaurant !== true
                    ? "bg-green-600 text-white border-green-600"
                    : "bg-white text-gray-700 border-gray-200"
                } ${!isEditing ? "opacity-70 cursor-not-allowed" : ""}`}
              >
                Yes, Pure Veg
              </button>
              <button
                type="button"
                onClick={() =>
                  isEditing &&
                  setStep1({
                    ...step1,
                    pureVegRestaurant: true,
                    pureVeganRestaurant: true,
                  })
                }
                className={`px-3 py-1.5 text-xs rounded-full border ${
                  step1.pureVeganRestaurant === true
                    ? "bg-emerald-700 text-white border-emerald-700"
                    : "bg-white text-gray-700 border-gray-200"
                } ${!isEditing ? "opacity-70 cursor-not-allowed" : ""}`}
              >
                Yes, Pure Vegan
              </button>
              <button
                type="button"
                onClick={() =>
                  isEditing &&
                  setStep1({
                    ...step1,
                    pureVegRestaurant: false,
                    pureVeganRestaurant: false,
                  })
                }
                className={`px-3 py-1.5 text-xs rounded-full border ${
                  step1.pureVegRestaurant === false
                    ? "bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white border-gray-900"
                    : "bg-white text-gray-700 border-gray-200"
                } ${!isEditing ? "opacity-70 cursor-not-allowed" : ""}`}
              >
                No, Mixed Menu
              </button>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Pure Veg allows dairy/ghee. Pure Vegan allows only vegan items (no dairy, ghee, or animal products).
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md">
        <h2 className="text-lg font-semibold text-black mb-4">Owner details</h2>
        <p className="text-sm text-gray-600 mb-4">
          These details will be used for all business communications and updates.
        </p>
        <div className="space-y-4">
          <div>
            <Label className="text-xs text-gray-700">Full name*</Label>
            <Input
              value={step1.ownerName || ""}
              onChange={(e) =>
                setStep1({
                  ...step1,
                  ownerName: formatNameToCapital(e.target.value.replace(/[^A-Za-z ]/g, "")),
                })
              }
              className="mt-1 bg-white text-sm"
              placeholder="Owner full name"
              disabled={!isEditing}
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">Email address*</Label>
            <Input
              type="email"
              value={step1.ownerEmail || ""}
              onChange={(e) => setStep1({ ...step1, ownerEmail: normalizeEmail(e.target.value) })}
              className="mt-1 bg-white text-sm"
              placeholder="ritu@gmail.com"
              disabled={!isEditing}
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">Phone number*</Label>
            <Input
              value={step1.ownerPhone || ""}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "").slice(0, 10)
                setStep1({ ...step1, ownerPhone: val })
              }}
              readOnly={Boolean(verifiedPhoneNumber)}
              className="mt-1 bg-white text-sm"
              placeholder="10 digit mobile number"
              disabled={!isEditing}
            />
          </div>
        </div>
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">Restaurant contact & location</h2>
        <div>
          <Label className="text-xs text-gray-700">Primary contact number*</Label>
          <Input
            value={step1.primaryContactNumber || ""}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "").slice(0, 10)
              setStep1({ ...step1, primaryContactNumber: val })
            }}
            onKeyDown={(e) => {
              const allowed = ["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Tab", "Enter"]
              if (!allowed.includes(e.key) && !/^\d$/.test(e.key)) e.preventDefault()
              if (/^\d$/.test(e.key) && (step1.primaryContactNumber || "").length >= 10) e.preventDefault()
            }}
            onPaste={(e) => {
              e.preventDefault()
              const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 10)
              setStep1({ ...step1, primaryContactNumber: pasted })
            }}
            inputMode="numeric"
            className="mt-1 bg-white text-sm"
            placeholder="Restaurant's primary contact number"
            disabled={!isEditing}
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Customers, delivery partners and {companyName} may call on this number for order
            support.
          </p>
        </div>
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Add your restaurant's location for order pick-up.
          </p>
          <div>
            <Label className="text-xs text-gray-700">Service zone*</Label>
            <select
              value={step1.zoneId || ""}
              onChange={(e) => setStep1({ ...step1, zoneId: e.target.value })}
              className="mt-1 w-full h-9 rounded-md border border-input bg-white px-3 text-sm"
              disabled={zonesLoading || !isEditing}
            >
              <option value="">{zonesLoading ? "Loading zones..." : "Select a zone"}</option>
              {zones.map((z) => {
                const id = String(z?._id || z?.id || "")
                const label = z?.name || z?.zoneName || z?.serviceLocation || id
                return (
                  <option key={id} value={id}>
                    {label}
                  </option>
                )
              })}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">
              Choose the service zone where your restaurant will be available.
            </p>
          </div>
          <div ref={locationSearchContainerRef} className="relative">
            <Label className="text-xs text-gray-700">Search location</Label>
            <div className="relative">
              <Input
                ref={locationSearchInputRef}
                value={locationSearchValue}
                onChange={(e) => setLocationSearchValue(e.target.value)}
                onFocus={() => setIsLocationSearchFocused(true)}
                onBlur={() => setIsLocationSearchFocused(false)}
                className="mt-1 bg-white text-sm text-black! dark:text-white! placeholder:text-slate-400/70 dark:placeholder:text-slate-500/70 caret-black dark:caret-white"
                style={locationSearchValue ? { color: "#000", WebkitTextFillColor: "#000" } : {}}
                placeholder={isLocationSearchFocused ? "" : "Start typing your restaurant address..."}
              />
              {isSearchingLocation && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                   <div className="animate-spin rounded-full h-4 w-4 border-2 border-orange-500 border-t-transparent" />
                </div>
              )}
            </div>

            {/* Fallback suggestions dropdown */}
            {locationSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-gray-200 rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.08)] z-[999999] max-h-60 overflow-y-auto p-1 font-['Poppins'] custom-scrollbar">
                {locationSuggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      const { lat, lng, display, addr } = s
                      const area = addr.suburb || addr.neighbourhood || addr.city_district || addr.locality || ""
                      const city = addr.city || addr.town || addr.village || ""
                      const state = addr.state || ""
                      const pincode = addr.postcode || ""

                      setStep1((prev) => ({
                        ...prev,
                        location: {
                          ...prev.location,
                          formattedAddress: display,
                          addressLine1: display,
                          area: area || prev.location.area,
                          city: city || prev.location.city,
                          state: state || prev.location.state,
                          pincode: pincode || prev.location.pincode,
                          latitude: lat,
                          longitude: lng,
                        },
                      }))
                      setLocationSearchValue(display)
                      setLocationSuggestions([])
                    }}
                    className="w-full pl-1.5 pr-3 py-2.5 text-left text-sm hover:bg-[#FEF2F2] border-b border-gray-100 last:border-none font-medium text-gray-700 flex items-center gap-2 transition-colors rounded-xl"
                  >
                    {/* Premium red map pin icon */}
                    <svg className="w-5 h-5 text-[#DC2626] shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    <span className="truncate text-gray-800 font-semibold">{s.display}</span>
                  </button>
                ))}
              </div>
            )}
            
            <p className="text-[11px] text-gray-500 mt-1">
              Select a suggestion to auto-fill area/city/state/pincode and coordinates.
            </p>
          </div>
          <Input
            value={step1.location?.addressLine1 || ""}
            onChange={(e) =>
              setStep1({
                ...step1,
                location: { ...step1.location, addressLine1: e.target.value },
              })
            }
            className="bg-white text-sm"
            placeholder="Shop no. / building no. (optional)"
          />
          <Input
            value={step1.location?.addressLine2 || ""}
            onChange={(e) =>
              setStep1({
                ...step1,
                location: { ...step1.location, addressLine2: e.target.value },
              })
            }
            className="bg-white text-sm"
            placeholder="Floor / tower (optional)"
          />
          <Input
            value={step1.location?.landmark || ""}
            onChange={(e) =>
              setStep1({
                ...step1,
                location: { ...step1.location, landmark: e.target.value },
              })
            }
            className="bg-white text-sm"
            placeholder="Nearby landmark (optional)"
          />
          <Input
            value={step1.location?.area || ""}
            onChange={(e) =>
              setStep1({
                ...step1,
                location: { ...step1.location, area: e.target.value },
              })
            }
            className="bg-white text-sm"
            placeholder="Area / Sector / Locality*"
          />
          <Select
            value={step1.location?.city || ""}
            onValueChange={(value) =>
              setStep1({
                ...step1,
                location: { ...step1.location, city: value },
              })
            }
          >
            <SelectTrigger className="bg-white text-sm text-gray-700">
              <SelectValue placeholder="Select City*" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Indore">Indore</SelectItem>
              <SelectItem value="Bhopal">Bhopal</SelectItem>
              <SelectItem value="Gwalior">Gwalior</SelectItem>
              <SelectItem value="Jabalpur">Jabalpur</SelectItem>
              <SelectItem value="Mumbai">Mumbai</SelectItem>
              <SelectItem value="Pune">Pune</SelectItem>
              <SelectItem value="Delhi">Delhi</SelectItem>
              <SelectItem value="Bangalore">Bangalore</SelectItem>
              <SelectItem value="Ahmedabad">Ahmedabad</SelectItem>
              <SelectItem value="Hyderabad">Hyderabad</SelectItem>
              <SelectItem value="Chennai">Chennai</SelectItem>
              <SelectItem value="Kolkata">Kolkata</SelectItem>
            </SelectContent>
          </Select>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              value={step1.location?.state || ""}
              onChange={(e) =>
                setStep1({
                  ...step1,
                  location: { ...step1.location, state: e.target.value },
                })
              }
              className="bg-white text-sm"
              placeholder="State"
            />
            <Input
              value={step1.location?.pincode || ""}
              onChange={(e) =>
                setStep1({
                  ...step1,
                  location: { ...step1.location, pincode: normalizePincode(e.target.value) },
                })
              }
              className="bg-white text-sm"
              placeholder="Pincode"
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            Please ensure that this address is the same as mentioned on your FSSAI license.
          </p>
        </div>
      </section>
    </div>
  )


  // Initialize Google Places Autocomplete for Step 1 location search.
  useEffect(() => {
    if (step !== 1) return

    let cancelled = false
    let autocomplete = null

    const init = async () => {
      // Wait for the input ref to be attached
      let inputElement = null
      for (let i = 0; i < 50; i++) {
        if (locationSearchInputRef.current) {
          inputElement = locationSearchInputRef.current
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }

      if (!inputElement || cancelled) return

      const loadMaps = async () => {
        // 1. If already available with places, return true
        if (window.google?.maps?.places?.Autocomplete) {
          mapsScriptLoadedRef.current = true
          return true
        }

        // 2. Load API Key
        const apiKey = await getGoogleMapsApiKey()
        if (!apiKey) {
          debugError("Google Maps API Key missing or invalid")
          return false
        }

        // 3. Handle Auth Failure
        window.gm_authFailure = () => {
          debugError("Google Maps authentication failed.")
          // Don't show toast here as we have Nominatim fallback
        }

        // 4. Check for existing script and force libraries=places if needed
        const scripts = Array.from(document.getElementsByTagName("script"))
        const mapsScript = scripts.find(s => s.src?.includes("maps.googleapis.com/maps/api/js"))
        
        if (mapsScript && !mapsScript.src.includes("libraries=places")) {
          debugLog("Found maps script without places, removing to reload properly.")
          mapsScript.remove()
        } else if (mapsScript && mapsScript.src.includes("libraries=places")) {
           // Wait if it's still loading
           for (let i = 0; i < 60; i++) {
             if (window.google?.maps?.places?.Autocomplete) return true
             if (cancelled) return false
             await new Promise(r => setTimeout(r, 100))
           }
        }

        // 5. Create and append new script
        return new Promise((resolve) => {
          const script = document.createElement("script")
          script.id = "google-maps-sdk"
          script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&v=weekly`
          script.async = true
          script.defer = true
          script.onload = () => {
            setTimeout(() => {
              const ok = !!window.google?.maps?.places?.Autocomplete
              mapsScriptLoadedRef.current = ok
              resolve(ok)
            }, 200)
          }
          script.onerror = () => resolve(false)
          document.head.appendChild(script)
        })
      }

      const parsePlace = (place) => {
        const formattedAddress = place?.formatted_address || ""
        const comps = Array.isArray(place?.address_components) ? place.address_components : []
        const get = (types) => comps.find((c) => types.some((t) => c.types?.includes(t)))?.long_name || ""

        const area = get(["sublocality_level_1", "sublocality", "neighborhood"]) || get(["locality"])
        const city = get(["locality"]) || get(["administrative_area_level_2"])
        const state = get(["administrative_area_level_1"]) || get(["administrative_area_level_2"])
        const pincode = get(["postal_code"])
        const lat = place?.geometry?.location?.lat?.()
        const lng = place?.geometry?.location?.lng?.()

        return {
          formattedAddress,
          area,
          city,
          state,
          pincode,
          latitude: typeof lat === "number" ? Number(lat.toFixed(6)) : "",
          longitude: typeof lng === "number" ? Number(lng.toFixed(6)) : "",
        }
      }

      const ok = await loadMaps()
      if (!ok || cancelled || !inputElement) return

      if (inputElement.hasAttribute("data-google-places-initialized")) return

      try {
        const autocompleteOptions = {
          fields: ["formatted_address", "address_components", "geometry"],
          componentRestrictions: { country: "in" },
          types: ["geocode", "establishment"]
        }

        // Apply strict bounds filtering if zone is selected
        const selectedZone = zones.find(z => String(z?._id || z?.id) === String(step1.zoneId))
        if (selectedZone && Array.isArray(selectedZone.coordinates) && selectedZone.coordinates.length > 0) {
          const bounds = new window.google.maps.LatLngBounds()
          selectedZone.coordinates.forEach(coord => {
            const lat = parseFloat(coord.latitude || coord.lat)
            const lng = parseFloat(coord.longitude || coord.lng)
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              bounds.extend({ lat, lng })
            }
          })
          autocompleteOptions.bounds = bounds
          autocompleteOptions.strictBounds = true
        }

        autocomplete = new window.google.maps.places.Autocomplete(inputElement, autocompleteOptions)

        inputElement.setAttribute("data-google-places-initialized", "true")
        placesAutocompleteRef.current = autocomplete

        autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace()
          if (!place?.geometry) return

          const parsed = parsePlace(place)
          setStep1((prev) => ({
            ...prev,
            location: {
              ...prev.location,
              formattedAddress: parsed.formattedAddress || prev.location.formattedAddress,
              addressLine1: parsed.formattedAddress || prev.location.addressLine1 || "",
              area: parsed.area || prev.location.area,
              city: parsed.city || prev.location.city,
              state: parsed.state || prev.location.state,
              pincode: parsed.pincode || prev.location.pincode,
              latitude: parsed.latitude !== "" ? parsed.latitude : prev.location.latitude,
              longitude: parsed.longitude !== "" ? parsed.longitude : prev.location.longitude,
            },
          }))
          
          setLocationSearchValue(parsed.formattedAddress)
          inputElement.blur()
        })

        const pacContainerFix = () => {
          const applyFix = () => {
            const containers = document.querySelectorAll(".pac-container")
            if (containers.length > 0) {
              containers.forEach((container) => {
                container.style.zIndex = "999999"
                container.style.pointerEvents = "auto"
                if (!inputElement.value?.trim()) {
                  container.style.display = "none"
                  container.style.visibility = "hidden"
                } else {
                  container.style.visibility = "visible"
                  container.style.display = "block"
                }
              })
            }
          }
          applyFix()
          setTimeout(applyFix, 100)
          setTimeout(applyFix, 300)
        }

        inputElement.addEventListener("focus", pacContainerFix)
        inputElement.addEventListener("input", pacContainerFix)
      } catch (e) {
        debugError("Autocomplete error:", e)
      }
    }

    init().catch(() => {})

    return () => {
      cancelled = true
      if (autocomplete) {
        try { window.google?.maps?.event?.clearInstanceListeners(autocomplete) } catch {}
      }
      if (locationSearchInputRef.current) {
        locationSearchInputRef.current.removeAttribute("data-google-places-initialized")
      }
      placesAutocompleteRef.current = null
    }
  }, [step, step1.zoneId, zones])

  // Hybrid Search Fallback (Nominatim)
  useEffect(() => {
    if (step !== 1) return
    const q = String(locationSearchValue || "").trim()

    // Hide Google Places Autocomplete dropdown if query is cleared
    if (!q) {
      const containers = document.querySelectorAll(".pac-container")
      containers.forEach((container) => {
        container.style.display = "none"
        container.style.visibility = "hidden"
      })
    }

    if (q.length < 3) {
      setLocationSuggestions([])
      setIsSearchingLocation(false)
      return
    }

    const selectedZone = zones.find(z => String(z?._id || z?.id) === String(step1.zoneId))
    const zoneName = selectedZone?.name || selectedZone?.zoneName || selectedZone?.serviceLocation || ""

    const t = setTimeout(async () => {
      try {
        setIsSearchingLocation(true)
        const queryWithZone = zoneName ? `${q}, ${zoneName}` : q
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=10&q=${encodeURIComponent(queryWithZone)}&countrycodes=in`
        const res = await fetch(url, { headers: { Accept: "application/json" } })
        const json = await res.json()
        const mapped = (Array.isArray(json) ? json : []).map(r => ({
          id: r.place_id,
          display: r.display_name || "",
          lat: Number(r.lat),
          lng: Number(r.lon),
          addr: r.address || {},
        }))
        setLocationSuggestions(mapped)
      } catch (e) {
        debugError("Nominatim search failed:", e)
      } finally {
        setIsSearchingLocation(false)
      }
    }, 400)

    return () => clearTimeout(t)
  }, [locationSearchValue, step, step1.zoneId, zones])

  // Click outside to close location search suggestions dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      const isPacContainerClick = event.target.closest(".pac-container")
      if (
        locationSearchContainerRef.current &&
        !locationSearchContainerRef.current.contains(event.target) &&
        !isPacContainerClick
      ) {
        setLocationSuggestions([])
        const containers = document.querySelectorAll(".pac-container")
        containers.forEach((container) => {
          container.style.display = "none"
          container.style.visibility = "hidden"
        })
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [])

  // Load zones for onboarding dropdown (public endpoint).
  useEffect(() => {
    if (step !== 1) return
    let cancelled = false
    setZonesLoading(true)
    zoneAPI.getPublicZones()
      .then((res) => {
        const list = res?.data?.data?.zones || res?.data?.zones || []
        if (!cancelled) setZones(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        if (!cancelled) setZones([])
      })
      .finally(() => {
        if (!cancelled) setZonesLoading(false)
      })
    return () => { cancelled = true }
  }, [step])


  const renderStep2 = () => (
    <div className="space-y-6">
      {/* Images section */}
      <section className="bg-white p-4 sm:p-6 rounded-md space-y-5">
        <h2 className="text-lg font-semibold text-black">Menu & photos</h2>
        <p className="text-xs text-gray-500">
          Add clear photos of your printed menu and a primary profile image. This helps customers
          understand what you serve.
        </p>

        {/* Menu images */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-gray-700">Menu images</Label>
          <div className="mt-1 border border-dashed border-gray-300 rounded-md bg-gray-50/70 px-4 py-3 flex items-center justify-between flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-md bg-white flex items-center justify-center">
                <ImageIcon className="w-5 h-5 text-gray-700" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-medium text-gray-900">Upload menu images</span>
                <span className="text-[11px] text-gray-500">
                  JPG, PNG, WebP ? You can select multiple files
                </span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full text-xs"
              onClick={() =>
                openImageSourcePicker({
                  title: "Add menu image",
                  fileNamePrefix: "menu-image",
                  fallbackInputRef: menuImagesInputRef,
                  onSelectFile: (file) => handleMenuImagesSelected(file ? [file] : []),
                })
              }
            >
              <Upload className="w-4 h-4 mr-1.5" />
              Upload
            </Button>
            <input
              id="menuImagesInput"
              type="file"
              multiple
              accept={LOCAL_IMAGE_FILE_ACCEPT}
              className="hidden"
              ref={menuImagesInputRef}
              onChange={(e) => {
                const files = Array.from(e.target.files || [])
                if (!files.length) return
                debugLog('?? Menu images selected:', files.length, 'files')
                handleMenuImagesSelected(files)
                // Reset input to allow selecting same file again
                e.target.value = ''
              }}
            />
          </div>

          {/* Menu image previews */}
          {!!step2.menuImages.length && (
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {step2.menuImages.map((file, idx) => {
                // Handle both File objects and URL objects
                let imageUrl = null
                let imageName = `Image ${idx + 1}`

                if (isUploadableFile(file)) {
                  imageUrl = getPreviewImageUrl(file)
                  imageName = file.name || imageName
                } else if (file?.url) {
                  // If it's an object with url property (from backend)
                  imageUrl = file.url
                  imageName = file.name || `Image ${idx + 1}`
                } else if (typeof file === 'string') {
                  // If it's a direct URL string
                  imageUrl = file
                }

                return (
                  <div
                    key={idx}
                    className="relative aspect-4/5 rounded-md overflow-hidden bg-gray-100"
                  >
                    <div className="absolute top-1 right-1 z-30">
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          await handleRemoveMenuImage(idx)
                        }}
                        className="bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white rounded-full p-1 shadow-md hover:bg-gradient-to-br from-[#B80B3D] to-[#66001D] transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={`Menu ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[11px] text-gray-500 px-2 text-center">
                        Preview unavailable
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 px-2 py-1">
                      <p className="text-[10px] text-white truncate">
                        {imageName}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>


        {/* Profile image */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-gray-700">Restaurant profile image</Label>
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden border border-gray-200">
                {step2.profileImage ? (
                  (() => {
                    const imageSrc = getPreviewImageUrl(step2.profileImage)

                    return imageSrc ? (
                      <img
                        src={imageSrc}
                        alt="Restaurant profile"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-gray-500" />
                    );
                  })()
                ) : (
                  <ImageIcon className="w-6 h-6 text-gray-500" />
                )}
              </div>
              {step2.profileImage && (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await handleRemoveProfileImage()
                  }}
                  className="absolute -top-1 -right-1 bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white rounded-full p-1 shadow-md hover:bg-gradient-to-br from-[#B80B3D] to-[#66001D] transition-colors z-10"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="flex-1 flex-col flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-xs font-medium text-gray-900">Upload profile image</span>
                <span className="text-[11px] text-gray-500">
                  This will be shown on your listing card and restaurant page.
                </span>
              </div>

            </div>

          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full text-xs"
            onClick={() =>
              openImageSourcePicker({
                title: "Upload profile image",
                fileNamePrefix: "profile-image",
                fallbackInputRef: profileImageInputRef,
                onSelectFile: handleProfileImageSelected,
              })
            }
          >
            <Upload className="w-4 h-4 mr-1.5" />
            Upload
          </Button>
          <input
            id="profileImageInput"
            type="file"
            accept={LOCAL_IMAGE_FILE_ACCEPT}
            className="hidden"
            ref={profileImageInputRef}
            onChange={(e) => {
              const file = e.target.files?.[0] || null
              if (file) {
                debugLog('?? Profile image selected:', file.name)
                handleProfileImageSelected(file)
              }
              // Reset input to allow selecting same file again
              e.target.value = ''
            }}
          />
        </div>
      </section>

      {/* Operational details */}
      <section className="bg-white p-4 sm:p-6 rounded-md space-y-5">
        {/* Timings with popover time selectors */}
        <div className="space-y-3">
          <Label className="text-xs text-gray-700">Outlet timings</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TimeSelector
              label="Opening time"
              value={step2.openingTime || ""}
              onChange={(val) => {
                const nextOpening = normalizeTimeValue(val) || ""
                const openingMinutes = timeStringToMinutes(nextOpening)
                const closingMinutes = timeStringToMinutes(step2.closingTime)
                if (openingMinutes !== null && closingMinutes !== null) {
                  if (openingMinutes === closingMinutes) {
                    setError("Opening time and closing time cannot be same")
                    return
                  }
                  if (closingMinutes < openingMinutes) {
                    setError("Closing time cannot be less than opening time")
                    return
                  }
                }
                setStep2((prev) => ({ ...prev, openingTime: nextOpening }))
              }}
            />
            <TimeSelector
              label="Closing time"
              value={step2.closingTime || ""}
              onChange={(val) => {
                const nextClosing = normalizeTimeValue(val) || ""
                const openingMinutes = timeStringToMinutes(step2.openingTime)
                const closingMinutes = timeStringToMinutes(nextClosing)
                if (openingMinutes !== null && closingMinutes !== null) {
                  if (openingMinutes === closingMinutes) {
                    setError("Opening time and closing time cannot be same")
                    return
                  }
                  if (closingMinutes < openingMinutes) {
                    setError("Closing time cannot be less than opening time")
                    return
                  }
                }
                setStep2((prev) => ({ ...prev, closingTime: nextClosing }))
              }}
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">Estimated delivery time*</Label>
            <Input
              value={step2.estimatedDeliveryTime || ""}
              onChange={(e) =>
                setStep2((prev) => ({ ...prev, estimatedDeliveryTime: e.target.value }))
              }
              className="mt-1 bg-white text-sm"
              placeholder="e.g., 25-30 mins"
            />
          </div>
        </div>

        {/* Open days in a calendar-like grid */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-700 flex items-center gap-1.5">
            <CalendarIcon className="w-3.5 h-3.5 text-gray-800" />
            <span>Open days</span>
          </Label>
          <p className="text-[11px] text-gray-500">
            Select the days your restaurant accepts delivery orders.
          </p>
          <div className="mt-1 grid grid-cols-7 gap-1.5 sm:gap-2">
            {daysOfWeek.map((day) => {
              const active = step2.openDays.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className={`aspect-square flex items-center justify-center rounded-md text-[11px] font-medium ${active ? "bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white" : "bg-gray-100 text-gray-800"
                    }`}
                >
                  {day.charAt(0)}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* Takeaway Service Toggle */}
      <section className="bg-white p-4 sm:p-6 rounded-md space-y-5">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <ShoppingBag className="w-4 h-4 text-green-600" />
              <span>Takeaway (Pickup) order</span>
            </Label>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Enable this to allow customers to pick up orders themselves from your restaurant.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setStep2(prev => ({ ...prev, isTakeawayEnabled: !prev.isTakeawayEnabled }))}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              step2.isTakeawayEnabled ? "bg-green-600" : "bg-gray-200"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                step2.isTakeawayEnabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

      </section>
    </div>
  )

  const renderStep3 = () => (
    <div className="space-y-6">
      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">PAN details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs text-gray-700">PAN number</Label>
            <Input
              value={step3.panNumber || ""}
              onChange={(e) => setStep3({ ...step3, panNumber: normalizePAN(e.target.value) })}
              className="mt-1 bg-white text-sm"
              placeholder="ABCDE1234F"
            />
          </div>
          <div>
            <Label className="text-xs text-gray-700">PAN Card Holder Name</Label>
            <Input
              value={step3.nameOnPan || ""}
              onChange={(e) =>
                setStep3({
                  ...step3,
                  nameOnPan: formatNameToCapital(e.target.value.replace(/[^A-Za-z ]/g, "")),
                })
              }
              className="mt-1 bg-white text-sm"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs text-gray-700">PAN image</Label>
          <Button
            type="button"
            variant="outline"
            className="mt-2 w-full text-xs"
            onClick={() =>
              openImageSourcePicker({
                title: "Upload PAN image",
                fileNamePrefix: "pan-image",
                fallbackInputRef: panImageInputRef,
                onSelectFile: handlePanImageSelected,
              })
            }
          >
            <Upload className="w-4 h-4 mr-1.5" />
            Upload
          </Button>
          <input
            type="file"
            accept={GALLERY_IMAGE_ACCEPT}
            className="hidden"
            ref={panImageInputRef}
            onChange={(e) => {
              handlePanImageSelected(e.target.files?.[0] || null)
              e.target.value = ""
            }}
          />
          {step3.panImage && (
            <div className="mt-3 relative aspect-4/3 rounded-md overflow-hidden bg-gray-100">
              {getPreviewImageUrl(step3.panImage) ? (
                <img
                  src={getPreviewImageUrl(step3.panImage)}
                  alt="PAN document"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                  Preview unavailable
                </div>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setStep3((prev) => ({ ...prev, panImage: null }))
                }}
                className="absolute top-2 right-2 bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white rounded-full p-1 shadow-md hover:bg-gradient-to-br from-[#B80B3D] to-[#66001D] transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">GST details</h2>
        <div className="flex gap-4 items-center text-sm">
          <span className="text-gray-700">GST registered?</span>
          <button
            type="button"
            onClick={() => setStep3({ ...step3, gstRegistered: true })}
            className={`px-3 py-1.5 text-xs rounded-full ${step3.gstRegistered ? "bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white" : "bg-gray-100 text-gray-800"
              }`}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => setStep3({ ...step3, gstRegistered: false })}
            className={`px-3 py-1.5 text-xs rounded-full ${!step3.gstRegistered ? "bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white" : "bg-gray-100 text-gray-800"
              }`}
          >
            No
          </button>
        </div>
        {step3.gstRegistered && (
          <div className="space-y-3">
            <Input
              value={step3.gstNumber || ""}
              onChange={(e) => setStep3({ ...step3, gstNumber: normalizeGST(e.target.value) })}
              className="bg-white text-sm"
              placeholder="GST number (15 characters)"
            />
            <Input
              value={step3.gstLegalName || ""}
              onChange={(e) =>
                setStep3({
                  ...step3,
                  gstLegalName: formatNameToCapital(e.target.value.replace(/[^A-Za-z ]/g, "")),
                })
              }
              className="bg-white text-sm"
              placeholder="Legal name"
            />
            <Input
              value={step3.gstAddress || ""}
              onChange={(e) => setStep3({ ...step3, gstAddress: e.target.value })}
              className="bg-white text-sm"
              placeholder="Registered address"
            />
            <Button
              type="button"
              variant="outline"
              className="w-full text-xs"
              onClick={() =>
                openImageSourcePicker({
                  title: "Upload GST image",
                  fileNamePrefix: "gst-image",
                  fallbackInputRef: gstImageInputRef,
                  onSelectFile: handleGstImageSelected,
                })
              }
            >
              <Upload className="w-4 h-4 mr-1.5" />
              Upload
            </Button>
            <input
              type="file"
              accept={GALLERY_IMAGE_ACCEPT}
              className="hidden"
              ref={gstImageInputRef}
              onChange={(e) => {
                handleGstImageSelected(e.target.files?.[0] || null)
                e.target.value = ""
              }}
            />
            {step3.gstImage && (
              <div className="mt-3 relative aspect-4/3 rounded-md overflow-hidden bg-gray-100">
                {getPreviewImageUrl(step3.gstImage) ? (
                  <img
                    src={getPreviewImageUrl(step3.gstImage)}
                    alt="GST document"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                    Preview unavailable
                  </div>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setStep3((prev) => ({ ...prev, gstImage: null }))
                  }}
                  className="absolute top-2 right-2 bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white rounded-full p-1 shadow-md hover:bg-gradient-to-br from-[#B80B3D] to-[#66001D] transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">FSSAI details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            value={step3.fssaiNumber || ""}
            onChange={(e) =>
              setStep3({ ...step3, fssaiNumber: e.target.value.replace(/\D/g, "").slice(0, 14) })
            }
            className="bg-white text-sm"
            placeholder="FSSAI number (14 digits)"
          />
          <div>
            <Label className="text-xs text-gray-700 mb-1 block">FSSAI expiry date</Label>
            <Popover open={isFssaiCalendarOpen} onOpenChange={setIsFssaiCalendarOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={() => setIsFssaiCalendarOpen(true)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-md bg-white text-sm text-left flex items-center justify-between hover:bg-gray-50"
                >
                  <span className={step3.fssaiExpiry ? "text-gray-900" : "text-gray-500"}>
                    {step3.fssaiExpiry
                      ? parseLocalYMDDate(step3.fssaiExpiry)?.toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })
                      : "Select expiry date"}
                  </span>
                  <CalendarIcon className="w-4 h-4 text-gray-500" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 z-100" align="start">
                <div className="bg-white rounded-md shadow-lg border border-gray-200">
                  <Calendar
                    mode="single"
                    selected={parseLocalYMDDate(step3.fssaiExpiry)}
                    disabled={(date) => formatDateToLocalYMD(date) < getTodayLocalYMD()}
                    onSelect={(date) => {
                      if (date && formatDateToLocalYMD(date) >= getTodayLocalYMD()) {
                        const formattedDate = formatDateToLocalYMD(date)
                        setStep3({ ...step3, fssaiExpiry: formattedDate })
                        setIsFssaiCalendarOpen(false)
                      }
                    }}
                    initialFocus
                    classNames={{
                      today: "bg-transparent text-foreground border-none", // Remove today highlight
                    }}
                  />
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full text-xs"
          onClick={() =>
            openImageSourcePicker({
              title: "Upload FSSAI image",
              fileNamePrefix: "fssai-image",
              fallbackInputRef: fssaiImageInputRef,
              onSelectFile: handleFssaiImageSelected,
            })
          }
        >
          <Upload className="w-4 h-4 mr-1.5" />
          Upload
        </Button>
        <input
          type="file"
          accept={GALLERY_IMAGE_ACCEPT}
          className="hidden"
          ref={fssaiImageInputRef}
          onChange={(e) => {
            handleFssaiImageSelected(e.target.files?.[0] || null)
            e.target.value = ""
          }}
        />
        {step3.fssaiImage && (
          <div className="mt-3 relative aspect-4/3 rounded-md overflow-hidden bg-gray-100">
            {getPreviewImageUrl(step3.fssaiImage) ? (
              <img
                src={getPreviewImageUrl(step3.fssaiImage)}
                alt="FSSAI document"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                Preview unavailable
              </div>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setStep3((prev) => ({ ...prev, fssaiImage: null }))
              }}
              className="absolute top-2 right-2 bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white rounded-full p-1 shadow-md hover:bg-gradient-to-br from-[#B80B3D] to-[#66001D] transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </section>

      <section className="bg-white p-4 sm:p-6 rounded-md space-y-4">
        <h2 className="text-lg font-semibold text-black">Bank account details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            value={step3.accountNumber || ""}
            onChange={(e) => setStep3({ ...step3, accountNumber: normalizeBankAcc(e.target.value) })}
            className="bg-white text-sm"
            placeholder="Account number"
          />
          <Input
            value={step3.confirmAccountNumber || ""}
            onChange={(e) => setStep3({ ...step3, confirmAccountNumber: normalizeBankAcc(e.target.value) })}
            className="bg-white text-sm"
            placeholder="Re-enter account number"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            value={step3.ifscCode || ""}
            onChange={(e) => setStep3({ ...step3, ifscCode: normalizeIFSC(e.target.value) })}
            className="bg-white text-sm"
            placeholder="IFSC code"
          />
          <Select
            value={step3.accountType || ""}
            onValueChange={(value) => setStep3({ ...step3, accountType: value })}
          >
            <SelectTrigger className="bg-white text-sm">
              <SelectValue placeholder="Select account type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Saving">Saving</SelectItem>
              <SelectItem value="Current">Current</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Input
          value={step3.accountHolderName || ""}
          onChange={(e) =>
            setStep3({
              ...step3,
              accountHolderName: formatNameToCapital(e.target.value.replace(/[^A-Za-z ]/g, "")),
            })
          }
          className="bg-white text-sm"
          placeholder="Account holder name"
        />
      </section>
    </div>
  )

  const renderStep = () => {
    if (step === 1) return renderStep1()
    if (step === 2) return renderStep2()
    return renderStep3()
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <style dangerouslySetInnerHTML={{ __html: `
        .pac-container {
          background-color: #ffffff !important;
          border: 1px solid #e5e7eb !important;
          border-radius: 16px !important;
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.08) !important;
          font-family: 'Poppins', sans-serif !important;
          padding: 4px !important;
          margin-top: 6px !important;
          z-index: 999999 !important;
          border-top: 1px solid #e5e7eb !important;
          max-height: 280px !important;
          overflow-y: auto !important;
        }
        /* Customize scrollbar inside pac-container and custom-scrollbar for premium styling */
        .pac-container::-webkit-scrollbar,
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px !important;
        }
        .pac-container::-webkit-scrollbar-track,
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent !important;
        }
        .pac-container::-webkit-scrollbar-thumb,
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #d1d5db !important;
          border-radius: 20px !important;
        }
        .pac-container::-webkit-scrollbar-thumb:hover,
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #9ca3af !important;
        }
        .pac-item {
          padding: 10px 6px !important;
          font-size: 14px !important;
          color: #4b5563 !important;
          border-bottom: 1px solid #f3f4f6 !important;
          cursor: pointer !important;
          display: flex !important;
          align-items: center !important;
          transition: all 0.2s ease !important;
          border-radius: 12px !important;
          margin-bottom: 2px !important;
        }
        .pac-item:last-child {
          border-bottom: none !important;
          margin-bottom: 0 !important;
        }
        .pac-item:hover {
          background-color: #fef2f2 !important;
          color: #dc2626 !important;
        }
        .pac-item-query {
          font-size: 14px !important;
          color: #111827 !important;
          font-weight: 600 !important;
          padding-right: 4px !important;
        }
        .pac-item:hover .pac-item-query {
          color: #dc2626 !important;
        }
        .pac-icon {
          background-image: none !important;
          width: 20px !important;
          height: 20px !important;
          margin-right: 6px !important;
          margin-left: -2px !important;
          margin-top: 0 !important;
          display: inline-block !important;
          position: relative !important;
          flex-shrink: 0 !important;
          background-repeat: no-repeat !important;
        }
        .pac-icon::before {
          content: "" !important;
          position: absolute !important;
          inset: 0 !important;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23DC2626' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z'/%3E%3Ccircle cx='12' cy='10' r='3'/%3E%3C/svg%3E") !important;
          background-size: contain !important;
          background-repeat: no-repeat !important;
        }
        .pac-logo::after {
          margin-right: 12px !important;
          margin-bottom: 6px !important;
          opacity: 0.5 !important;
        }
        .pac-matched {
          color: #dc2626 !important;
          font-weight: 700 !important;
        }
      ` }} />
      {loading ? (
        <OnboardingSkeleton />
      ) : (
        <div className="min-h-screen bg-gray-100 flex flex-col">
          <header className="px-4 py-4 sm:px-6 sm:py-5 bg-white flex items-center justify-between border-b">
            <div className="flex items-center gap-3">
              {step === 1 ? (
                <button
                  onClick={requestExit}
                  className="w-9 h-9 flex items-center justify-center bg-gray-50 hover:bg-gray-100 border border-gray-200/80 rounded-full shadow-sm transition-all duration-200 active:scale-90 hover:shadow"
                  aria-label="Close onboarding"
                >
                  <X className="w-[18px] h-[18px] text-gray-700 stroke-[2.5]" />
                </button>
              ) : (
                <button
                  onClick={handleBack}
                  className="w-9 h-9 flex items-center justify-center bg-gray-50 hover:bg-gray-100 border border-gray-200/80 rounded-full shadow-sm transition-all duration-200 active:scale-90 hover:shadow"
                  aria-label="Go back"
                >
                  <ArrowLeft className="w-[18px] h-[18px] text-gray-700 stroke-[2.5]" />
                </button>
              )}
              <div className="text-sm font-semibold text-black">Restaurant onboarding</div>
            </div>
            <div className="flex items-center gap-3">
              {!isEditing && (
                <Button
                  onClick={() => setIsEditing(true)}
                  variant="outline"
                  size="sm"
                  className="text-xs bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100 flex items-center gap-1.5"
                  title="Edit Details"
                >
                  <Sparkles className="w-3 h-3" />
                  Edit Details
                </Button>
              )}
              <div className="flex items-center gap-3">
                <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider text-right">
                  Step {step} of 3
                </div>
                <Button
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-[#B80B3D] hover:text-red-700 hover:bg-red-50"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            </div>

          </header>

          <main
            className="flex-1 px-4 sm:px-6 py-4 space-y-4"
            style={{ paddingBottom: keyboardInset ? `${keyboardInset + 20}px` : undefined }}
            onFocusCapture={(e) => {
              const target = e.target
              if (!(target instanceof HTMLElement)) return
              if (!target.matches("input, textarea, select")) return
              window.setTimeout(() => {
                target.scrollIntoView({ behavior: "smooth", block: "center" })
              }, 250)
            }}
          >
            <div className={!isEditing ? "pointer-events-none select-none" : ""}>
              {renderStep()}
            </div>
          </main>

        <ImageSourcePicker
          isOpen={sourcePicker.isOpen}
          onClose={closeImageSourcePicker}
          onFileSelect={sourcePicker.onSelectFile}
          title={sourcePicker.title}
          fileNamePrefix={sourcePicker.fileNamePrefix}
          galleryInputRef={sourcePicker.fallbackInputRef}
        />

        <OnboardingExitModal
          open={showExitModal}
          onStay={handleStay}
          onExit={handleExit}
          theme="restaurant"
        />

        {error && (
          <div className="px-4 sm:px-6 pb-2 text-xs text-[#B80B3D]">
            {error}
          </div>
        )}

        <footer className={`px-4 sm:px-6 py-3 bg-white border-t border-slate-100 ${keyboardInset ? "hidden" : ""}`}>
          <div className={`flex items-center w-full ${step > 1 ? "gap-3" : ""}`}>
            {step > 1 && (
              <Button
                type="button"
                onClick={handleBack}
                disabled={saving}
                className="flex-1 text-base font-bold h-11 bg-gradient-to-br from-[#B80B3D] to-[#66001D] hover:from-[#c90f49] hover:to-[#7a0024] text-white border-0 shadow-md shadow-[#B80B3D]/20 transition-all active:scale-[0.98]"
              >
                Back
              </Button>
            )}
            <Button
              onClick={handleNext}
              disabled={saving || (step === 3 && !isEditing)}
              className={`text-base font-bold h-11 bg-gradient-to-br from-[#B80B3D] to-[#66001D] hover:from-[#c90f49] hover:to-[#7a0024] text-white px-6 shadow-md shadow-[#B80B3D]/20 transition-all active:scale-[0.98] ${step === 1 ? "w-full" : "flex-1"} ${(step === 3 && !isEditing) ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {step === 3 ? (saving ? "Saving..." : "Finish") : saving ? "Saving..." : "Continue"}
            </Button>
          </div>
        </footer>
      </div>
      )}
    </LocalizationProvider>
  )
}











import { useState, useEffect, useRef } from "react"
import { useNavigate, Link, useLocation } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { Loader2, Pencil, X, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { deliveryAPI } from "@food/api"
import { setAuthData as storeAuthData, clearModuleAuth } from "@food/utils/auth"
import { collectFcmTokenFast, persistModuleFcmToken, finalizeDeliveryPendingSubmission, prefetchModuleFcmToken } from "@food/utils/firebaseMessaging"
import { getUserFacingApiError, showUserFacingApiError } from "@/shared/utils/apiError"

const DEFAULT_COUNTRY_CODE = "+91"

export default function DeliverySignIn() {
  const navigate = useNavigate()
  const location = useLocation()
  const isOtpStep = location.pathname.endsWith("/otp")

  // Step 1 States
  const defaultTestPhone =
    import.meta.env.VITE_USE_DEFAULT_TEST_PHONE === "true"
      ? String(import.meta.env.VITE_DEFAULT_TEST_PHONE || "").replace(/\D/g, "").slice(0, 10)
      : ""

  const [phone, setPhone] = useState(() => {
    try {
      if (sessionStorage.getItem("deliveryClearLoginPhone") === "1") {
        sessionStorage.removeItem("deliveryClearLoginPhone")
        sessionStorage.removeItem("deliveryAuthData")
        // return ""
        return defaultTestPhone
      }
      const stored = sessionStorage.getItem("deliveryAuthData")
      if (stored) {
        const data = JSON.parse(stored)
        // return data.phone ? data.phone.replace("+91", "").trim() : ""
        return data.phone ? data.phone.replace("+91", "").trim() : defaultTestPhone
      }
    } catch (e) {
      // return ""
      return defaultTestPhone
    }
    // return ""
    return defaultTestPhone
  })
  const [loading, setLoading] = useState(false)
  const submitting = useRef(false)

  // Step 2 States
  const [otp, setOtp] = useState(["", "", "", ""])
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [resendTimer, setResendTimer] = useState(0)
  const [blockTimer, setBlockTimer] = useState(0)
  const [authData, setAuthData] = useState(null)
  const [showNameInput, setShowNameInput] = useState(false)
  const [name, setName] = useState("")
  const [nameError, setNameError] = useState("")
  const [verifiedOtp, setVerifiedOtp] = useState("")
  const [pendingMessage, setPendingMessage] = useState("")
  const [isRejected, setIsRejected] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")
  const [deviceToken, setDeviceToken] = useState(null)
  const [activePlatform, setActivePlatform] = useState("web")
  const [showRestorePopup, setShowRestorePopup] = useState(false)
  const [deletedAccountData, setDeletedAccountData] = useState(null)
  const inputRefs = useRef([])
  // iOS only opens the soft-keyboard from a focus() that happens *inside* a
  // user gesture. This hidden input is focused synchronously on the "Log in"
  // tap so the keyboard opens, then focus is transferred to the OTP boxes once
  // they mount (focus transfer keeps the keyboard up on iOS).
  const focusKeeperRef = useRef(null)
  const keyboardPrimedRef = useRef(false)
  const [instantAuthTransition, setInstantAuthTransition] = useState(false)

  const clearPersistedLoginPhone = () => {
    try {
      sessionStorage.removeItem("deliveryAuthData")
      sessionStorage.setItem("deliveryClearLoginPhone", "1")
    } catch {
      // ignore
    }
    setPhone("")
  }

  const getBlockKey = (phoneStr) => {
    const clean = phoneStr?.replace(/\D/g, "") || ""
    return clean ? `delivery_block_expires_at_${clean}` : "delivery_block_expires_at"
  }

  const getResendKey = (phoneStr) => {
    const clean = phoneStr?.replace(/\D/g, "") || ""
    return clean ? `delivery_resend_expires_at_${clean}` : "delivery_resend_expires_at"
  }

  const resetPendingVerificationState = () => {
    setPendingMessage("")
    setIsRejected(false)
    setRejectionReason("")
  }

  const handleBackToLogin = () => {
    setInstantAuthTransition(true)
    navigate("/food/delivery/login", { replace: true })
  }

  useEffect(() => {
    prefetchModuleFcmToken("delivery")
  }, [])

  // Handle route change transitions
  useEffect(() => {
    if (!isOtpStep) {
      setOtp(["", "", "", ""])
      setError("")
      setShowNameInput(false)
      resetPendingVerificationState()
      return
    }

    const stored = sessionStorage.getItem("deliveryAuthData")
    let currentPhone = ""
    if (stored) {
      const data = JSON.parse(stored)
      setAuthData(data)
      currentPhone = data.phone || ""
    } else {
      navigate("/food/delivery/login", { replace: true })
      return
    }

    const blockKey = getBlockKey(currentPhone)
    const resendKey = getResendKey(currentPhone)

    // Resume block timer
    const savedBlockExpiry = sessionStorage.getItem(blockKey)
    if (savedBlockExpiry) {
      const remaining = Math.max(0, Math.floor((parseInt(savedBlockExpiry) - Date.now()) / 1000))
      if (remaining > 0) {
        setBlockTimer(remaining)
      } else {
        sessionStorage.removeItem(blockKey)
      }
    } else if (location.state?.initialBlockMins) {
      const seconds = Math.ceil(location.state.initialBlockMins * 60)
      setBlockTimer(seconds)
      sessionStorage.setItem(blockKey, (Date.now() + (seconds * 1000)).toString())
    }

    // Resume resend timer
    const savedResendExpiry = sessionStorage.getItem(resendKey)
    if (savedResendExpiry) {
      const remaining = Math.max(0, Math.floor((parseInt(savedResendExpiry) - Date.now()) / 1000))
      if (remaining > 0) {
        setResendTimer(remaining)
      } else {
        sessionStorage.removeItem(resendKey)
      }
    } else {
      setResendTimer(59)
      sessionStorage.setItem(resendKey, (Date.now() + (59 * 1000)).toString())
    }
  }, [isOtpStep, navigate, location.state])

  useEffect(() => {
    if (!instantAuthTransition || isOtpStep) return
    const timer = window.setTimeout(() => setInstantAuthTransition(false), 0)
    return () => window.clearTimeout(timer)
  }, [instantAuthTransition, isOtpStep])

  // Timers
  useEffect(() => {
    if (resendTimer <= 0) return
    const timer = setInterval(() => {
      setResendTimer((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [resendTimer])

  useEffect(() => {
    if (blockTimer <= 0) return
    const timer = setInterval(() => {
      setBlockTimer((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [blockTimer])

  // Focus first OTP field + open mobile keyboard automatically
  useEffect(() => {
    if (isOtpStep && !showNameInput && !pendingMessage) {
      const focusFirst = () => {
        const el = inputRefs.current[0]
        if (el) {
          el.focus()
          // In mobile WebView the soft keyboard often won't open on a
          // programmatic focus alone, so also trigger a click to force it.
          el.click()
        }
      }
      // If the keyboard was primed on the "Log in" tap (iOS), transfer focus
      // ASAP so the already-open keyboard stays up instead of closing.
      if (keyboardPrimedRef.current) {
        keyboardPrimedRef.current = false
        requestAnimationFrame(focusFirst)
        return
      }
      const timer = setTimeout(focusFirst, 250)
      return () => clearTimeout(timer)
    }
  }, [isOtpStep, showNameInput, pendingMessage])

  const validatePhone = (num) => {
    const digits = num.replace(/\D/g, "")
    return digits.length === 10 && ["6", "7", "8", "9"].includes(digits[0])
  }

  // Send OTP (Action Step 1)
  const handleSendOTP = async (e) => {
    if (e) e.preventDefault()
    if (!validatePhone(phone)) {
      toast.error("Please enter a valid 10-digit mobile number")
      return
    }
    // Prime the keyboard inside the tap gesture so iOS keeps it open while we
    // navigate to the OTP step (Android focuses fine on mount).
    if (focusKeeperRef.current) {
      focusKeeperRef.current.focus()
      keyboardPrimedRef.current = true
    }
    if (submitting.current) return
    submitting.current = true
    setLoading(true)

    const fullPhone = `${DEFAULT_COUNTRY_CODE} ${phone}`.trim()

    try {
      clearModuleAuth("delivery")
      await deliveryAPI.sendOTP(fullPhone, "login")

      const authData = {
        method: "phone",
        phone: fullPhone,
        isSignUp: false,
        purpose: "login",
        module: "delivery",
      }
      sessionStorage.setItem("deliveryAuthData", JSON.stringify(authData))
      navigate("/food/delivery/otp")
    } catch (err) {
      const msg = getUserFacingApiError(err, "Failed to send OTP. Please try again.")
      const lowerMsg = msg.toLowerCase()
      const isBlocked = lowerMsg.includes("blocked") || 
                        lowerMsg.includes("too many attempts") || 
                        lowerMsg.includes("try again after")

      if (isBlocked) {
        let totalMins = 3
        const timeMatch = msg.match(/(\d+)(?::(\d+))?/)
        if (timeMatch) {
          const mins = parseInt(timeMatch[1])
          const secs = timeMatch[2] ? parseInt(timeMatch[2]) / 60 : 0
          totalMins = mins + secs
        }

        const authData = {
          method: "phone",
          phone: fullPhone,
          isSignUp: false,
          purpose: "login",
          module: "delivery",
        }
        sessionStorage.setItem("deliveryAuthData", JSON.stringify(authData))
        navigate("/food/delivery/otp", { state: { initialBlockMins: totalMins } })
        return
      }
      showUserFacingApiError(err, "Failed to send OTP. Please try again.")
    } finally {
      setLoading(false)
      submitting.current = false
    }
  }

  // Verify OTP (Action Step 2)
  const handleVerify = async (otpValue = null, confirmAction = null) => {
    if (showNameInput && !confirmAction) return

    const code = otpValue || otp.join("")

    if (code.length !== 4) {
      toast.error("Please enter the complete 4-digit code")
      return
    }

    if (loading || blockTimer > 0) return

    setLoading(true)
    setError("")

    try {
      const phoneVal = authData?.phone
      const purpose = authData?.purpose || "login"
      const providedName = authData?.isSignUp ? authData?.name || null : null
      if (!phoneVal) {
        setError("Phone number not found. Please try again.")
        setLoading(false)
        return
      }

      const { fcmToken, platform } = await collectFcmTokenFast("delivery")

      setDeviceToken(fcmToken)
      setActivePlatform(platform)

      const response = await deliveryAPI.verifyOTP(phoneVal, code, purpose, providedName, fcmToken, platform, confirmAction)
      const data = response?.data?.data || response?.data || {}

      if (data?.deletedAccountFound) {
        setDeletedAccountData(data)
        setShowRestorePopup(true)
        setLoading(false)
        return
      }

      if (data.pendingApproval === true) {
        sessionStorage.removeItem("deliveryAuthData")
        sessionStorage.removeItem(getBlockKey(phoneVal))
        sessionStorage.removeItem(getResendKey(phoneVal))
        const digits = String(phoneVal || "").replace(/\D/g, "").slice(-10)
        const rejected = Boolean(data.isRejected)
        setLoading(false)
        finalizeDeliveryPendingSubmission(
          navigate,
          digits,
          {
            fcmToken,
            platform,
            status: rejected ? "rejected" : "pending",
            message: data.message,
            rejectionReason: data.rejectionReason,
          },
        )
        return
      }

      const needsRegistration = data.needsRegistration === true

      if (needsRegistration) {
        sessionStorage.removeItem("deliveryAuthData")
        sessionStorage.removeItem(getBlockKey(phoneVal))
        sessionStorage.removeItem(getResendKey(phoneVal))
        sessionStorage.setItem("deliveryNeedsRegistration", "true")
        const digits = String(phoneVal || "").replace(/\D/g, "")
        const details = {
          name: "",
          phone: digits.slice(-10),
          countryCode: "+91",
        }
        sessionStorage.setItem("deliverySignupDetails", JSON.stringify(details))
        navigate("/food/delivery/signup/details", { replace: true })
        return
      }

      const accessToken = data.accessToken
      const refreshToken = data.refreshToken || null
      const user = data.user

      if (!accessToken || !user) {
        throw new Error("Invalid response from server")
      }

      sessionStorage.removeItem("deliveryAuthData")
      sessionStorage.removeItem(getBlockKey(phoneVal))
      sessionStorage.removeItem(getResendKey(phoneVal))

      try {
        storeAuthData("delivery", accessToken, user, refreshToken)
      } catch (storageError) {
        setError("Failed to save authentication. Please try again.")
        setLoading(false)
        return
      }

      window.dispatchEvent(new Event("deliveryAuthChanged"))
      try {
        await persistModuleFcmToken("delivery", { maxAttempts: 8, delayMs: 400 })
      } catch {}
      setSuccess(true)

      let retryCount = 0
      const maxRetries = 10
      const verifyAndNavigate = () => {
        const storedToken = localStorage.getItem("delivery_accessToken")
        const storedAuth = localStorage.getItem("delivery_authenticated")

        if (storedToken && storedAuth === "true") {
          navigate("/food/delivery", { replace: true })
        } else if (retryCount < maxRetries) {
          retryCount++
          setTimeout(verifyAndNavigate, 100)
        } else {
          setError("Failed to save authentication. Please try again.")
          setLoading(false)
        }
      }
      setTimeout(verifyAndNavigate, 200)
    } catch (err) {
      const message = getUserFacingApiError(err, "Failed to verify OTP. Please try again.")

      setOtp(["", "", "", ""])
      setTimeout(() => {
        inputRefs.current[0]?.focus()
      }, 50)

      const isBlocked = message.toLowerCase().includes("blocked") || 
                        message.toLowerCase().includes("too many attempts") || 
                        message.toLowerCase().includes("try again after")

      if (isBlocked) {
        let totalSeconds = 180
        const timeMatch = message.match(/(\d+)(?::(\d+))?/)
        if (timeMatch) {
          const mins = parseInt(timeMatch[1])
          const secs = timeMatch[2] ? parseInt(timeMatch[2]) : 0
          totalSeconds = (mins * 60) + secs
        }
        setBlockTimer(totalSeconds)
        sessionStorage.setItem(getBlockKey(authData?.phone || ""), (Date.now() + (totalSeconds * 1000)).toString())
        setError("")
      } else if (/invalid/i.test(message)) {
        setError("Invalid OTP")
        toast.error("Invalid OTP", { id: "user-facing-api-error" })
      } else {
        setError(message)
        showUserFacingApiError(err, message)
      }
      setLoading(false)
    }
  }

  // Name Submission (Action Step 3)
  const handleSubmitName = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setNameError("Name is required")
      return
    }

    if (!verifiedOtp) {
      setError("OTP verification step missing. Please request a new OTP.")
      return
    }

    setLoading(true)
    setError("")
    setNameError("")

    try {
      const phoneVal = authData?.phone
      const purpose = authData?.purpose || "login"
      if (!phoneVal) {
        setError("Phone number not found. Please try again.")
        return
      }

      const response = await deliveryAPI.verifyOTP(phoneVal, verifiedOtp, purpose, trimmedName, deviceToken, activePlatform)
      const data = response?.data?.data || response?.data || {}

      const accessToken = data.accessToken
      const refreshToken = data.refreshToken || null
      const user = data.user

      if (!accessToken || !user) {
        throw new Error("Invalid response from server")
      }

      sessionStorage.removeItem("deliveryAuthData")

      try {
        storeAuthData("delivery", accessToken, user, refreshToken)
      } catch (storageError) {
        setError("Failed to save authentication. Please try again.")
        setLoading(false)
        return
      }

      window.dispatchEvent(new Event("deliveryAuthChanged"))
      setSuccess(true)
      setLoading(false)

      let retryCount = 0
      const maxRetries = 10
      const verifyAndNavigate = () => {
        const storedToken = localStorage.getItem("delivery_accessToken")
        const storedAuth = localStorage.getItem("delivery_authenticated")

        if (storedToken && storedAuth === "true") {
          navigate("/food/delivery", { replace: true })
        } else if (retryCount < maxRetries) {
          retryCount++
          setTimeout(verifyAndNavigate, 100)
        } else {
          setError("Failed to save authentication. Please try again.")
          setLoading(false)
        }
      }
      setTimeout(verifyAndNavigate, 200)
    } catch (err) {
      const message = getUserFacingApiError(err, "Failed to complete registration. Please try again.")
      setError(message)
      showUserFacingApiError(err, "Failed to complete registration. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleRestoreAction = async (action) => {
    setShowRestorePopup(false)
    const code = otp.join("")
    await handleVerify(code, action)
  }

  const handleResend = async () => {
    if (resendTimer > 0 || blockTimer > 0) return

    setLoading(true)
    setError("")

    try {
      const phoneVal = authData?.phone
      const purpose = authData?.purpose || "login"
      if (!phoneVal) {
        setError("Phone number not found. Please go back and try again.")
        setLoading(false)
        return
      }

      await deliveryAPI.sendOTP(phoneVal, purpose)
      setResendTimer(59)
      sessionStorage.setItem(getResendKey(phoneVal), (Date.now() + (59 * 1000)).toString())
      setOtp(["", "", "", ""])
      setShowNameInput(false)
      setName("")
      setNameError("")
      setVerifiedOtp("")
      inputRefs.current[0]?.focus()
      toast.success("OTP resent successfully.")
    } catch (err) {
      const message = getUserFacingApiError(err, "Failed to resend OTP. Please try again.")

      const isBlocked = message.toLowerCase().includes("blocked") || 
                        message.toLowerCase().includes("too many attempts") || 
                        message.toLowerCase().includes("try again after")

      if (isBlocked) {
        let totalSeconds = 180
        const timeMatch = message.match(/(\d+)(?::(\d+))?/)
        if (timeMatch) {
          const mins = parseInt(timeMatch[1])
          const secs = timeMatch[2] ? parseInt(timeMatch[2]) : 0
          totalSeconds = (mins * 60) + secs
        }
        setBlockTimer(totalSeconds)
        sessionStorage.setItem(getBlockKey(authData?.phone || ""), (Date.now() + (totalSeconds * 1000)).toString())
        setError("")
      } else {
        setError(message)
        showUserFacingApiError(err, "Failed to resend OTP. Please try again.")
      }
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (index, value) => {
    if (index === 0 && value) {
      setError("")
    }

    if (value.length > 1) {
      const digits = value.replace(/\D/g, "").slice(0, 4 - index).split("")
      if (digits.length > 0) {
        const newOtp = [...otp]
        digits.forEach((digit, i) => {
          if (index + i < 4) {
            newOtp[index + i] = digit
          }
        })
        setOtp(newOtp)
        inputRefs.current[Math.min(3, index + digits.length)]?.focus()
      }
      return
    }

    if (value && !/^\d$/.test(value)) return

    const newOtp = [...otp]
    newOtp[index] = value
    setOtp(newOtp)

    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleKeyDown = (index, e) => {
    if (e.key === "Backspace") {
      if (!otp[index] && index > 0) {
        inputRefs.current[index - 1]?.focus()
        const newOtp = [...otp]
        newOtp[index - 1] = ""
        setOtp(newOtp)
      } else if (otp[index]) {
        const newOtp = [...otp]
        newOtp[index] = ""
        setOtp(newOtp)
      }
    }
    if (e.key === "v" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      navigator.clipboard.readText().then((text) => {
        const digits = text.replace(/\D/g, "").slice(0, 4).split("")
        const newOtp = [...otp]
        digits.forEach((digit, i) => {
          if (i < 4) newOtp[i] = digit
        })
        setOtp(newOtp)
        inputRefs.current[Math.min(digits.length, 3)]?.focus()
      })
    }
  }

  const handlePaste = (e) => {
    e.preventDefault()
    const pastedData = e.clipboardData.getData("text")
    const digits = pastedData.replace(/\D/g, "").slice(0, 4).split("")
    const newOtp = [...otp]
    digits.forEach((digit, i) => {
      if (i < 4) newOtp[i] = digit
    })
    setOtp(newOtp)
    inputRefs.current[Math.min(digits.length, 3)]?.focus()
  }

  const formatResendTimer = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  }

  const getPhoneNumber = () => {
    const p = authData?.phone || `${DEFAULT_COUNTRY_CODE} ${phone}`
    const cleaned = p.replace(/\s/g, "")
    if (cleaned.startsWith("+91") && cleaned.length > 3) {
      return cleaned.slice(0, 3) + " " + cleaned.slice(3)
    }
    return cleaned
  }

  const isOtpComplete = otp.every((digit) => digit !== "")

  const showLoginStep = !isOtpStep || instantAuthTransition

  const authStepTransition = instantAuthTransition
    ? { duration: 0 }
    : { duration: 0.3 }

  // When an input is focused the mobile soft-keyboard opens and shrinks the
  // viewport. Scroll the focused field into the centre of the remaining space
  // so the submit button / logo never get hidden behind the keyboard.
  const handleInputFocusScroll = (e) => {
    const el = e.currentTarget
    setTimeout(() => {
      el?.scrollIntoView({ behavior: "smooth", block: "center" })
    }, 300)
  }

  return (
    <div className="min-h-[100dvh] bg-white dark:bg-[#0a0a0a] flex flex-col relative overflow-hidden font-['Poppins']">
      <style>
        {`
          @keyframes floatDish1 {
            0%, 100% { transform: translateX(0vw) translateY(0px) rotate(0deg); }
            50% { transform: translateX(25vw) translateY(-15px) rotate(8deg); }
          }
          @keyframes floatDish2 {
            0%, 100% { transform: translateX(0vw) translateY(0px) rotate(0deg); }
            50% { transform: translateX(-25vw) translateY(-15px) rotate(-8deg); }
          }
          .animate-float-dish-1 {
            animation: floatDish1 12s ease-in-out infinite;
          }
          .animate-float-dish-2 {
            animation: floatDish2 12s ease-in-out infinite;
          }
        `}
      </style>

      {/* Top Wave */}
      <div className="absolute top-0 left-0 w-full h-[40vh] pointer-events-none z-0 transform scale-[1.05] origin-center">
        <svg viewBox="0 0 1440 320" className="w-full h-full block" preserveAspectRatio="none" overflow="visible">
          <defs>
            <linearGradient id="topBlueGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#0E4B9C" />
              <stop offset="100%" stopColor="#021024" />
            </linearGradient>
          </defs>
          <path fill="url(#topBlueGrad)" d="M -50,-50 L -50,280 C 200,100 800,100 1490,100 L 1490,-50 Z" filter="drop-shadow(0px 5px 15px rgba(0,0,0,0.15))" />
        </svg>
        <img
          src="/assets/images/Driver_logo_1.png"
          alt="Delivery Partner"
          className="absolute top-[8%] left-[5%] w-[14vh] h-[14vh] md:w-[120px] md:h-[120px] object-contain animate-float-dish-1 drop-shadow-xl"
        />
      </div>

      {/* Bottom Wave */}
      <div className="absolute bottom-0 left-0 w-full h-[50vh] pointer-events-none z-0 transform scale-[1.05] origin-center">
        <svg viewBox="0 0 1440 320" className="w-full h-full block" preserveAspectRatio="none" overflow="visible">
          <defs>
            <linearGradient id="botBlueGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#0E4B9C" />
              <stop offset="100%" stopColor="#021024" />
            </linearGradient>
          </defs>
          <path fill="url(#botBlueGrad)" d="M -50,370 L -50,220 C 640,220 1240,220 1490,40 L 1490,370 Z" filter="drop-shadow(0px -5px 15px rgba(0,0,0,0.15))" />
        </svg>
        <img
          src="/assets/images/Driver_logo_2.png"
          alt="Delivery Rider"
          className="absolute bottom-[8%] right-[5%] w-[18vh] h-[18vh] md:w-[150px] md:h-[150px] object-contain animate-float-dish-2 drop-shadow-2xl"
        />
      </div>

      {/* Hidden keyboard-keeper: focused on the "Log in" tap so iOS keeps the
          soft-keyboard open while transitioning to the OTP step. */}
      <input
        ref={focusKeeperRef}
        type="tel"
        inputMode="numeric"
        tabIndex={-1}
        aria-label="Keyboard focus keeper"
        readOnly
        className="absolute opacity-0 w-px h-px -z-10 pointer-events-none"
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 pb-24 relative z-10 overflow-y-auto">
        <div className="w-full max-w-sm flex flex-col relative -top-10 my-auto">

          {/* Logo & Header */}
          <div className="mb-5 text-center flex flex-col items-center">
            <img
              src="/assets/images/ometto_logo_transparent.png"
              alt="Ometto Logo"
              className="h-28 -mb-3.5 object-contain drop-shadow-md"
            />
            <h2 className="text-[25px] font-extrabold bg-gradient-to-r from-[#0E4B9C] to-[#06336B] dark:from-blue-400 dark:to-blue-600 bg-clip-text text-transparent tracking-tight font-['Outfit'] pb-0.5">
              Delivery Partner
            </h2>
            <div className="text-[13.5px] text-slate-600 dark:text-slate-350 font-['Outfit'] font-medium tracking-wide leading-relaxed max-w-[310px] text-center px-4 mt-3">
              {showLoginStep ? (
                "Enter your registered mobile number to start earning"
              ) : showNameInput ? (
                "You're almost done! Please tell us your name to complete registration."
              ) : (
                <div className="text-[13px] text-slate-500/90 dark:text-slate-400/90 font-['Outfit'] font-semibold tracking-[0.015em] leading-relaxed w-full max-w-none text-center mt-2 flex items-center justify-center gap-1.5 whitespace-nowrap">
                  <span>We've sent a code to {getPhoneNumber()}</span>
                  <button
                    onClick={handleBackToLogin}
                    className="p-1.5 ml-1 bg-gradient-to-r from-[#0E4B9C] to-[#021024] hover:from-[#1157b5] hover:to-[#041630] rounded-[10px] text-white shadow-md shadow-[#0E4B9C]/20 transition-all hover:scale-105 active:scale-95"
                    aria-label="Edit phone number"
                  >
                    <Pencil className="w-3.5 h-3.5" strokeWidth={2.5} />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="relative">
            <AnimatePresence mode="wait">
              {showLoginStep ? (
                <motion.form
                  key="phone-form"
                  initial={instantAuthTransition ? false : { opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={instantAuthTransition ? undefined : { opacity: 0, x: 20 }}
                  transition={authStepTransition}
                  onSubmit={handleSendOTP}
                  className="space-y-6"
                >
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none">
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400 pr-3 border-r border-gray-300 dark:border-gray-600">+91</span>
                    </div>
                    <input
                      type="tel"
                      required
                      autoFocus
                      onFocus={handleInputFocusScroll}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                      maxLength={10}
                      className="block w-full pl-20 pr-6 py-3.5 bg-gray-50 dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 shadow-sm text-gray-900 dark:text-white rounded-full outline-none transition-all duration-300 placeholder:text-gray-400 font-medium text-base focus:bg-white dark:focus:bg-gray-900 focus:border-[#0E4B9C] focus:ring-4 focus:ring-[#0E4B9C]/10 hover:border-gray-400"
                      placeholder="Mobile number"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading || phone.length < 10}
                    className="w-full py-3.5 bg-gradient-to-r from-[#0E4B9C] to-[#021024] hover:from-[#1157b5] hover:to-[#041630] disabled:opacity-50 text-white rounded-full font-medium text-base shadow-[0_8px_20px_rgba(14,75,156,0.3)] disabled:shadow-none transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      "Log in"
                    )}
                  </button>
                </motion.form>
              ) : (
                <motion.div
                  key="otp-form"
                  initial={instantAuthTransition ? false : { opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={instantAuthTransition ? undefined : { opacity: 0, x: -20 }}
                  transition={authStepTransition}
                  className="w-full flex flex-col"
                >
                  <div className="relative">
                    {/* Pending/Rejected Screen */}
                    {pendingMessage && (
                      <div className={`rounded-3xl border p-6 text-center space-y-5 shadow-lg ${isRejected ? "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900/50" : "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/50"}`}>
                        <div className="space-y-2">
                          <p className={`text-base font-extrabold uppercase tracking-wider ${isRejected ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
                            {isRejected ? "Application Rejected" : "Pending Verification"}
                          </p>
                          <p className={`text-sm font-medium leading-relaxed ${isRejected ? "text-red-600/90 dark:text-red-300/80" : "text-amber-600/90 dark:text-amber-300/80"}`}>
                            {pendingMessage}
                          </p>
                          {isRejected && rejectionReason && (
                            <div className="mt-3 p-4 bg-white/70 dark:bg-[#1a1a1a]/70 rounded-2xl border border-red-100 dark:border-red-900/30">
                              <p className="text-[10px] font-black text-red-600 uppercase tracking-widest mb-1">Reason</p>
                              <p className="text-sm text-red-800 dark:text-red-300 italic font-medium">"{rejectionReason}"</p>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col gap-3 pt-2">
                          {isRejected && (
                            <button
                              type="button"
                              onClick={() => {
                                const pVal = authData?.phone || ""
                                const digits = String(pVal).replace(/\D/g, "")
                                sessionStorage.setItem("deliveryNeedsRegistration", "true")
                                const details = {
                                  name: "",
                                  phone: digits.slice(-10),
                                  countryCode: "+91",
                                }
                                sessionStorage.setItem("deliverySignupDetails", JSON.stringify(details))
                                navigate("/food/delivery/signup/details", { replace: true })
                              }}
                              className="w-full py-3.5 bg-gradient-to-r from-[#0E4B9C] to-[#021024] hover:from-[#1157b5] hover:to-[#041630] text-white rounded-full font-semibold text-base shadow-[0_8px_20px_rgba(14,75,156,0.2)] transition-all active:scale-[0.98]"
                            >
                              Re-apply Now
                            </button>
                          )}
                          
                          <button
                            type="button"
                            onClick={handleBackToLogin}
                            className="w-full py-3.5 bg-gradient-to-r from-[#0E4B9C] to-[#021024] hover:from-[#1157b5] hover:to-[#041630] text-white rounded-full font-medium text-base shadow-[0_8px_20px_rgba(14,75,156,0.3)] transition-all active:scale-[0.98] flex items-center justify-center"
                          >
                            Back to login
                          </button>
                        </div>
                      </div>
                    )}

                    {/* OTP fields */}
                    {!showNameInput && !pendingMessage && (
                      <form onSubmit={(e) => { e.preventDefault(); handleVerify(); }} className="space-y-6">
                        {error && (
                          <motion.div
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-red-600 dark:text-red-500 text-[15px] font-bold text-center tracking-wide mb-4 mt-2"
                          >
                            {error}
                          </motion.div>
                        )}

                        <div className="flex justify-between gap-3">
                          {[0, 1, 2, 3].map((index) => (
                            <input
                              key={index}
                              ref={(el) => (inputRefs.current[index] = el)}
                              type="tel"
                              inputMode="numeric"
                              required
                              disabled={loading || blockTimer > 0}
                              autoFocus={index === 0}
                              value={otp[index]}
                              onChange={(e) => handleChange(index, e.target.value)}
                              onKeyDown={(e) => handleKeyDown(index, e)}
                              onPaste={index === 0 ? handlePaste : undefined}
                              className={`w-14 h-14 sm:w-16 sm:h-16 text-center text-2xl font-bold bg-gray-50 dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 shadow-sm rounded-[20px] outline-none transition-all duration-300 text-gray-900 dark:text-white focus:bg-white dark:focus:bg-gray-900 focus:border-[#0E4B9C] focus:ring-4 focus:ring-[#0E4B9C]/10 hover:border-gray-400 ${blockTimer > 0 ? "opacity-50 cursor-not-allowed border-red-400 bg-red-50 text-red-800" : ""}`}
                              placeholder="•"
                            />
                          ))}
                        </div>

                        <div className="flex flex-col items-center gap-4">
                          <div className="flex items-center gap-2 text-xs font-semibold">
                            {blockTimer > 0 ? (
                              <span className="text-gray-400 uppercase tracking-wider font-extrabold">Resend SMS</span>
                            ) : resendTimer > 0 ? (
                              <span className="text-gray-400 font-extrabold">Resend SMS in <span className="text-slate-800 dark:text-slate-200 font-black">{formatResendTimer(resendTimer)}</span></span>
                            ) : (
                              <button
                                type="button"
                                onClick={handleResend}
                                className="text-slate-800 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white hover:underline font-extrabold"
                              >
                                Didn't receive SMS? Resend SMS
                              </button>
                            )}
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={loading || !isOtpComplete || blockTimer > 0}
                          className="w-full py-3.5 bg-gradient-to-r from-[#0E4B9C] to-[#021024] hover:from-[#1157b5] hover:to-[#041630] disabled:opacity-50 text-white rounded-full font-medium text-base shadow-[0_8px_20px_rgba(14,75,156,0.3)] disabled:shadow-none transition-all active:scale-[0.98] flex items-center justify-center gap-2 mt-4"
                        >
                          {loading ? (
                            <span className="flex items-center gap-2">
                              <Loader2 className="w-5 h-5 animate-spin" />
                              Verifying...
                            </span>
                          ) : (
                            "Verify & Continue"
                          )}
                        </button>

                        {blockTimer > 0 && (
                          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center w-fit mx-auto px-6 py-2.5 bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-100 dark:border-blue-900/50 mt-4">
                            <p className="text-[11px] font-bold text-[#0E4B9C] uppercase tracking-wider">
                              Too many failed attempts
                            </p>
                            <p className="text-sm font-bold text-[#0E4B9C]">
                              Try again after {Math.floor((blockTimer - 1) / 60)}:{String((blockTimer - 1) % 60).padStart(2, '0')}
                            </p>
                          </motion.div>
                        )}
                      </form>
                    )}

                    {/* Name field */}
                    {showNameInput && (
                      <div className="space-y-6">
                        <div className="space-y-2">
                          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 text-left pl-3">
                            Full name
                          </label>
                          <input
                            type="text"
                            value={name}
                            onChange={(e) => {
                              setName(e.target.value)
                              if (nameError) setNameError("")
                            }}
                            disabled={loading}
                            placeholder="Enter your name"
                            className={`block w-full px-6 py-3.5 bg-gray-50 dark:bg-gray-800 border-2 shadow-sm text-gray-900 dark:text-white rounded-full outline-none transition-all duration-300 placeholder:text-gray-400 font-medium text-base focus:bg-white dark:focus:bg-gray-900 focus:border-[#0E4B9C] focus:ring-4 focus:ring-[#0E4B9C]/10 ${nameError ? "border-red-500" : "border-gray-300 dark:border-gray-600"}`}
                          />
                          {nameError && (
                            <p className="text-xs text-red-500 text-left pl-3">
                              {nameError}
                            </p>
                          )}
                        </div>

                        <button
                          onClick={handleSubmitName}
                          disabled={loading || !name.trim()}
                          className="w-full py-3.5 bg-gradient-to-r from-[#0E4B9C] to-[#021024] hover:from-[#1157b5] hover:to-[#041630] disabled:opacity-50 text-white rounded-full font-medium text-base shadow-[0_8px_20px_rgba(14,75,156,0.3)] disabled:shadow-none transition-all active:scale-[0.98] flex items-center justify-center gap-2 mt-4"
                        >
                          {loading ? (
                            <span className="flex items-center gap-2">
                              <Loader2 className="w-5 h-5 animate-spin" />
                              Continuing...
                            </span>
                          ) : (
                            "Continue"
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer Info - only on login step, not OTP */}
          {!isOtpStep && (
            <div className="mt-8 text-center">
              <p className="text-[11px] text-gray-400/80 font-medium leading-relaxed max-w-[320px] mx-auto">
                By continuing, you agree to our <br />
                <Link
                  to="/food/delivery/terms"
                  state={{ from: "/food/delivery/login" }}
                  onClick={clearPersistedLoginPhone}
                  className="text-gray-400 hover:text-[#0E4B9C] transition-colors uppercase tracking-wider font-semibold"
                >
                  TERMS
                </Link>
                <span className="mx-2 text-gray-400/80 font-bold">•</span>
                <Link
                  to="/food/delivery/privacy"
                  state={{ from: "/food/delivery/login" }}
                  onClick={clearPersistedLoginPhone}
                  className="text-gray-400 hover:text-[#0E4B9C] transition-colors uppercase tracking-wider font-semibold"
                >
                  PRIVACY
                </Link>
                <span className="mx-2 text-gray-400/80 font-bold">•</span>
                <Link
                  to="/food/delivery/help/content"
                  state={{ from: "/food/delivery/login" }}
                  onClick={clearPersistedLoginPhone}
                  className="text-gray-400 hover:text-[#0E4B9C] transition-colors uppercase tracking-wider font-semibold"
                >
                  SUPPORT
                </Link>
              </p>
            </div>
          )}

        </div>
      </div>

      {/* Restore/New Account Popup */}
      <AnimatePresence>
        {showRestorePopup && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => {
                setShowRestorePopup(false)
                navigate("/food/delivery/login")
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="w-full max-w-sm bg-white dark:bg-[#1a1a1a] rounded-3xl shadow-2xl overflow-hidden p-8 text-center border border-gray-100 dark:border-gray-800 relative z-10"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  setShowRestorePopup(false)
                  navigate("/food/delivery/login")
                }}
                className="absolute top-4 right-4 p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl text-gray-400 hover:text-gray-600 transition-all active:scale-95"
                aria-label="Close and return to login"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-20 h-20 bg-[#0E4B9C]/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <ShieldCheck className="h-10 w-10 text-[#0E4B9C]" />
              </div>

              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">Account Found!</h3>
              <p className="text-gray-500 dark:text-gray-400 mb-8 leading-relaxed">
                An existing deleted delivery account for <span className="font-bold text-gray-900 dark:text-white">{getPhoneNumber()}</span> was found.
                Do you want to restore your old data or start fresh with a new account?
              </p>

              <div className="space-y-4">
                <button
                  onClick={() => handleRestoreAction("restore")}
                  className="w-full h-14 bg-gradient-to-r from-[#0E4B9C] to-[#021024] text-white font-bold rounded-2xl shadow-xl shadow-[#0E4B9C]/20 transition-all active:scale-[0.98]"
                >
                  Restore My Account
                </button>
                <button
                  onClick={() => handleRestoreAction("new")}
                  className="w-full h-14 border-2 border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 font-bold rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-all active:scale-[0.98]"
                >
                  Create New Account
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

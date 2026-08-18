import { useState, useEffect, useRef } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, Loader2, Pencil, X, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { deliveryAPI } from "@food/api"
import { setAuthData as storeAuthData } from "@food/utils/auth"
import { collectFcmTokenFast, persistModuleFcmToken, finalizeDeliveryPendingSubmission, prefetchModuleFcmToken } from "@food/utils/firebaseMessaging"
import { getUserFacingApiError, showUserFacingApiError } from "@/shared/utils/apiError"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}

export default function DeliveryOTP() {
  const navigate = useNavigate()
  const location = useLocation()
  const [otp, setOtp] = useState(["", "", "", ""])
  const [isLoading, setIsLoading] = useState(false)
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

  const getBlockKey = () => {
    const phone = authData?.phone || ""
    const clean = phone.replace(/\D/g, "")
    return clean ? `delivery_block_expires_at_${clean}` : "delivery_block_expires_at"
  }

  const getResendKey = () => {
    const phone = authData?.phone || ""
    const clean = phone.replace(/\D/g, "")
    return clean ? `delivery_resend_expires_at_${clean}` : "delivery_resend_expires_at"
  }

  useEffect(() => {
    // Get auth data from sessionStorage (delivery module key)
    const stored = sessionStorage.getItem("deliveryAuthData")
    let currentPhone = ""
    if (stored) {
      const data = JSON.parse(stored)
      setAuthData(data)
      currentPhone = data.phone || ""
    } else {
      // No active OTP flow: if already authenticated, go to delivery home
      const token = localStorage.getItem("delivery_accessToken")
      const authenticated = localStorage.getItem("delivery_authenticated") === "true"
      if (token && authenticated) {
        try {
          const parts = token.split('.')
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
            const now = Math.floor(Date.now() / 1000)
            if (payload.exp && payload.exp > now) {
              navigate("/food/delivery", { replace: true })
              return
            }
          }
        } catch (e) {
          // Ignore token parse errors and continue to sign-in redirect
        }
      }

      // No auth data, redirect to sign in
      navigate("/food/delivery/login", { replace: true })
      return
    }

    const clean = currentPhone.replace(/\D/g, "")
    const blockKey = clean ? `delivery_block_expires_at_${clean}` : "delivery_block_expires_at"
    const resendKey = clean ? `delivery_resend_expires_at_${clean}` : "delivery_resend_expires_at"

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
  }, [navigate, location.state])

  useEffect(() => {
    prefetchModuleFcmToken("delivery")
  }, [])

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

  // Intercept hardware back button to return to login instead of leaving the page
  useEffect(() => {
    const handlePopState = () => {
      if (blockTimer > 0) {
        window.history.pushState({ otpStep: true }, "")
        return
      }
      navigate("/food/delivery/login")
    }

    window.history.pushState({ otpStep: true }, "")
    window.addEventListener("popstate", handlePopState)

    return () => {
      window.removeEventListener("popstate", handlePopState)
    }
  }, [blockTimer > 0])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (inputRefs.current[0]) {
        inputRefs.current[0].focus()
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  const handleSingleInputChange = (e) => {
    let val = e.target.value.replace(/\D/g, "");
    if (val.length > 4) val = val.slice(0, 4);
    
    if (val.length > 0) setError("");
    
    const newOtp = ["", "", "", ""];
    for (let i = 0; i < val.length; i++) {
      newOtp[i] = val[i];
    }
    setOtp(newOtp);
  }

  const handleVerify = async (otpValue = null, confirmAction = null) => {
    if (showNameInput && !confirmAction) {
      // In name collection step, ignore OTP auto-submit
      return
    }

    const code = otpValue || otp.join("")

    if (code.length !== 4) {
      toast.error("Please enter the complete 4-digit code")
      return
    }

    if (isLoading || blockTimer > 0) return

    setIsLoading(true)
    setError("")

    try {
      const phone = authData?.phone
      const purpose = authData?.purpose || "login"
      const providedName = authData?.isSignUp ? authData?.name || null : null
      if (!phone) {
        setError("Phone number not found. Please try again.")
        setIsLoading(false)
        return
      }

      // Try to get FCM token before verifying OTP
      const { fcmToken, platform } = await collectFcmTokenFast("delivery")

      setDeviceToken(fcmToken);
      setActivePlatform(platform);

      const response = await deliveryAPI.verifyOTP(phone, code, purpose, providedName, fcmToken, platform, confirmAction)
      debugLog("Delivery OTP Response:", response)
      const data = response?.data?.data || response?.data || {}

      // Handle deleted account found
      if (data?.deletedAccountFound) {
        setDeletedAccountData(data)
        setShowRestorePopup(true)
        setIsLoading(false)
        return
      }

      if (data.pendingApproval === true) {
        sessionStorage.removeItem("deliveryAuthData")
        sessionStorage.removeItem(getBlockKey())
        sessionStorage.removeItem(getResendKey())
        const digits = String(phone || "").replace(/\D/g, "").slice(-10)
        const rejected = Boolean(data.isRejected)
        setIsLoading(false)
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
        sessionStorage.removeItem(getBlockKey())
        sessionStorage.removeItem(getResendKey())
        sessionStorage.setItem("deliveryNeedsRegistration", "true")
        const digits = String(phone || "").replace(/\D/g, "")
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
      sessionStorage.removeItem(getBlockKey())
      sessionStorage.removeItem(getResendKey())

      try {
        storeAuthData("delivery", accessToken, user, refreshToken)
      } catch (storageError) {
        setError("Failed to save authentication. Please try again.")
        setIsLoading(false)
        return
      }

      window.dispatchEvent(new Event("deliveryAuthChanged"))
      try {
        await persistModuleFcmToken("delivery", { fcmToken, platform })
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
          setIsLoading(false)
        }
      }
      setTimeout(verifyAndNavigate, 200)
    } catch (err) {
      debugError("OTP Verification Error:", err)
      const message = getUserFacingApiError(err, "Failed to verify OTP. Please try again.")

      setOtp(["", "", "", ""])
      setTimeout(() => {
        inputRefs.current[0]?.focus()
      }, 50)

      const isBlocked = message.toLowerCase().includes("blocked") || 
                        message.toLowerCase().includes("too many attempts") || 
                        message.toLowerCase().includes("try again after");

      if (isBlocked) {
        let totalSeconds = 180;
        const timeMatch = message.match(/(\d+)(?::(\d+))?/);
        if (timeMatch) {
          const mins = parseInt(timeMatch[1]);
          const secs = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
          totalSeconds = (mins * 60) + secs;
        }
        setBlockTimer(totalSeconds)
        sessionStorage.setItem(getBlockKey(), (Date.now() + (totalSeconds * 1000)).toString())
        setError("")
      } else if (/invalid/i.test(message)) {
        setError("Invalid OTP")
        toast.error("Invalid OTP", { id: "user-facing-api-error" })
      } else {
        setError(message)
        showUserFacingApiError(err, message)
      }
      setIsLoading(false)
    }
  }

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

    setIsLoading(true)
    setError("")
    setNameError("")

    try {
      const phone = authData?.phone
      const purpose = authData?.purpose || "login"
      if (!phone) {
        setError("Phone number not found. Please try again.")
        return
      }

      const response = await deliveryAPI.verifyOTP(phone, verifiedOtp, purpose, trimmedName, deviceToken, activePlatform)
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
        setIsLoading(false)
        return
      }

      window.dispatchEvent(new Event("deliveryAuthChanged"))
      setSuccess(true)
      setIsLoading(false)

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
          setIsLoading(false)
        }
      }
      setTimeout(verifyAndNavigate, 200)
    } catch (err) {
      const message = getUserFacingApiError(err, "Failed to complete registration. Please try again.")
      setError(message)
      showUserFacingApiError(err, "Failed to complete registration. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleRestoreAction = async (action) => {
    setShowRestorePopup(false)
    const code = otp.join("")
    await handleVerify(code, action)
  }

  const handleResend = async () => {
    if (resendTimer > 0 || blockTimer > 0) return

    setIsLoading(true)
    setError("")

    try {
      const phone = authData?.phone
      const purpose = authData?.purpose || "login"
      if (!phone) {
        setError("Phone number not found. Please go back and try again.")
        setIsLoading(false)
        return
      }

      await deliveryAPI.sendOTP(phone, purpose)
      setResendTimer(59)
      sessionStorage.setItem(getResendKey(), (Date.now() + (59 * 1000)).toString())
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
                        message.toLowerCase().includes("try again after");

      if (isBlocked) {
        let totalSeconds = 180;
        const timeMatch = message.match(/(\d+)(?::(\d+))?/);
        if (timeMatch) {
          const mins = parseInt(timeMatch[1]);
          const secs = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
          totalSeconds = (mins * 60) + secs;
        }
        setBlockTimer(totalSeconds)
        sessionStorage.setItem(getBlockKey(), (Date.now() + (totalSeconds * 1000)).toString())
        setError("")
      } else {
        setError(message)
        showUserFacingApiError(err, "Failed to resend OTP. Please try again.")
      }
    } finally {
      setIsLoading(false)
    }
  }

  const formatResendTimer = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  }

  const getPhoneNumber = () => {
    if (!authData) return ""
    if (authData.method === "phone") {
      const phone = authData.phone || ""
      const cleaned = phone.replace(/\s/g, "")
      if (cleaned.startsWith("+91") && cleaned.length > 3) {
        return cleaned.slice(0, 3) + " " + cleaned.slice(3)
      }
      return cleaned
    }
    return authData.email || ""
  }

  const isOtpComplete = otp.every((digit) => digit !== "")

  if (!authData) {
    return null
  }

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0a] flex flex-col relative overflow-hidden font-['Poppins']">
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

      {/* Top Wave (Log In style) */}
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

      {/* Bottom Wave (Log In style) */}
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

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 pb-24 relative z-10">
        <div className="w-full max-w-sm flex flex-col relative -top-10">
          {/* Main Title */}
          <div className="mb-5 text-center flex flex-col items-center">
            <img
              src="/assets/images/ometto_logo_transparent.png"
              alt="Ometto Logo"
              className="h-28 -mb-3.5 object-contain drop-shadow-md"
            />
            <h2 className="text-[25px] font-extrabold bg-gradient-to-r from-[#0E4B9C] to-[#06336B] dark:from-blue-400 dark:to-blue-600 bg-clip-text text-transparent tracking-tight font-['Outfit'] pb-0.5">
              Delivery Partner
            </h2>
            
            {/* Show different descriptions depending on active step */}
            {!showNameInput && !pendingMessage && (
              <div className="text-[13px] text-slate-500/90 dark:text-slate-400/90 font-['Outfit'] font-semibold tracking-[0.015em] leading-relaxed w-full max-w-none text-center px-4 mt-5 flex items-center justify-center gap-1.5 whitespace-nowrap">
                <span>We've sent a code to {getPhoneNumber()}</span>
                <button
                  onClick={() => navigate("/food/delivery/login")}
                  className="p-1.5 ml-1 bg-gradient-to-r from-[#0E4B9C] to-[#021024] hover:from-[#1157b5] hover:to-[#041630] rounded-[10px] text-white shadow-md shadow-[#0E4B9C]/20 transition-all hover:scale-105 active:scale-95"
                  aria-label="Edit phone number"
                >
                  <Pencil className="w-3.5 h-3.5" strokeWidth={2.5} />
                </button>
              </div>
            )}
            
            {showNameInput && (
              <div className="text-[13px] text-slate-500/90 dark:text-slate-400/90 font-['Outfit'] font-semibold tracking-[0.015em] leading-relaxed max-w-[300px] text-center px-4 mt-5">
                You're almost done! Please tell us your name to complete registration.
              </div>
            )}
          </div>

          <div className="relative">
            {/* Pending approval/rejection view */}
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
                        const phone = authData?.phone
                        const digits = String(phone || "").replace(/\D/g, "")
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
                    onClick={() => navigate("/food/delivery/login", { replace: true })}
                    className={`text-sm font-semibold hover:underline ${isRejected ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}
                  >
                    Back to login
                  </button>
                </div>
              </div>
            )}

            {/* OTP Input Fields View */}
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

                <div className="relative flex justify-between gap-3">
                <input
                  ref={(el) => (inputRefs.current[0] = el)}
                  type="tel"
                  inputMode="numeric"
                  maxLength={4}
                  required
                  disabled={isLoading || blockTimer > 0}
                  autoFocus
                  value={otp.join("")}
                  onChange={handleSingleInputChange}
                  className="absolute inset-0 w-full h-full bg-transparent text-transparent caret-transparent outline-none focus:outline-none focus:ring-0 z-10 cursor-text text-[16px]"
                />
                {[0, 1, 2, 3].map((index) => (
                  <div
                    key={index}
                    className={`flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 text-center text-2xl font-bold bg-gray-50 dark:bg-gray-800 border-2 shadow-sm rounded-[20px] transition-all duration-300 text-gray-900 dark:text-white 
                      ${blockTimer > 0 ? "opacity-50 border-red-400 bg-red-50 text-red-800" : 
                        (otp.join("").length === index && !(isLoading || blockTimer > 0)) ? "bg-white dark:bg-gray-900 border-[#0E4B9C] ring-4 ring-[#0E4B9C]/10" : 
                        (otp[index] ? "border-[#0E4B9C]" : "border-gray-300 dark:border-gray-600")}
                    `}
                  >
                    {otp[index] ? otp[index] : <span className="text-gray-300 dark:text-gray-600 font-normal">•</span>}
                  </div>
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
                  disabled={isLoading || !isOtpComplete || blockTimer > 0}
                  className="w-full py-3.5 bg-gradient-to-r from-[#0E4B9C] to-[#021024] hover:from-[#1157b5] hover:to-[#041630] disabled:opacity-50 text-white rounded-full font-medium text-base shadow-[0_8px_20px_rgba(14,75,156,0.3)] disabled:shadow-none transition-all active:scale-[0.98] flex items-center justify-center gap-2 mt-4"
                >
                  {isLoading ? (
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

            {/* Name Input View */}
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
                    disabled={isLoading}
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
                  disabled={isLoading || !name.trim()}
                  className="w-full py-3.5 bg-gradient-to-r from-[#0E4B9C] to-[#021024] hover:from-[#1157b5] hover:to-[#041630] disabled:opacity-50 text-white rounded-full font-medium text-base shadow-[0_8px_20px_rgba(14,75,156,0.3)] disabled:shadow-none transition-all active:scale-[0.98] flex items-center justify-center gap-2 mt-4"
                >
                  {isLoading ? (
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
                setShowRestorePopup(false);
                navigate("/food/delivery/login");
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
                  setShowRestorePopup(false);
                  navigate("/food/delivery/login");
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

import { useState, useEffect, useRef } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, Timer, RefreshCw, Loader2, Pencil, X, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { restaurantAPI } from "@food/api"
import {
  setAuthData as setRestaurantAuthData,
  setRestaurantPendingPhone,
} from "@food/utils/auth"
import { checkOnboardingStatus, isRestaurantOnboardingComplete } from "@food/utils/onboardingUtils"
import { collectFcmTokenFast, persistModuleFcmToken, syncPendingPartnerFcmQuick } from "@food/utils/firebaseMessaging"

export default function RestaurantOTP() {
  const navigate = useNavigate()
  const location = useLocation()
  const [otp, setOtp] = useState(["", "", "", ""])
  const [otpError, setOtpError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [resendTimer, setResendTimer] = useState(0)
  const [blockTimer, setBlockTimer] = useState(0)
  const [authData, setAuthData] = useState(null)
  const [contactInfo, setContactInfo] = useState("")
  const [showRestorePopup, setShowRestorePopup] = useState(false)
  const [deletedAccountData, setDeletedAccountData] = useState(null)
  const inputRefs = useRef([])
  const hasSubmittedRef = useRef(false)
  const isSuccessRef = useRef(false)

  const getBlockKey = () => {
    const phone = authData?.phone || contactInfo || ""
    const clean = phone.replace(/\D/g, "")
    return clean ? `restaurant_block_expires_at_${clean}` : "restaurant_block_expires_at"
  }

  const getResendKey = () => {
    const phone = authData?.phone || contactInfo || ""
    const clean = phone.replace(/\D/g, "")
    return clean ? `restaurant_resend_expires_at_${clean}` : "restaurant_resend_expires_at"
  }

  useEffect(() => {
    const stored = sessionStorage.getItem("restaurantAuthData")
    let currentPhone = ""
    if (stored) {
      const data = JSON.parse(stored)
      setAuthData(data)

      if (data.method === "email" && data.email) {
        setContactInfo(data.email)
        currentPhone = data.email
      } else if (data.phone) {
        const phoneMatch = data.phone?.match(/(\+\d+)\s*(.+)/)
        let formatted = ""
        if (phoneMatch) {
          formatted = `${phoneMatch[1]} ${phoneMatch[2].replace(/\D/g, "")}`
        } else {
          formatted = data.phone || ""
        }
        setContactInfo(formatted)
        currentPhone = formatted
      }
    } else {
      navigate("/food/restaurant/login")
      return
    }

    const clean = currentPhone.replace(/\D/g, "")
    const blockKey = clean ? `restaurant_block_expires_at_${clean}` : "restaurant_block_expires_at"
    const resendKey = clean ? `restaurant_resend_expires_at_${clean}` : "restaurant_resend_expires_at"

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
      navigate("/food/restaurant/login")
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
    
    if (val.length > 0) setOtpError("");
    
    const newOtp = ["", "", "", ""];
    for (let i = 0; i < val.length; i++) {
      newOtp[i] = val[i];
    }
    setOtp(newOtp);
  }

  const handleVerify = async (otpValue = null, confirmAction = null) => {
    const code = otpValue || otp.join("")

    if (code.length !== 4) {
      toast.error("Please enter the complete 4-digit code")
      hasSubmittedRef.current = false
      return
    }

    if (isSuccessRef.current || isLoading || blockTimer > 0) return
    if (!confirmAction && hasSubmittedRef.current) return

    setIsLoading(true)
    if (!confirmAction) hasSubmittedRef.current = true

    try {
      if (!authData) throw new Error("Session expired. Please login again.")

      const phone = authData.phone
      const purpose = authData.isSignUp ? "register" : "login"

      const { fcmToken, platform } = await collectFcmTokenFast("restaurant")

      const response = await restaurantAPI.verifyOTP(
        phone,
        code,
        purpose,
        null,
        authData.email,
        fcmToken,
        platform,
        confirmAction,
      )
      const data = response?.data?.data || response?.data

      if (data.deletedAccountFound) {
        setDeletedAccountData(data)
        setShowRestorePopup(true)
        setIsLoading(false)
      } else if (data.pendingApproval === true) {
        isSuccessRef.current = true
        sessionStorage.removeItem("restaurantAuthData")
        sessionStorage.removeItem(getBlockKey())
        sessionStorage.removeItem(getResendKey())
        setRestaurantPendingPhone(phone)
        const isRejected = Boolean(data.isRejected)
        const statusVal = isRejected ? "rejected" : "pending"
        localStorage.setItem("restaurant_pendingStatus", statusVal)
        localStorage.setItem("restaurant_pendingMessage", data.message || "")
        setShowRestorePopup(false)
        setIsLoading(false)
        syncPendingPartnerFcmQuick("restaurant", phone, { fcmToken, platform })
        navigate("/food/restaurant/pending-verification", {
          replace: true,
          state: {
            phone: phone || "",
            isRejected,
            isDisabled: false,
            message: data.message,
          },
        })
      } else if (data.needsRegistration === true) {
        isSuccessRef.current = true
        setRestaurantPendingPhone(phone)
        sessionStorage.removeItem("restaurantAuthData")
        sessionStorage.removeItem(getBlockKey())
        sessionStorage.removeItem(getResendKey())
        setShowRestorePopup(false)
        window.location.replace("/food/restaurant/onboarding")
      } else {
        isSuccessRef.current = true
        const accessToken = data.accessToken
        const restaurant = data.restaurant || data.user
        const status = String(restaurant?.status || "").toLowerCase()

        if (status && status !== "approved") {
          sessionStorage.removeItem("restaurantAuthData")
          sessionStorage.removeItem(getBlockKey())
          sessionStorage.removeItem(getResendKey())
          setRestaurantPendingPhone(phone)
          const isRejected = status === "rejected"
          const isDisabled = status === "banned" || status === "deleted"
          const statusVal = isDisabled ? "banned" : (isRejected ? "rejected" : "pending")
          localStorage.setItem("restaurant_pendingStatus", statusVal)
          localStorage.setItem(
            "restaurant_pendingMessage",
            isRejected
              ? (restaurant?.rejectionReason
                  ? `Your restaurant registration has been rejected. Reason: ${restaurant.rejectionReason}`
                  : "Your restaurant registration has been rejected. Please contact support.")
              : "Your restaurant registration is pending approval.",
          )
          setShowRestorePopup(false)
          setIsLoading(false)
          navigate("/food/restaurant/pending-verification", {
            replace: true,
            state: {
              phone: phone || "",
              isRejected,
              isDisabled,
            },
          })
          return
        }

        setRestaurantAuthData("restaurant", accessToken, restaurant, data?.refreshToken)
        window.dispatchEvent(new Event("restaurantAuthChanged"))
        try {
          await persistModuleFcmToken("restaurant", { fcmToken, platform })
        } catch {}
        sessionStorage.removeItem("restaurantAuthData")
        sessionStorage.removeItem(getBlockKey())
        sessionStorage.removeItem(getResendKey())
        setShowRestorePopup(false)

        if (authData?.isSignUp) {
          window.location.replace("/food/restaurant/onboarding")
        } else {
          const onboardingComplete = isRestaurantOnboardingComplete(restaurant)
          if (!onboardingComplete) {
            const incompleteStep = await checkOnboardingStatus()
            if (incompleteStep) {
              window.location.replace(`/food/restaurant/onboarding?step=${incompleteStep}`)
              return
            }
          }
          window.location.replace("/food/restaurant")
        }
      }
    } catch (err) {
      const message = err?.response?.data?.error || err?.response?.data?.message || "Invalid OTP. Please try again."
      
      setOtp(["", "", "", ""])

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
        setBlockTimer(totalSeconds);
        sessionStorage.setItem(getBlockKey(), (Date.now() + (totalSeconds * 1000)).toString());
      } else {
        if (/pending approval|rejected|disabled|banned/i.test(message)) {
          const pendingPhone = authData?.phone || authData?.email || contactInfo
          setRestaurantPendingPhone(pendingPhone)
          
          const isRejected = /rejected/i.test(message)
          const isDisabled = /disabled|banned/i.test(message)
          const statusVal = isDisabled ? "banned" : (isRejected ? "rejected" : "pending")
          
          localStorage.setItem("restaurant_pendingStatus", statusVal)
          localStorage.setItem("restaurant_pendingMessage", message)
          
          navigate("/food/restaurant/pending-verification", {
            replace: true,
            state: { 
              phone: pendingPhone || "",
              isRejected: isRejected,
              isDisabled: isDisabled,
              message: message 
            },
          })
          return
        }

        if (/invalid/i.test(message)) {
          setOtpError("Invalid OTP")
        } else {
          toast.error(message)
        }
      }
      hasSubmittedRef.current = false
      setIsLoading(false)
      setTimeout(() => {
        inputRefs.current[0]?.focus()
      }, 50)
    }
  }

  const handleResend = async () => {
    if (resendTimer > 0 || blockTimer > 0) return
    setIsLoading(true)
    try {
      const purpose = authData.isSignUp ? "register" : "login"
      await restaurantAPI.sendOTP(authData.phone, purpose, authData.email)
      setResendTimer(59)
      sessionStorage.setItem(getResendKey(), (Date.now() + (59 * 1000)).toString())
      toast.success("OTP resent successfully.")
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to resend code")
    } finally {
      setIsLoading(false)
    }
  }

  const handleRestoreAction = async (action) => {
    const code = otp.join("")
    await handleVerify(code, action)
  }

  const formatResendTimer = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  }

  const isOtpComplete = otp.every((digit) => digit !== "")

  if (!authData) return null

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
            <linearGradient id="topRedGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#B80B3D" />
              <stop offset="100%" stopColor="#66001D" />
            </linearGradient>
          </defs>
          <path fill="url(#topRedGrad)" d="M -50,-50 L -50,280 C 200,100 800,100 1490,100 L 1490,-50 Z" filter="drop-shadow(0px 5px 15px rgba(0,0,0,0.15))" />
        </svg>
        <img
          src="/assets/images/Restaurant_logo_2.png"
          alt="Restaurant Partner"
          className="absolute top-[8%] left-[5%] w-[14vh] h-[14vh] md:w-[120px] md:h-[120px] object-contain animate-float-dish-1 drop-shadow-xl"
        />
      </div>

      {/* Bottom Wave (Log In style) */}
      <div className="absolute bottom-0 left-0 w-full h-[50vh] pointer-events-none z-0 transform scale-[1.05] origin-center">
        <svg viewBox="0 0 1440 320" className="w-full h-full block" preserveAspectRatio="none" overflow="visible">
          <defs>
            <linearGradient id="botRedGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#B80B3D" />
              <stop offset="100%" stopColor="#66001D" />
            </linearGradient>
          </defs>
          <path fill="url(#botRedGrad)" d="M -50,370 L -50,220 C 640,220 1240,220 1490,40 L 1490,370 Z" filter="drop-shadow(0px -5px 15px rgba(0,0,0,0.15))" />
        </svg>
        <img
          src="/assets/images/Restaurant_logo_1.png"
          alt="Restaurant Partner"
          className="absolute bottom-[13%] right-[5%] w-[18vh] h-[18vh] md:w-[150px] md:h-[150px] object-contain animate-float-dish-2 drop-shadow-2xl"
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
            <h2 className="text-[25px] font-extrabold text-[#B80B3D] dark:text-red-400 tracking-tight font-['Outfit']">
              Restaurant Partner
            </h2>
            <div className="text-[13px] text-slate-500/90 dark:text-slate-400/90 font-['Outfit'] font-semibold tracking-[0.015em] leading-relaxed max-w-[300px] text-center px-4 mt-5 flex items-center justify-center gap-1.5">
              <span>We've sent a code to {contactInfo}</span>
              <button 
                onClick={() => navigate("/food/restaurant/login")}
                className="p-1.5 ml-1 bg-gradient-to-r from-[#B80B3D] to-[#66001D] hover:from-[#90082E] hover:to-[#4A0014] rounded-[10px] text-white shadow-md shadow-[#B80B3D]/20 transition-all hover:scale-105 active:scale-95"
                aria-label="Edit phone number"
              >
                <Pencil className="w-3.5 h-3.5" strokeWidth={2.5} />
              </button>
            </div>
          </div>

          <div className="relative">
            <form onSubmit={(e) => { e.preventDefault(); handleVerify(); }} className="space-y-6">
              {otpError && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-red-600 dark:text-red-500 text-[15px] font-bold text-center tracking-wide mb-4 mt-2"
                >
                  {otpError}
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
                        (otp.join("").length === index && !(isLoading || blockTimer > 0)) ? "bg-white dark:bg-gray-900 border-[#B80B3D] ring-4 ring-[#B80B3D]/10" : 
                        (otp[index] ? "border-[#B80B3D]" : "border-gray-300 dark:border-gray-600")}
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
                className="w-full py-3.5 bg-gradient-to-r from-[#B80B3D] to-[#66001D] hover:from-[#A10935] hover:to-[#4F0016] disabled:opacity-50 text-white rounded-full font-medium text-base shadow-[0_8px_20px_rgba(184,11,61,0.3)] disabled:shadow-none transition-all active:scale-[0.98] flex items-center justify-center gap-2 mt-4"
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
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center w-fit mx-auto px-6 py-2.5 bg-red-50 dark:bg-red-950/20 rounded-xl border border-red-100 dark:border-red-900/50 mt-4">
                  <p className="text-[11px] font-bold text-[#B80B3D] uppercase tracking-wider">
                    Too many failed attempts
                  </p>
                  <p className="text-sm font-bold text-[#B80B3D]">
                    Try again after {Math.floor((blockTimer - 1) / 60)}:{String((blockTimer - 1) % 60).padStart(2, '0')}
                  </p>
                </motion.div>
              )}
            </form>
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
                  navigate("/food/restaurant/login");
                }}
                className="absolute top-4 right-4 p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl text-gray-400 hover:text-gray-600 transition-all active:scale-95"
                aria-label="Close and return to login"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-20 h-20 bg-[#B80B3D]/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <ShieldCheck className="h-10 w-10 text-[#B80B3D]" />
              </div>

              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">Restaurant Found!</h3>
              <p className="text-gray-500 dark:text-gray-400 mb-8 leading-relaxed">
                An existing deleted restaurant for <span className="font-bold text-gray-900 dark:text-white">{contactInfo}</span> was found.
                Do you want to restore your old data or start fresh with a new account?
              </p>

              <div className="space-y-4">
                <button
                  onClick={() => handleRestoreAction("restore")}
                  className="w-full h-14 bg-gradient-to-r from-[#B80B3D] to-[#66001D] text-white font-bold rounded-2xl shadow-xl shadow-[#B80B3D]/20 transition-all active:scale-[0.98]"
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

import { useState, useEffect, useRef } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { ArrowLeft, Loader2, AlertCircle, Smartphone, ShieldCheck, RefreshCw, Edit2 } from "lucide-react"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { Input } from "@food/components/ui/input"
import apiClient, { authAPI } from "@food/api"
import { setAuthData as setUserAuthData } from "@food/utils/auth"
import { clearAuthDraft, startPhoneEdit } from "@food/utils/authDraft"
import { resolveDeviceFcmToken, registerWebPushForCurrentModule } from "@food/utils/firebaseMessaging"
import { motion, AnimatePresence } from "framer-motion"
import loginBgImg from "@food/assets/login_bg.webp"

const FULL_NAME_REGEX = /^[A-Za-z ]+$/

export default function OTP() {
  const navigate = useNavigate()
  const location = useLocation()
  const [otp, setOtp] = useState(["", "", "", ""]) // 4 digits
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [resendTimer, setResendTimer] = useState(0)
  const [authData, setAuthData] = useState(null)
  const [showNameInput, setShowNameInput] = useState(false)
  const [name, setName] = useState("")
  const [nameError, setNameError] = useState("")
  const [verifiedData, setVerifiedData] = useState(null)
  const [contactInfo, setContactInfo] = useState("")
  const inputRefs = useRef([])
  const submittingRef = useRef(false)

  useEffect(() => {
    // Redirect to home if already authenticated
    const isAuthenticated = localStorage.getItem("user_authenticated") === "true"
    if (isAuthenticated) {
      navigate("/food/user", { replace: true })
      return
    }

    // Get auth data from sessionStorage
    const stored = sessionStorage.getItem("userAuthData")
    if (!stored) {
      navigate("/food/user/auth/login", { replace: true })
      return
    }
    const data = JSON.parse(stored)
    setAuthData(data)

    if (data.method === "email" && data.email) {
      setContactInfo(data.email)
    } else if (data.phone) {
      const phoneMatch = data.phone?.match(/(\+\d+)\s*(.+)/)
      if (phoneMatch) {
        setContactInfo(`${phoneMatch[1]}-${phoneMatch[2].replace(/\D/g, "")}`)
      } else {
        setContactInfo(data.phone || "")
      }
    }

    setResendTimer(60)
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return
      setResendTimer((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [navigate])

  useEffect(() => {
    if (inputRefs.current[0] && !showNameInput) {
      inputRefs.current[0].focus()
    }
  }, [showNameInput])

  const ensureNotificationPermission = async () => {
    try {
      if (typeof Notification === "undefined") return
      if (Notification.permission === "default") {
        await Notification.requestPermission()
      }
    } catch {
      // ignore
    }
  }

  const handleChange = (index, value) => {
    if (value && !/^\d$/.test(value)) return
    const newOtp = [...otp]
    newOtp[index] = value
    setOtp(newOtp)
    setError("")

    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus()
    }

    if (!showNameInput && newOtp.slice(0, 4).every((digit) => digit !== "")) {
      handleVerify(newOtp.slice(0, 4).join(""))
    }
  }

  const handleKeyDown = (index, e) => {
    if (e.key === "Backspace") {
      if (otp[index]) {
        const newOtp = [...otp]
        newOtp[index] = ""
        setOtp(newOtp)
      } else if (index > 0) {
        inputRefs.current[index - 1]?.focus()
        const newOtp = [...otp]
        newOtp[index - 1] = ""
        setOtp(newOtp)
      }
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
    if (!showNameInput && digits.length === 4) {
      handleVerify(newOtp.slice(0, 4).join(""))
    } else {
      inputRefs.current[Math.min(digits.length, 3)]?.focus()
    }
  }

  const handleVerify = async (otpValue = null) => {
    if (showNameInput) return
    if (submittingRef.current) return

    const code = (otpValue || otp.join("")).replace(/\D/g, "")
    const code4 = code.slice(0, 4)
    if (code4.length !== 4) {
      setError("OTP must be 4 digits")
      return
    }

    submittingRef.current = true
    setIsLoading(true)
    setError("")

    try {
      const phone = authData?.method === "phone" ? authData.phone : null
      const email = authData?.method === "email" ? authData.email : null
      const purpose = authData?.isSignUp ? "register" : "login"
      const providedName = authData?.isSignUp ? authData?.name || null : null
      const referralCode = authData?.referralCode || null

      let fcmToken = null;
      let platform = "web";
      try {
        const resolved = await resolveDeviceFcmToken("user", { allowPrompt: true });
        fcmToken = resolved?.token || null;
        platform = resolved?.platform || "web";
      } catch (e) {
        console.warn("Failed to get FCM token during login", e);
      }

      const response = await authAPI.verifyOTP(
        phone, code4, purpose, providedName, email, "user", null, referralCode, fcmToken, platform
      )
      const data = response?.data?.data || response?.data || {}
      const accessToken = data.accessToken
      const refreshToken = data.refreshToken ?? null
      const user = data.user

      if (!accessToken || !user || !refreshToken) {
        throw new Error("Invalid response from server")
      }

      const hasName = user.name && String(user.name).trim().length > 0 && String(user.name).toLowerCase() !== "null";
      const needsName = data.isNewUser === true || !hasName;

      if (needsName) {
        setVerifiedData(data)
        setShowNameInput(true)
        setIsLoading(false)
        submittingRef.current = false
        return
      }

      sessionStorage.removeItem("userAuthData")
      clearAuthDraft("user")
      setUserAuthData("user", accessToken, user, refreshToken)
      window.dispatchEvent(new Event("userAuthChanged"))
      await registerWebPushForCurrentModule("/food/user", { force: true }).catch(() => {})
      setTimeout(() => navigate("/food/user"), 400)
    } catch (err) {
      const status = err?.response?.status
      let message = err?.response?.data?.message || err?.response?.data?.error || err?.message || "Verification failed."
      if (status === 401) message = "Invalid or expired OTP code."
      setError(message)
    } finally {
      setIsLoading(false)
      submittingRef.current = false
    }
  }

  const handleSubmitName = async () => {
    const normalizedName = String(name || "").replace(/\s+/g, " ").trim()
    if (!normalizedName || normalizedName.length < 2) {
      setNameError("Please enter a valid name")
      return
    }
    if (!FULL_NAME_REGEX.test(normalizedName)) {
      setNameError("Name can contain only letters and spaces")
      return
    }

    setIsLoading(true)
    setError("")
    setNameError("")

    try {
      const { accessToken, refreshToken, user } = verifiedData

      try {
        await apiClient.patch("/food/user/profile", 
          { name: normalizedName },
          { headers: { Authorization: `Bearer ${accessToken}` } }
        )
      } catch (e) {
        console.error("Failed to update name on backend, but proceeding with login", e)
      }

      sessionStorage.removeItem("userAuthData")
      clearAuthDraft("user")
      setUserAuthData("user", accessToken, { ...user, name: normalizedName }, refreshToken)
      window.dispatchEvent(new Event("userAuthChanged"))
      await registerWebPushForCurrentModule("/food/user", { force: true }).catch(() => {})
      setTimeout(() => navigate("/food/user"), 400)
    } catch (err) {
      setError("Failed to complete registration. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleResend = async () => {
    if (resendTimer > 0 || isLoading) return
    setIsLoading(true)
    setError("")
    try {
      const phone = authData?.method === "phone" ? authData.phone : null
      const email = authData?.method === "email" ? authData.email : null
      const purpose = authData?.isSignUp ? "register" : "login"
      await authAPI.sendOTP(phone, purpose, email)
      setResendTimer(60)
    } catch (err) {
      setError("Failed to resend OTP.")
    } finally {
      setIsLoading(false)
    }
    setOtp(["", "", "", ""])
  }

  // The one Edit Phone Number action: end the pending OTP step, keep the phone,
  // and go back to the phone page's own history entry (never push a new one).
  const handleEditPhone = () => {
    startPhoneEdit({
      module: "user",
      navigate,
      loginPath: "/food/user/auth/login",
      cameFromLogin: location.state?.fromLogin === true,
      phone: authData?.phone,
      countryCode: "+91",
      isSignUp: authData?.isSignUp === true,
    })
  }

  if (!authData) return null

  return (
    <AnimatedPage className="relative min-h-[100dvh] w-full flex flex-col items-center justify-center font-sans overflow-hidden select-none bg-gray-50 dark:bg-[#0A0A0B]">
      {/* Background image for desktop view - fills the screen behind the card */}
      <div 
        className="absolute inset-0 bg-cover bg-center z-0 hidden sm:block"
        style={{ 
          backgroundImage: `url(${loginBgImg})`,
          filter: 'blur(10px)',
          transform: 'scale(1.05)',
          opacity: 0.35
        }}
      />
      {/* Dark overlay behind card on desktop */}
      <div className="absolute inset-0 bg-black/10 dark:bg-black/40 z-[1] hidden sm:block" />

      {/* Main Container - behaves like a normal page on mobile, and a premium card on desktop */}
      <div className="relative z-10 w-full sm:max-w-md sm:h-[680px] bg-white dark:bg-[#121620] sm:rounded-[32px] sm:shadow-2xl overflow-hidden flex flex-col min-h-[100dvh] sm:min-h-0 sm:border sm:border-gray-100 sm:dark:border-gray-800">
        {/* Top Header Section */}
        <div className="relative h-[36dvh] min-h-[250px] sm:h-[240px] sm:min-h-0 w-full overflow-hidden flex flex-col items-center justify-center">
        {/* Background Food Image */}
        <div 
          className="absolute inset-0 bg-cover bg-center z-0"
          style={{ 
            backgroundImage: `url(${loginBgImg})`,
            filter: 'blur(0.5px)',
            transform: 'scale(1.02)'
          }}
        />
        {/* Dark overlay to match the login screen and keep text highly readable */}
        <div 
          className="absolute inset-0 z-[5]"
          style={{
            background: "linear-gradient(135deg, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0.65) 100%)"
          }}
        />

        {/* Back button */}
        <button
          onClick={handleEditPhone}
          className="absolute top-6 left-6 p-2.5 rounded-full bg-white/20 backdrop-blur-md border border-white/30 text-white hover:bg-white/30 transition-all cursor-pointer z-20 shadow-md"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* Background Decorative Circles */}
        <div className="absolute inset-0 opacity-20 pointer-events-none z-10">
          <div className="absolute top-[-30%] right-[-20%] w-[320px] h-[320px] border border-white rounded-full" />
          <div className="absolute bottom-[-20%] left-[-15%] w-[260px] h-[260px] border border-white rounded-full" />
        </div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="relative z-10 flex flex-col items-center gap-3 px-6 text-center"
        >
          {/* Glass Icon Card */}
          <div className="w-18 h-18 bg-white/25 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/40 shadow-xl mb-1">
            <Smartphone className="w-9 h-9 text-white drop-shadow" />
          </div>
          <div className="space-y-1">
            <h1 className="text-white font-black text-2xl sm:text-3xl tracking-wide uppercase drop-shadow-sm">
              {showNameInput ? "ONE LAST STEP" : "VERIFICATION"}
            </h1>
            <div className="flex items-center justify-center gap-1.5 text-white/90 text-xs font-black uppercase tracking-wider">
              <span>{showNameInput ? "Tell us your name" : `SENT TO ${contactInfo}`}</span>
              {!showNameInput && (
                <button
                  onClick={handleEditPhone}
                  className="p-1 hover:text-white transition-colors cursor-pointer"
                  title="Edit Phone Number"
                  aria-label="Edit Phone Number"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Bottom Sheet Card */}
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="flex-1 bg-white dark:bg-[#121620] rounded-t-[40px] -mt-8 relative z-20 shadow-[0_-15px_40px_rgba(0,0,0,0.08)] px-6 pt-8 pb-6 flex flex-col justify-between"
      >
        <div className="max-w-md mx-auto w-full flex flex-col h-full justify-between">
          <AnimatePresence mode="wait">
            {!showNameInput ? (
              <motion.div
                key="otp-view"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-8"
              >
                {/* Instruction Heading */}
                <div className="text-center space-y-1">
                  <h2 className="text-xl font-black text-gray-900 dark:text-white tracking-tight">
                    Enter 4-Digit Verification Code
                  </h2>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    We&apos;ve sent an SMS with your code
                  </p>
                </div>

                {/* 4 Digit OTP Inputs */}
                <div className="flex justify-center gap-3 sm:gap-4">
                  {otp.map((digit, index) => (
                    <motion.div
                      key={index}
                      initial={{ scale: 0.85, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ delay: 0.06 * index }}
                      className="relative"
                    >
                      <input
                        ref={(el) => (inputRefs.current[index] = el)}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onFocus={() => { void ensureNotificationPermission() }}
                        onChange={(e) => handleChange(index, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(index, e)}
                        onPaste={index === 0 ? handlePaste : undefined}
                        disabled={isLoading}
                        className={`w-15 h-18 sm:w-16 sm:h-20 text-center text-3xl font-black rounded-2xl bg-gray-50 dark:bg-gray-900 border-2 transition-all outline-none shadow-sm ${
                          digit 
                            ? "border-[#659116] bg-emerald-50/30 dark:bg-emerald-950/20 text-gray-900 dark:text-white ring-4 ring-[#659116]/10" 
                            : "border-gray-200 dark:border-gray-800 focus:border-[#659116] focus:ring-4 focus:ring-[#659116]/10 text-gray-900 dark:text-white"
                        }`}
                      />
                      {digit && (
                        <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-[#659116] rounded-full" />
                      )}
                    </motion.div>
                  ))}
                </div>

                {/* Error Banner */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center justify-center gap-2 text-xs font-bold text-red-500 bg-red-50 dark:bg-red-950/20 py-3.5 px-4 rounded-2xl border border-red-200 dark:border-red-900/40"
                  >
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </motion.div>
                )}

                {/* Timer & Resend */}
                <div className="text-center space-y-4">
                  {resendTimer > 0 ? (
                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800/80 rounded-full text-xs font-bold text-gray-500 dark:text-gray-400">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#659116]" />
                      <span>Resend code in <strong className="text-gray-900 dark:text-white">{resendTimer}s</strong></span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={isLoading}
                      className="inline-flex items-center gap-2 text-xs font-black text-[#659116] hover:text-[#588114] uppercase tracking-wider px-5 py-2.5 rounded-full bg-[#659116]/10 hover:bg-[#659116]/20 transition-all cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Resend Code Now</span>
                    </button>
                  )}
                </div>
              </motion.div>
            ) : (
              /* Name Setup View */
              <motion.div
                key="name-view"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div className="space-y-1 text-center">
                  <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
                    What should we call you? 😃
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Enter your full name to complete your profile
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider pl-1">
                    Full Name
                  </label>
                  <div className="bg-gray-50 dark:bg-gray-900 border-2 border-[#659116] rounded-2xl focus-within:ring-4 focus-within:ring-[#659116]/10 transition-all overflow-hidden">
                    <Input
                      type="text"
                      value={name}
                      onChange={(e) => {
                        const sanitized = e.target.value.replace(/[^A-Za-z ]/g, "")
                        setName(sanitized)
                        if (nameError) setNameError("")
                      }}
                      disabled={isLoading}
                      placeholder="e.g. Rahul Sharma"
                      className="h-16 bg-transparent border-0 outline-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-lg font-black text-gray-900 dark:text-white px-5 placeholder:text-gray-400 placeholder:font-normal"
                    />
                  </div>
                  {nameError && (
                    <p className="text-xs font-bold text-red-500 pl-1 pt-0.5">
                      {nameError}
                    </p>
                  )}
                </div>

                <button
                  onClick={handleSubmitName}
                  disabled={isLoading || name.trim().length < 2}
                  className={`w-full h-16 rounded-2xl font-black text-base uppercase tracking-widest transition-all duration-300 shadow-md ${
                    name.trim().length >= 2 && !isLoading
                      ? "bg-[#659116] hover:bg-[#588114] text-white shadow-[#659116]/20 cursor-pointer active:scale-[0.98]"
                      : "bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed shadow-none"
                  }`}
                >
                  {isLoading ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin text-white" />
                      <span>Saving Profile...</span>
                    </div>
                  ) : (
                    "Complete Setup"
                  )}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Footer Security Badge */}
          <footer className="mt-8 text-center border-t border-gray-100 dark:border-gray-800/80 pt-4">
            <div className="flex items-center justify-center gap-1.5 text-[11px] font-bold text-gray-500 dark:text-gray-400">
              <ShieldCheck className="w-3.5 h-3.5 text-[#659116]" />
              <span>EATIEFY SECURE NETWORK</span>
            </div>
          </footer>
        </div>
      </motion.div>
      </div>
    </AnimatedPage>
  )
}

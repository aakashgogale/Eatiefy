import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Loader2, Smartphone, AlertCircle } from "lucide-react"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { Input } from "@food/components/ui/input"
import { Button } from "@food/components/ui/button"
import { authAPI } from "@food/api"
import { setAuthData as setUserAuthData } from "@food/utils/auth"

export default function OTP() {
  const navigate = useNavigate()
  const [otp, setOtp] = useState(["", "", "", ""]) // exactly 4 digits
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [resendTimer, setResendTimer] = useState(0)
  const [authData, setAuthData] = useState(null)
  const [showNameInput, setShowNameInput] = useState(false)
  const [name, setName] = useState("")
  const [nameError, setNameError] = useState("")
  const [verifiedOtp, setVerifiedOtp] = useState("")
  const [contactInfo, setContactInfo] = useState("")
  const [contactType, setContactType] = useState("phone")
  const [deviceToken, setDeviceToken] = useState(null)
  const [activePlatform, setActivePlatform] = useState("web")
  const [showRestorePopup, setShowRestorePopup] = useState(false)
  const [deletedAccountData, setDeletedAccountData] = useState(null)
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
      // No auth data, redirect to sign in
      navigate("/user/auth/login", { replace: true })
      return
    }
    const data = JSON.parse(stored)
    setAuthData(data)

    // Handle both phone and email
    if (data.method === "email" && data.email) {
      setContactType("email")
      setContactInfo(data.email)
    } else if (data.phone) {
      setContactType("phone")
      // Extract and format phone number for display
      const phoneMatch = data.phone?.match(/(\+\d+)\s*(.+)/)
      if (phoneMatch) {
        const formattedPhone = `${phoneMatch[1]}-${phoneMatch[2].replace(/\D/g, "")}`
        setContactInfo(formattedPhone)
      } else {
        setContactInfo(data.phone || "")
      }

      // OTP auto-fill removed - user must manually enter OTP
    }

    // Start resend timer (60 seconds)
    setResendTimer(60)
    const timer = setInterval(() => {
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
    // Focus first input on mount + open mobile keyboard automatically
    if (!showNameInput) {
      const timer = setTimeout(() => {
        const el = inputRefs.current[0]
        if (el) {
          el.focus({ preventScroll: true })
          // In mobile WebView the soft keyboard often won't open on a
          // programmatic focus alone, so also trigger a click to force it.
          el.click()
        }
      }, 250)
      return () => clearTimeout(timer)
    }
  }, [showNameInput])

  const handleSingleInputChange = (e) => {
    let val = e.target.value.replace(/\D/g, "");
    if (val.length > 4) val = val.slice(0, 4);
    
    if (val.length > 0) setError("");
    
    const newOtp = ["", "", "", ""];
    for (let i = 0; i < val.length; i++) {
      newOtp[i] = val[i];
    }
    setOtp(newOtp);
    
    if (!showNameInput && val.length === 4) {
      handleVerify(val);
    }
  }

  const handleVerify = async (otpValue = null, confirmAction = null) => {
    if (showNameInput && !confirmAction) return
    if (submittingRef.current) return

    const code = (otpValue || otp.join("")).replace(/\D/g, "")
    const code4 = code.slice(0, 4)
    if (code4.length !== 4) {
      setError("OTP must be exactly 4 digits")
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

      // Try to get FCM token before verifying OTP
      let fcmToken = null;
      let platform = "web";
      try {
        if (typeof window !== "undefined") {
          if (window.flutter_inappwebview) {
            platform = "mobile";
            const handlerNames = ["getFcmToken", "getFCMToken", "getPushToken", "getFirebaseToken"];
            for (const handlerName of handlerNames) {
              try {
                const t = await window.flutter_inappwebview.callHandler(handlerName, { module: "user" });
                if (t && typeof t === "string" && t.length > 20) {
                  fcmToken = t.trim();
                  break;
                }
              } catch (e) {}
            }
          } else {
            fcmToken = localStorage.getItem("fcm_web_registered_token_user") || null;
          }
        }
      } catch (e) {
        console.warn("Failed to get FCM token during login", e);
      }

      setDeviceToken(fcmToken);
      setActivePlatform(platform);

      const response = await authAPI.verifyOTP(
        phone,
        code4,
        purpose,
        providedName,
        email,
        "user",
        null,
        referralCode,
        fcmToken,
        platform,
        null,
        confirmAction
      )
      const data = response?.data?.data || response?.data || {}

      // Handle deleted account found
      if (data.deletedAccountFound) {
        setDeletedAccountData(data)
        setShowRestorePopup(true)
        setIsLoading(false)
        submittingRef.current = false
        return
      }

      const accessToken = data.accessToken
      const refreshToken = data.refreshToken ?? null
      const user = data.user

      if (!accessToken || !user) {
        throw new Error("Invalid response from server")
      }
      if (!refreshToken) {
        throw new Error("Invalid response from server: missing refresh token")
      }

      // Check if user needs name prompt (isNewUser flag or missing name)
      const hasName = user.name && String(user.name).trim().length > 0 && String(user.name).toLowerCase() !== "null";
      const needsName = data.isNewUser === true || !hasName;

      if (needsName) {
        setVerifiedOtp(code4)
        setShowNameInput(true)
        setIsLoading(false)
        submittingRef.current = false
        return
      }

      // Clear auth data from sessionStorage
      sessionStorage.removeItem("userAuthData")

      setUserAuthData("user", accessToken, user, refreshToken)

      // Dispatch custom event for same-tab updates
      window.dispatchEvent(new Event("userLoginSuccess"))

      setSuccess(true)

      // Redirect to user home after short delay
      setTimeout(() => {
        navigate("/food/user")
      }, 500)
    } catch (err) {
      const status = err?.response?.status
      let message =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to verify OTP. Please try again."
      if (status === 401) {
        // Friendlier copy for deactivated users or auth errors
        if (/deactivat(ed|e)/i.test(String(message))) {
          message = "Your account is deactivated. Please contact support."
        } else {
          message = "Invalid or expired code, or account not active."
        }
      }
      setError(message)
      setIsLoading(false)
      submittingRef.current = false
    }
  }

  const handleSubmitName = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setNameError("Name is required")
      return
    }

    if (trimmedName.length < 2) {
      setNameError("Name must be at least 2 characters")
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
      const phone = authData?.method === "phone" ? authData.phone : null
      const email = authData?.method === "email" ? authData.email : null
      const purpose = authData?.isSignUp ? "register" : "login"
      const referralCode = authData?.referralCode || null

      // Second call with name to auto-register and login
      const response = await authAPI.verifyOTP(
        phone,
        verifiedOtp,
        purpose,
        trimmedName,
        email,
        "user",
        null,
        referralCode,
        deviceToken,
        activePlatform
      )
      const data = response?.data?.data || response?.data || {}

      const accessToken = data.accessToken
      const refreshToken = data.refreshToken ?? null
      const user = data.user

      if (!accessToken || !user) {
        throw new Error("Invalid response from server")
      }
      if (!refreshToken) {
        throw new Error("Invalid response from server: missing refresh token")
      }

      sessionStorage.removeItem("userAuthData")

      setUserAuthData("user", accessToken, user, refreshToken)

      window.dispatchEvent(new Event("userLoginSuccess"))

      setSuccess(true)

      setTimeout(() => {
        navigate("/food/user")
      }, 500)
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to complete registration. Please try again."
      setError(message)
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

      // Call backend to resend OTP
      await authAPI.sendOTP(phone, purpose, email)
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to resend OTP. Please try again."
      setError(message)
    } finally {
      setIsLoading(false)
    }

    // Reset timer to 60 seconds
    setResendTimer(60)
    const timer = setInterval(() => {
      setResendTimer((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    setOtp(["", "", "", ""])
    setShowNameInput(false)
    setName("")
    setNameError("")
    setVerifiedOtp("")
    inputRefs.current[0]?.focus()
  }

  const handleRestoreAction = async (action) => {
    setShowRestorePopup(false)
    const code = otp.join("")
    await handleVerify(code, action)
  }

  if (!authData) {
    return null
  }

  return (
    <AnimatedPage className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] flex items-center justify-center p-4">
      {/* Background decoration (desktop only) */}
      <div className="fixed inset-0 z-0 hidden md:block opacity-40">
        <img src={loginBanner} alt="" className="w-full h-full object-cover blur-sm" />
        <div className="absolute inset-0 bg-white/60 dark:bg-black/80" />
      </div>

      <div className="w-full max-w-[450px] bg-white dark:bg-[#1a1a1a] rounded-xl shadow-2xl relative z-10 overflow-hidden border border-gray-100 dark:border-gray-800">
        {/* Header */}
        <div className="flex items-center px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <button
            onClick={() => navigate("/food/user/auth/login")}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5 text-gray-600 dark:text-gray-300" />
          </button>
          <span className="ml-4 font-bold text-gray-900 dark:text-white">
            {showNameInput ? "Welcome!" : "OTP Verification"}
          </span>
        </div>

        <div className="p-6 sm:p-8 md:p-10 space-y-6 md:space-y-8">
          {/* Message */}
          <div className="text-center space-y-4">
            {showNameInput && (
              <div className="flex justify-center">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                  <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center shadow-lg shadow-primary/30 text-white">
                    <Smartphone className="h-5 w-5" />
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white leading-tight">
                {showNameInput 
                  ? "Help us know you better" 
                  : contactType === "email"
                    ? "Verify your email"
                    : "Verify your phone"}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs mx-auto">
                {showNameInput
                  ? "We're excited to have you join us! Please tell us your full name to get started."
                  : `We've sent a 4-digit code to ${contactInfo}`}
              </p>
            </div>
          </div>

          {/* OTP Input Fields */}
          {!showNameInput && (
            <div className="space-y-6">
                  <div className="relative flex justify-between gap-3 w-full">
                    <input
                      ref={(el) => (inputRefs.current[0] = el)}
                      type="tel"
                      inputMode="numeric"
                      maxLength={4}
                      required
                      disabled={isLoading}
                      autoFocus
                      value={otp.join("")}
                      onChange={handleSingleInputChange}
                      className="absolute inset-0 w-full h-full bg-transparent text-transparent caret-transparent outline-none focus:outline-none focus:ring-0 z-10 cursor-text text-[16px]"
                    />
                    {[0, 1, 2, 3].map((index) => (
                      <div
                        key={index}
                        className={`flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 text-center text-xl font-bold border-2 rounded-xl transition-all outline-none bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-white
                          ${isLoading ? "opacity-50" : 
                            (otp.join("").length === index && !isLoading) ? "border-primary ring-1 ring-primary" : 
                            (otp[index] ? "border-primary" : "border-gray-200 dark:border-gray-700")}
                        `}
                      >
                        {otp[index]}
                      </div>
                    ))}
                  </div>

              {error && (
                <div className="flex items-center justify-center gap-1.5 text-xs text-red-500 bg-red-50 dark:bg-red-900/10 py-2 rounded-lg">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Resend Section */}
              <div className="text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Didn't get the OTP?{" "}
                  {resendTimer > 0 ? (
                    <span className="font-medium text-gray-900 dark:text-white">Retry in {resendTimer}s</span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={isLoading}
                      className="text-primary hover:text-[#991B1B] font-bold transition-colors disabled:opacity-50"
                    >
                      Resend SMS
                    </button>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Name Input */}
          {showNameInput && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (nameError) setNameError("")
                  }}
                  disabled={isLoading}
                  placeholder="Full Name"
                  className={`h-12 md:h-14 text-lg bg-white dark:bg-[#1a1a1a] text-gray-900 dark:text-white border-gray-300 dark:border-gray-700 rounded-xl focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary ${nameError ? "border-red-500" : ""} transition-all`}
                />
                {nameError && (
                  <p className="text-xs text-red-500 pl-1">
                    {nameError}
                  </p>
                )}
              </div>

              <Button
                onClick={handleSubmitName}
                disabled={isLoading}
                className="w-full h-12 md:h-14 bg-primary hover:bg-[#991B1B] text-white font-bold text-lg rounded-xl transition-all hover:shadow-lg active:scale-[0.98]"
              >
                {isLoading ? "Getting things ready..." : "Finish Registration"}
              </Button>
            </div>
          )}

          {/* Verification Loading Overlay */}
          {isLoading && !showNameInput && (
            <div className="flex justify-center pt-2">
              <Loader2 className="h-6 w-6 text-primary animate-spin" />
            </div>
          )}
        </div>
        
        {/* Footer info */}
        <div className="p-6 bg-gray-50 dark:bg-[#1f1f1f] text-center">
            <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-widest font-bold">
                Ometto Food Delivery
            </p>
        </div>
      </div>

      {/* Restore/New Account Popup */}
      {showRestorePopup && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 overflow-y-auto py-10">
          <div 
            className="w-full max-w-sm bg-white dark:bg-[#1a1a1a] rounded-3xl shadow-2xl overflow-hidden p-6 text-center border border-gray-100 dark:border-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Smartphone className="h-8 w-8 text-primary" />
            </div>
            
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Account Found!</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              A deleted account for <span className="font-bold text-gray-900 dark:text-white">{contactInfo}</span> was found. 
              Do you want to restore your old data or start fresh with a new account?
            </p>

            <div className="space-y-3">
              <Button
                onClick={() => handleRestoreAction("restore")}
                className="w-full h-12 bg-primary hover:bg-[#991B1B] text-white font-bold rounded-xl shadow-lg shadow-primary/20"
              >
                Restore My Account
              </Button>
              <Button
                variant="outline"
                onClick={() => handleRestoreAction("new")}
                className="w-full h-12 border-2 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-bold rounded-xl"
              >
                Create New Account
              </Button>
            </div>
          </div>
        </div>
      )}
    </AnimatedPage>
  )
}

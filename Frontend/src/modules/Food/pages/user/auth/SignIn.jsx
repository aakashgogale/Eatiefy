import { useState, useEffect, useRef } from "react"
import { useNavigate, Link, useSearchParams } from "react-router-dom"
import { AlertCircle, Loader2, ArrowRight, ShieldCheck, ArrowLeft } from "lucide-react"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { Input } from "@food/components/ui/input"
import { authAPI } from "@food/api"
import { motion, AnimatePresence } from "framer-motion"
import logoImg from "@food/assets/switcheats-logo copy.png"
import loginBgImg from "@food/assets/login_bg.jpg"
import { getCachedSettings, loadBusinessSettings } from "@food/utils/businessSettings"

const debugError = (...args) => { }

export default function SignIn() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [logoUrl, setLogoUrl] = useState(() => {
    const cached = getCachedSettings()
    return cached?.logo?.url || logoImg
  })
  const [companyName, setCompanyName] = useState(() => {
    const cached = getCachedSettings()
    return cached?.companyName || "Eatiefy"
  })

  const [formData, setFormData] = useState({
    phone: "",
    countryCode: "+91",
  })

  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const submittingRef = useRef(false)

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settings = await loadBusinessSettings()
        if (settings) {
          if (settings.logo?.url) setLogoUrl(settings.logo.url)
          if (settings.companyName) setCompanyName(settings.companyName)
        }
      } catch (err) {
        debugError("Error loading business settings:", err)
      }
    }
    fetchSettings()
  }, [])

  useEffect(() => {
    const stored = sessionStorage.getItem("userAuthData")
    if (!stored) return

    try {
      const data = JSON.parse(stored)
      const fullPhone = String(data.phone || "").trim()
      const phoneDigits = fullPhone.replace(/^\+91\s*/, "").replace(/\D/g, "").slice(0, 10)

      setFormData((prev) => ({
        ...prev,
        phone: phoneDigits || prev.phone,
      }))
    } catch (err) {
      debugError("Error parsing stored auth data:", err)
    }
  }, [])

  const validatePhone = (phone) => {
    if (!phone.trim()) return "Phone number is required"
    const cleanPhone = phone.replace(/\D/g, "")
    if (!/^\d{10}$/.test(cleanPhone)) return "Phone number must be 10 digits"
    return ""
  }

  const handleChange = (e) => {
    const { name } = e.target
    let { value } = e.target

    if (name === "phone") {
      value = value.replace(/\D/g, "").slice(0, 10)
      setError(validatePhone(value))
    }

    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const phoneError = validatePhone(formData.phone)
    setError(phoneError)
    if (phoneError) return
    if (submittingRef.current) return
    submittingRef.current = true
    setIsLoading(true)
    setError("")

    try {
      const countryCode = formData.countryCode?.trim() || "+91"
      const phoneDigits = String(formData.phone ?? "").replace(/\D/g, "").slice(0, 10)
      if (phoneDigits.length !== 10) {
        setError("Phone number must be 10 digits")
        setIsLoading(false)
        submittingRef.current = false
        return
      }
      const fullPhone = `${countryCode} ${phoneDigits}`
      await authAPI.sendOTP(fullPhone, "login", null)

      const ref = String(searchParams.get("ref") || "").trim()
      const authData = {
        method: "phone",
        phone: fullPhone,
        email: null,
        name: null,
        referralCode: ref || null,
        isSignUp: false,
        module: "user",
      }

      sessionStorage.setItem("userAuthData", JSON.stringify(authData))
      navigate("/food/user/auth/otp")
    } catch (apiError) {
      const message =
        apiError?.response?.data?.message ||
        apiError?.response?.data?.error ||
        "Failed to send OTP. Please try again."
      setError(message)
    } finally {
      setIsLoading(false)
      submittingRef.current = false
    }
  }

  const isValidPhone = formData.phone.length === 10

  return (
    <AnimatedPage className="relative min-h-[100dvh] w-full flex flex-col items-center justify-between font-sans overflow-hidden select-none">
      {/* Layer 1 – Original Background */}
      <div 
        className="absolute inset-0 bg-cover bg-center z-0"
        style={{ 
          backgroundImage: `url(${loginBgImg})`,
          filter: 'blur(1.5px)',
          transform: 'scale(1.02)'
        }}
      />
      {/* Background Overlay */}
      <div 
        className="absolute inset-0 z-[5]"
        style={{ background: "rgba(0, 0, 0, 0.18)" }}
      />

      {/* Layer 2 – Blurred Background */}
      <div 
        className="absolute inset-0 z-10"
        style={{
          backgroundImage: `url(${loginBgImg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(7px)',
          transform: 'scale(1.03)',
          opacity: 0.45,
          maskImage: 'linear-gradient(to bottom, transparent 0%, transparent 30%, black 55%, black 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, transparent 30%, black 55%, black 100%)'
        }}
      />

      {/* Content Container */}
      <div className="relative z-20 w-full min-h-[100dvh] flex flex-col justify-between py-6 px-4 sm:px-6">
        {/* Top Header - Back Button */}
        <div className="flex items-center justify-between w-full">
          <button
            onClick={() => navigate("/food/user")}
            className="p-2.5 bg-black/35 hover:bg-black/45 backdrop-blur-md rounded-full text-white transition-all active:scale-95 shadow-md flex items-center justify-center cursor-pointer border border-white/10"
            aria-label="Continue as Guest"
          >
            <ArrowLeft className="w-6 h-6 stroke-[2.5]" />
          </button>
        </div>

        {/* Hero Tagline */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-center px-4 max-w-sm mx-auto my-auto flex items-center justify-center"
          style={{ minHeight: "20vh" }}
        >
          <h1 
            className="text-white font-bold text-2xl sm:text-3xl tracking-tight leading-snug"
            style={{ textShadow: '0 2px 10px rgba(0, 0, 0, 0.45)' }}
          >
            Delicious food, delivered fresh to your doorstep.
          </h1>
        </motion.div>

        {/* Floating Glassmorphic Form Card */}
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md mx-auto p-6 sm:p-8 flex flex-col justify-between mb-14 animate-fade-in"
          style={{
            background: "rgba(255, 255, 255, 0.85)",
            border: "1px solid rgba(255, 255, 255, 0.45)",
            borderRadius: "32px",
            boxShadow: "0 24px 60px rgba(0, 0, 0, 0.18), 0 8px 20px rgba(0, 0, 0, 0.08)"
          }}
        >
          <div>
            <div className="space-y-1 mb-6">
              <h2 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
                Get Started
              </h2>
              <p className="text-xs sm:text-sm font-medium text-gray-600">
                Enter your mobile number to continue.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <div className={`relative flex items-center bg-white border-2 rounded-2xl transition-all duration-200 overflow-hidden shadow-sm ${
                  isValidPhone 
                    ? "border-[#659116] ring-4 ring-[#659116]/10" 
                    : error 
                    ? "border-red-500 ring-4 ring-red-500/10" 
                    : "border-[#659116] focus-within:ring-4 focus-within:ring-[#659116]/10"
                }`}>
                  <div className="flex items-center gap-1.5 px-4 py-4 bg-white text-gray-900 font-black text-lg border-r border-[#659116]/30 flex-shrink-0 select-none">
                    <span>🇮🇳</span>
                    <span>+91</span>
                  </div>

                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="Mobile Number"
                    value={formData.phone}
                    onChange={handleChange}
                    className="flex-1 h-16 text-lg font-black text-gray-900 bg-transparent border-0 outline-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 tracking-wider px-4 placeholder:text-gray-400 placeholder:font-normal"
                  />

                  {isValidPhone && (
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="pr-4 text-[#659116]">
                      <ShieldCheck className="w-5 h-5 fill-[#659116]/20" />
                    </motion.div>
                  )}
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-1.5 text-xs font-bold text-red-500 pl-1 pt-0.5"
                  >
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span>{error}</span>
                  </motion.div>
                )}
              </div>

              <button
                type="submit"
                disabled={isLoading || !isValidPhone}
                className={`w-full h-16 rounded-2xl font-black text-base uppercase tracking-widest flex items-center justify-center gap-2 transition-all duration-300 shadow-md ${
                  isValidPhone && !isLoading
                    ? "bg-[#a6cb82] hover:bg-[#95b873] text-white shadow-[0_8px_20px_rgba(166,203,130,0.3)] active:scale-[0.98] cursor-pointer"
                    : "bg-[#a6cb82]/60 text-white/80 cursor-not-allowed shadow-none opacity-80"
                }`}
              >
                {isLoading ? (
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-white" />
                    <span>Verifying...</span>
                  </div>
                ) : (
                  <>
                    <span>CONTINUE</span>
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </form>
          </div>

          <footer className="mt-8 text-center border-t border-gray-200 pt-4 space-y-1">
            <p className="text-[10px] text-gray-500 font-bold tracking-wide uppercase">
              BY JOINING, YOU AGREE TO OUR POLICIES
            </p>
            <p className="text-[10px] text-gray-500 font-extrabold uppercase tracking-widest">
              <Link to="/food/user/profile/terms" className="hover:text-[#659116]">TERMS</Link> • <Link to="/food/user/profile/privacy" className="hover:text-[#659116]">PRIVACY</Link> • <Link to="/food/user/profile/help-content" className="hover:text-[#659116]">SUPPORT</Link>
            </p>
          </footer>
        </motion.div>
      </div>
    </AnimatedPage>
  )
}

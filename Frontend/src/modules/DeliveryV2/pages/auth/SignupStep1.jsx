import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"
import { deliveryAPI } from "@food/api"
import useDeliveryBackNavigation from "../../hooks/useDeliveryBackNavigation"
const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


export default function SignupStep1() {
  const navigate = useNavigate()
  const goBack = useDeliveryBackNavigation()
  const [formData, setFormData] = useState(() => {
    const saved = sessionStorage.getItem("deliverySignupDetails")
    const base = {
      name: "",
      phone: "",
      countryCode: "+91",
      ref: "",
      email: "",
      address: "",
      city: "",
      state: "",
      vehicleType: "bike",
      vehicleName: "",
      vehicleNumber: "",
      drivingLicenseNumber: "",
      panNumber: "",
      aadharNumber: ""
    }
    if (saved) {
      try {
        return { ...base, ...JSON.parse(saved) }
      } catch (e) {
        debugError("Error parsing saved details:", e)
      }
    }
    return base
  })
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [keyboardInset, setKeyboardInset] = useState(0)
  const [isInputFocused, setIsInputFocused] = useState(false)

  // Listen to mobile virtual keyboard and input focus events
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

  const handleInputFocus = (e) => {
    setIsInputFocused(true)
    setTimeout(() => {
      e?.target?.scrollIntoView({ behavior: "smooth", block: "center" })
    }, 320)
  }

  const sanitizeLocationValue = (value) =>
    value.replace(/[^A-Za-z\s.-]/g, "").replace(/\s{2,}/g, " ")

  const sanitizeNameValue = (value) =>
    value.replace(/[^A-Za-z\s]/g, "").replace(/\s{2,}/g, " ")

  const isValidLocationValue = (value) =>
    /^[A-Za-z][A-Za-z\s.-]*[A-Za-z.]$/.test(value.trim())

  const isValidNameValue = (value) =>
    /^[A-Za-z][A-Za-z\s]*[A-Za-z]$/.test(value.trim())

  const drivingLicenseRegex = /^[A-Z]{2}[0-9A-Z]{8,16}$/

  const isValidEmailValue = (value) => {
    const normalizedValue = value.trim()
    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9\-]+(?:\.[a-zA-Z0-9\-]+)*\.[a-zA-Z]{2,10}$/;
    if (!emailRegex.test(normalizedValue) || normalizedValue.includes('..')) {
      return false
    }

    const [, domain = ""] = normalizedValue.split("@")
    const normalizedDomain = domain.toLowerCase()

    if (normalizedDomain.startsWith("gmail.") && normalizedDomain !== "gmail.com") {
      return false
    }

    // Check for repeated domain parts (e.g., .com.com)
    const segments = normalizedDomain.split('.')
    if (segments.length >= 2 && segments[segments.length - 1] === segments[segments.length - 2]) {
      return false
    }

    return true
  }

  const sanitizeEmailValue = (value) =>
    value.replace(/\s/g, "").toLowerCase()

  // Save data to session storage whenever formData changes
  useEffect(() => {
    sessionStorage.setItem("deliverySignupDetails", JSON.stringify(formData))
  }, [formData])

  const handleBlur = (e) => {
    const { name, value } = e.target;
    let updatedValue = value;

    if (name === "vehicleNumber" || name === "panNumber" || name === "drivingLicenseNumber") {
      updatedValue = value.toUpperCase();
    }
    if (name === "name") {
      updatedValue = sanitizeNameValue(value);
    }
    if (name === "drivingLicenseNumber") {
      updatedValue = updatedValue.replace(/[^A-Z0-9]/g, "").slice(0, 16);
    }
    if (name === "aadharNumber") {
      updatedValue = value.replace(/\D/g, "").slice(0, 12);
    }
    if (name === "city" || name === "state") {
      updatedValue = sanitizeLocationValue(value);
    }
    if (name === "email") {
      updatedValue = sanitizeEmailValue(value);
    }

    setFormData(prev => ({ ...prev, [name]: updatedValue }));
  };

  const handleChange = (e) => {
    const { name, value } = e.target
    let updatedValue = value

    if (name === "name") {
      updatedValue = value.replace(/[^A-Za-z\s]/g, "").slice(0, 60)
    }
    if (name === "vehicleNumber") {
      updatedValue = updatedValue.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)
    }
    if (name === "drivingLicenseNumber") {
      updatedValue = updatedValue.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16)
    }
    if (name === "panNumber") {
      updatedValue = updatedValue.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)
    }
    if (name === "aadharNumber") {
      updatedValue = value.replace(/\D/g, "").slice(0, 12)
    }

    setFormData(prev => ({
      ...prev,
      [name]: updatedValue
    }))
    // Clear error for this field
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ""
      }))
    }
  }

  const validate = () => {
    const newErrors = {}

    if (!formData.name.trim()) {
      newErrors.name = "Name is required"
    } else if (!isValidNameValue(formData.name)) {
      newErrors.name = "Name can contain letters only"
    }

    if (formData.email && !isValidEmailValue(formData.email)) {
      newErrors.email = "Enter a valid email address. Gmail must be gmail.com"
    }

    if (!formData.address.trim()) {
      newErrors.address = "Address is required"
    }

    if (!formData.city.trim()) {
      newErrors.city = "City is required"
    } else if (!isValidLocationValue(formData.city)) {
      newErrors.city = "City can contain letters only"
    }

    if (!formData.state.trim()) {
      newErrors.state = "State is required"
    } else if (!isValidLocationValue(formData.state)) {
      newErrors.state = "State can contain letters only"
    }

    if (!formData.vehicleNumber.trim()) {
      newErrors.vehicleNumber = "Vehicle number is required"
    } else if (!/^[A-Z]{2}[0-9]{1,2}[A-Z]{1,2}[0-9]{4}$/.test(formData.vehicleNumber)) {
      newErrors.vehicleNumber = "Invalid Indian vehicle number format (e.g., MH12AB1234)"
    }

    if (!formData.drivingLicenseNumber.trim()) {
      newErrors.drivingLicenseNumber = "Driving license number is required"
    } else if (!drivingLicenseRegex.test(formData.drivingLicenseNumber)) {
      newErrors.drivingLicenseNumber = "Invalid DL format (e.g., DL0120110012345)"
    }

    if (!formData.panNumber.trim()) {
      newErrors.panNumber = "PAN number is required"
    } else if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(formData.panNumber)) {
      newErrors.panNumber = "Invalid PAN format (e.g., ABCDE1234F)"
    }

    if (!formData.aadharNumber.trim()) {
      newErrors.aadharNumber = "Aadhar number is required"
    } else if (!/^\d{12}$/.test(formData.aadharNumber.replace(/\s/g, ""))) {
      newErrors.aadharNumber = "Aadhar number must be 12 digits"
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!validate()) {
      toast.error("Please fill all required fields correctly")
      return
    }

    setIsSubmitting(true)

    try {
      // Check for duplicates before proceeding
      const duplicates = []
      
      if (formData.panNumber) {
        try {
          const res = await deliveryAPI.checkDuplicate({ panNumber: formData.panNumber.trim().toUpperCase() })
          if (res?.data?.exists) {
            duplicates.push(`PAN number (${formData.panNumber}) is already registered`)
          }
        } catch (e) {
          debugWarn("Error checking PAN duplicate:", e)
        }
      }

      if (formData.aadharNumber) {
        try {
          const res = await deliveryAPI.checkDuplicate({ aadharNumber: formData.aadharNumber.replace(/\s/g, "") })
          if (res?.data?.exists) {
            duplicates.push(`Aadhar number is already registered`)
          }
        } catch (e) {
          debugWarn("Error checking Aadhar duplicate:", e)
        }
      }

      if (formData.drivingLicenseNumber) {
        try {
          const res = await deliveryAPI.checkDuplicate({ drivingLicenseNumber: formData.drivingLicenseNumber.trim().toUpperCase() })
          if (res?.data?.exists) {
            duplicates.push(`Driving license number is already registered`)
          }
        } catch (e) {
          debugWarn("Error checking DL duplicate:", e)
        }
      }

      if (duplicates.length > 0) {
        duplicates.forEach(msg => toast.error(msg))
        setIsSubmitting(false)
        return
      }

      const details = {
        name: formData.name.trim(),
        phone: String(formData.phone || "").replace(/\D/g, "").slice(0, 15),
        countryCode: formData.countryCode || "+91",
        ref: String(formData.ref || "").trim() || "",
        email: formData.email?.trim() || "",
        address: formData.address.trim(),
        city: formData.city.trim(),
        state: formData.state.trim(),
        vehicleType: formData.vehicleType || "bike",
        vehicleName: formData.vehicleName?.trim() || "",
        vehicleNumber: formData.vehicleNumber.trim(),
        drivingLicenseNumber: formData.drivingLicenseNumber.trim().toUpperCase(),
        panNumber: formData.panNumber.trim().toUpperCase(),
        aadharNumber: formData.aadharNumber.replace(/\s/g, "")
      }
      sessionStorage.setItem("deliverySignupDetails", JSON.stringify(details))
      toast.success("Details saved")
      navigate("/food/delivery/signup/documents")
    } catch (error) {
      debugError("Error saving details:", error)
      toast.error("Failed to save. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      className="min-h-[100dvh] bg-gray-100 flex flex-col overflow-x-clip touch-pan-y"
      style={{ WebkitOverflowScrolling: 'touch' }}
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
        <h1 className="text-lg font-bold text-gray-900">Complete Your Profile</h1>
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
          <h2 className="text-xl font-bold text-gray-900 mb-1">Basic Details</h2>
          <p className="text-sm text-gray-600">Please provide your information to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              onBlur={handleBlur}
              onFocus={handleInputFocus}
              maxLength={60}
              inputMode="text"
              className={`w-full px-4 py-3 bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B761] transition-colors ${errors.name ? "border-red-500" : "border-gray-300"
                }`}
              placeholder="Enter your full name"
            />
            {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email (Optional)
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              onBlur={handleBlur}
              onFocus={handleInputFocus}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="email"
              inputMode="email"
              className={`w-full px-4 py-3 bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B761] transition-colors ${errors.email ? "border-red-500" : "border-gray-300"
                }`}
              placeholder="Enter your email"
            />
            {errors.email && <p className="text-red-500 text-sm mt-1">{errors.email}</p>}
          </div>

          {/* Address */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Address <span className="text-red-500">*</span>
            </label>
            <textarea
              name="address"
              value={formData.address}
              onChange={handleChange}
              onBlur={handleBlur}
              onFocus={handleInputFocus}
              rows={3}
              className={`w-full px-4 py-3 bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B761] transition-colors ${errors.address ? "border-red-500" : "border-gray-300"
                }`}
              placeholder="Enter your full address"
            />
            {errors.address && <p className="text-red-500 text-sm mt-1">{errors.address}</p>}
          </div>

          {/* City and State */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                City <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="city"
                value={formData.city}
                onChange={handleChange}
                onBlur={handleBlur}
                onFocus={handleInputFocus}
                className={`w-full px-4 py-3 bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B761] transition-colors ${errors.city ? "border-red-500" : "border-gray-300"
                  }`}
                placeholder="City"
              />
              {errors.city && <p className="text-red-500 text-sm mt-1">{errors.city}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                State <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="state"
                value={formData.state}
                onChange={handleChange}
                onBlur={handleBlur}
                onFocus={handleInputFocus}
                className={`w-full px-4 py-3 bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B761] transition-colors ${errors.state ? "border-red-500" : "border-gray-300"
                  }`}
                placeholder="State"
              />
              {errors.state && <p className="text-red-500 text-sm mt-1">{errors.state}</p>}
            </div>
          </div>

          {/* Vehicle Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Vehicle Type <span className="text-red-500">*</span>
            </label>
            <select
              name="vehicleType"
              value={formData.vehicleType}
              onChange={handleChange}
              onFocus={handleInputFocus}
              className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B761]"
            >
              <option value="bike">Bike</option>
              <option value="scooter">Scooter</option>
              <option value="bicycle">Bicycle</option>
              <option value="car">Car</option>
            </select>
          </div>

          {/* Vehicle Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Vehicle Name/Model (Optional)
            </label>
            <input
              type="text"
              name="vehicleName"
              value={formData.vehicleName}
              onChange={handleChange}
              onBlur={handleBlur}
              onFocus={handleInputFocus}
              className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B761]"
              placeholder="e.g., Honda Activa"
            />
          </div>

          {/* Vehicle Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Vehicle Number <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="vehicleNumber"
              value={formData.vehicleNumber}
              onChange={handleChange}
              onBlur={handleBlur}
              onFocus={handleInputFocus}
              maxLength={10}
              className={`w-full px-4 py-3 bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B761] uppercase transition-colors ${errors.vehicleNumber ? "border-red-500" : "border-gray-300"
                }`}
              placeholder="e.g., MH12AB1234"
            />
            {errors.vehicleNumber && <p className="text-red-500 text-sm mt-1">{errors.vehicleNumber}</p>}
          </div>

          {/* Driving License Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Driving License Number <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="drivingLicenseNumber"
              value={formData.drivingLicenseNumber}
              onChange={handleChange}
              onBlur={handleBlur}
              onFocus={handleInputFocus}
              maxLength={16}
              className={`w-full px-4 py-3 bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B761] uppercase transition-colors ${errors.drivingLicenseNumber ? "border-red-500" : "border-gray-300"
                }`}
              placeholder="e.g., MH1220110012345"
            />
            {errors.drivingLicenseNumber && <p className="text-red-500 text-sm mt-1">{errors.drivingLicenseNumber}</p>}
          </div>

          {/* PAN Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              PAN Number <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="panNumber"
              value={formData.panNumber}
              onChange={handleChange}
              onBlur={handleBlur}
              onFocus={handleInputFocus}
              maxLength={10}
              className={`w-full px-4 py-3 bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B761] uppercase transition-colors ${errors.panNumber ? "border-red-500" : "border-gray-300"
                }`}
              placeholder="ABCDE1234F"
            />
            {errors.panNumber && <p className="text-red-500 text-sm mt-1">{errors.panNumber}</p>}
          </div>

          {/* Aadhar Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Aadhar Number <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="aadharNumber"
              value={formData.aadharNumber}
              onChange={handleChange}
              onBlur={handleBlur}
              onFocus={handleInputFocus}
              maxLength={12}
              inputMode="numeric"
              className={`w-full px-4 py-3 bg-white border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00B761] transition-colors ${errors.aadharNumber ? "border-red-500" : "border-gray-300"
                }`}
              placeholder="12-digit Aadhar number"
            />
            {errors.aadharNumber && <p className="text-red-500 text-sm mt-1">{errors.aadharNumber}</p>}
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className={`w-full py-4 rounded-xl font-bold text-white text-base shadow-lg transition-all active:scale-[0.98] ${isSubmitting
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-[#00B761] hover:bg-[#00A055] shadow-green-600/20"
                }`}
            >
              {isSubmitting ? "Saving..." : "Continue to Document Upload"}
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

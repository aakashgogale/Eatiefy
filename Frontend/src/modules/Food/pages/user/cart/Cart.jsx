import { useState, useEffect, useRef, useMemo, Fragment } from "react"
import { createPortal } from "react-dom"
import { Link, useNavigate, useLocation } from "react-router-dom"
import { Plus, Minus, ArrowLeft, ChevronRight, Clock, MapPin, Phone, FileText, Utensils, Tag, Percent, Share2, Share, ChevronUp, ChevronDown, X, Check, Settings, CreditCard, Wallet, Building2, Sparkles, Banknote, Zap, CheckCircle2, MessageCircle, Send, Mail, Copy, ShoppingBag, AlertTriangle } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import confetti from "canvas-confetti"

import AnimatedPage from "@food/components/user/AnimatedPage"
import { Button } from "@food/components/ui/button"
import { useCart } from "@food/context/CartContext"
import { useProfile } from "@food/context/ProfileContext"
import { useOrders } from "@food/context/OrdersContext"
import { useLocation as useUserLocation } from "@food/hooks/useLocation"
import { useZone } from "@food/hooks/useZone"
import { useLocationSelector } from "@food/components/user/UserLayout"
import { authAPI, orderAPI, restaurantAPI, adminAPI, userAPI, API_ENDPOINTS } from "@food/api"
import { API_BASE_URL } from "@food/api/config"
import { initRazorpayPayment, preloadRazorpayScript } from "@food/utils/razorpay"
import { toast } from "sonner"
import { getCompanyNameAsync } from "@food/utils/businessSettings"
import { calculateDistance, removePlusCode } from "@food/utils/common"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { getRestaurantAvailabilityStatus } from "@food/utils/restaurantAvailability"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"
import { filterPublicOffers, mapPublicOfferToCartCoupon } from "@food/utils/offerUtils"
import dishFallbackImage from "@food/assets/dish_fallback.webp"
const zoopSound = "/assets/media/zomato_sms.mp3"
const debugLog = (...args) => { }
const debugWarn = (...args) => { }
const debugError = (...args) => { }



// Removed hardcoded suggested items - now fetching approved addons from backend
// Coupons will be fetched from backend based on items in cart

/**
 * Format full address string from address object
 * @param {Object} address - Address object with street, additionalDetails, city, state, zipCode, or formattedAddress
 * @returns {String} Formatted address string
 */
const formatFullAddress = (address) => {
  if (!address) return ""

  const looksLikeLatLng = (s) => {
    if (!s) return false
    const v = String(s).trim()
    // Matches "12.34, 56.78" (lat,lng) with optional decimals/spaces
    return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(v)
  }

  // Priority 1: Use formattedAddress if available (for live location addresses)
  if (address.formattedAddress && address.formattedAddress !== "Select location") {
    // If formattedAddress is still raw coordinates, don't show it as-is.
    // Fall back to composing from city/state/area instead.
    if (!looksLikeLatLng(address.formattedAddress)) {
      return removePlusCode(address.formattedAddress)
    }
  }

  // Priority 2: Build address from parts
  const addressParts = []
  if (address.street) addressParts.push(address.street)
  if (address.additionalDetails) addressParts.push(address.additionalDetails)
  if (address.city) addressParts.push(address.city)
  if (address.state) addressParts.push(address.state)
  if (address.zipCode) addressParts.push(address.zipCode)

  if (addressParts.length > 0) {
    return removePlusCode(addressParts.join(', '))
  }

  // Priority 3: Use address field if available
  if (address.address && address.address !== "Select location") {
    return removePlusCode(address.address)
  }

  return ""
}

const RUPEE_SYMBOL = "\u20B9"
const CART_RECIPIENT_DETAILS_STORAGE_KEY = "food-cart-recipient-details-v1"
const CART_ORDER_NOTE_STORAGE_KEY = "food-cart-order-note-v1"

export default function Cart() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const location = useLocation()
  const goBack = useAppBackNavigation()
  const orderSuccessAudioRef = useRef(null)
  const hasRestoredRecipientRef = useRef(false)
  const hasRestoredNoteRef = useRef(false)

  // Defensive check: Ensure CartProvider is available
  let cartContext;
  try {
    cartContext = useCart();
  } catch (error) {
    debugError('? CartProvider not found. Make sure Cart component is rendered within UserLayout.');
    // Return early with error message
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5] dark:bg-[#0a0a0a]">
        <div className="text-center p-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Cart Error</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Cart functionality is not available. Please refresh the page.
          </p>
          <button
            onClick={() => navigate('/food/user')}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  const { cart, updateQuantity, addToCart, getCartCount, clearCart, cleanCartForRestaurant } = cartContext;
  const { getDefaultAddress, getDefaultPaymentMethod, setDefaultAddress, addresses, paymentMethods, userProfile, orderType, setOrderType } = useProfile()
  const { createOrder } = useOrders()
  const { openLocationSelector } = useLocationSelector()
  const { location: currentLocation, loading: currentLocationLoading } = useUserLocation() // Get live location address

  const [showCouponSheet, setShowCouponSheet] = useState(false)
  const [appliedCoupon, setAppliedCoupon] = useState(null)
  const [couponCode, setCouponCode] = useState(() => {
    try {
      if (typeof window === "undefined") return ""
      return localStorage.getItem("appliedCouponCode") || ""
    } catch {
      return ""
    }
  })
  const [manualCouponCode, setManualCouponCode] = useState(() => {
    try {
      if (typeof window === "undefined") return ""
      return localStorage.getItem("appliedCouponCode") || ""
    } catch {
      return ""
    }
  })

  // Persist coupon code to localStorage
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        if (couponCode) {
          localStorage.setItem("appliedCouponCode", couponCode)
        } else {
          localStorage.removeItem("appliedCouponCode")
        }
      }
    } catch {}
  }, [couponCode])

  // Clear coupon code if cart is empty
  useEffect(() => {
    if (cart.length === 0) {
      setAppliedCoupon(null)
      setCouponCode("")
      setManualCouponCode("")
    }
  }, [cart.length])
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("cash")
  const [showPaymentSheet, setShowPaymentSheet] = useState(false)
  const [walletBalance, setWalletBalance] = useState(0)
  const [isLoadingWallet, setIsLoadingWallet] = useState(false)
  const [restaurantNote, setRestaurantNote] = useState(() => {
    try {
      if (typeof window === "undefined") return ""
      const raw = window.localStorage.getItem(CART_ORDER_NOTE_STORAGE_KEY)
      if (!raw) return ""
      const stored = JSON.parse(raw)
      return String(stored?.restaurantNote || "")
    } catch {
      return ""
    }
  })
  const [showRestaurantNoteInput, setShowRestaurantNoteInput] = useState(() => {
    try {
      if (typeof window === "undefined") return false
      const raw = window.localStorage.getItem(CART_ORDER_NOTE_STORAGE_KEY)
      if (!raw) return false
      const stored = JSON.parse(raw)
      const storedRestaurantNote = String(stored?.restaurantNote || "")
      return Boolean(stored?.showRestaurantNoteInput) || storedRestaurantNote.trim().length > 0
    } catch {
      return false
    }
  })
  const [showShareModal, setShowShareModal] = useState(false)
  const [sharePayload, setSharePayload] = useState(null)
  const [isEditingRecipient, setIsEditingRecipient] = useState(false)
  const [recipientDetails, setRecipientDetails] = useState({
    name: "",
    phone: "",
  })

  const [sendCutlery, setSendCutlery] = useState(true)
  const [isPlacingOrder, setIsPlacingOrder] = useState(false)
  const [showBillDetails, setShowBillDetails] = useState(false)
  const [showPlacingOrder, setShowPlacingOrder] = useState(false)
  const [isScheduled, setIsScheduled] = useState(false)
  const [scheduledDate, setScheduledDate] = useState("")
  const [scheduledTime, setScheduledTime] = useState("")
  const [orderProgress, setOrderProgress] = useState(0)
  const [showSavingsCongrats, setShowSavingsCongrats] = useState(false)
  const [congratsSavingsAmount, setCongratssSavingsAmount] = useState(0)
  const [congratsSavingsPercentage, setCongratssSavingsPercentage] = useState(0)
  const [congratsSavingsItems, setCongratssSavingsItems] = useState([])
  const [showOrderSuccess, setShowOrderSuccess] = useState(false)
  const [orderSuccessSavingsAmount, setOrderSuccessSavingsAmount] = useState(0)
  const [placedOrderId, setPlacedOrderId] = useState(null)
  const [placedOrderObj, setPlacedOrderObj] = useState(null)
  const [selectedAddressId, setSelectedAddressId] = useState(null)
  const [deliveryAddressMode, setDeliveryAddressMode] = useState(() => {
    try {
      if (typeof window === "undefined") return "saved"
      return localStorage.getItem("deliveryAddressMode") || "saved"
    } catch {
      return "saved"
    }
  })


  const [customizationSettings, setCustomizationSettings] = useState({
    cod_enabled: true,
    takeaway_cod_enabled: true,
    delivery_cod_enabled: true,
    dining_cod_enabled: true,
    wallet_payment_enabled: true,
    online_payment_enabled: true,
  })

  useEffect(() => {
    userAPI.getCustomizationSettings()
      .then(res => {
        if (res?.data?.data) {
          setCustomizationSettings(prev => ({
            ...prev,
            ...res.data.data
          }))
        }
      })
      .catch(() => {
        debugError("Failed to fetch customization settings")
      })
  }, [])

  // Payment availability logic
  const isPaymentMethodEnabled = (methodId) => {
    if (methodId === "razorpay") return customizationSettings.online_payment_enabled !== false
    if (methodId === "wallet") return customizationSettings.wallet_payment_enabled !== false
    if (methodId === "cash") {
      if (customizationSettings.cod_blocking_feature_enabled !== false && userProfile?.isCodBlocked) return false
      
      // General COD toggle (Excludes Takeaway)
      if (orderType !== "takeaway") {
        if (customizationSettings.cod_enabled === false) return false
      }

      if (orderType === "takeaway") return customizationSettings.takeaway_cod_enabled !== false
      if (orderType === "delivery") return customizationSettings.delivery_cod_enabled !== false
      if (orderType === "dining") return customizationSettings.dining_cod_enabled !== false
      return true
    }
    return true
  }

  // Auto-switch payment method if current one becomes disabled
  useEffect(() => {
    if (!isPaymentMethodEnabled(selectedPaymentMethod)) {
      if (isPaymentMethodEnabled("cash")) {
        setSelectedPaymentMethod("cash")
      } else if (isPaymentMethodEnabled("razorpay")) {
        setSelectedPaymentMethod("razorpay")
      } else if (isPaymentMethodEnabled("wallet")) {
        setSelectedPaymentMethod("wallet")
      }
    }
  }, [orderType, customizationSettings, selectedPaymentMethod, userProfile])

  // Fetch latest user profile to ensure COD block status is up to date when entering Cart
  useEffect(() => {
    const checkLatestProfile = async () => {
      try {
        const res = await authAPI.getCurrentUser();
        const user = res?.data?.data?.user || res?.data?.user || res?.data;
        if (user && userProfile && user.isCodBlocked !== userProfile.isCodBlocked) {
           window.dispatchEvent(new Event("userAuthChanged"));
        }
      } catch (e) {
        console.error("Error checking latest profile", e);
      }
    };
    if (userProfile) checkLatestProfile();
  }, []);

  useEffect(() => {
    orderSuccessAudioRef.current = null;
  }, [])

  useEffect(() => {
    // No sound on order success
  }, [showOrderSuccess])

  // Auto-transition from savings congratulations to order success after 3 seconds
  useEffect(() => {
    if (!showSavingsCongrats) return
    const timer = setTimeout(() => {
      setShowSavingsCongrats(false)
      setShowOrderSuccess(true)
    }, 3000)
    return () => clearTimeout(timer)
  }, [showSavingsCongrats])

  // Cleanup savings data when showing order success
  useEffect(() => {
    if (showOrderSuccess) {
      setCongratssSavingsAmount(0)
      setCongratssSavingsPercentage(0)
      setCongratssSavingsItems([])
    }
  }, [showOrderSuccess])

  // Restaurant and pricing state
  const [restaurantData, setRestaurantData] = useState(null)
  const [loadingRestaurant, setLoadingRestaurant] = useState(false)
  const [pricing, setPricing] = useState(null)
  const [loadingPricing, setLoadingPricing] = useState(false)

  // Use backend pricing if available, otherwise fallback to item sums
  const subtotal = pricing?.subtotal || cart.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 1), 0)

  // Auto coupon popup state
  const hasShownPromoPopupRef = useRef({ delivery: false, takeaway: false, dining: false })
  const [showAutoCouponPopup, setShowAutoCouponPopup] = useState(false)
  const [bestCoupon, setBestCoupon] = useState(null)
  const bestCouponDiscount = useMemo(() => {
    if (!bestCoupon) return 0
    if (bestCoupon.discountType === "percentage") {
      const raw = subtotal * (Number(bestCoupon.discountPercentage || 0) / 100)
      return Math.round(Number(bestCoupon.maxDiscount) > 0 ? Math.min(raw, Number(bestCoupon.maxDiscount)) : raw)
    }
    return Math.round(Number(bestCoupon.originalPrice || 0))
  }, [bestCoupon, subtotal])

  // Addons state
  const [addons, setAddons] = useState([])
  const [loadingAddons, setLoadingAddons] = useState(false)

  // Coupons state - fetched from backend
  const [availableCoupons, setAvailableCoupons] = useState([])
  const [loadingCoupons, setLoadingCoupons] = useState(false)
  const [userOrderCount, setUserOrderCount] = useState(0)

  const filteredCoupons = useMemo(() => {
    const subtotal = pricing?.subtotal || cart.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 1), 0)
    const filtered = availableCoupons.filter((coupon) => {
      // Filter by order type constraints
      if (coupon.couponType && coupon.couponType !== "all" && coupon.couponType !== orderType) {
        return false
      }
      // Filter out first-time coupons if the user is not a first-time user
      const isFirstTimeOnly = coupon.customerGroup === "new" || coupon.customerGroup === "first-time"
      if (isFirstTimeOnly && userOrderCount > 0) {
        return false
      }
      return true
    })

    // Sort: Applicable coupons first, then by discount value descending based on current subtotal
    return filtered.sort((a, b) => {
      const isApplicableA = subtotal >= (Number(a.minOrder) || 0)
      const isApplicableB = subtotal >= (Number(b.minOrder) || 0)

      if (isApplicableA && !isApplicableB) return -1
      if (!isApplicableA && isApplicableB) return 1

      const discountA = a.discountType === "percentage"
        ? Math.min(subtotal * (Number(a.discountPercentage || 0) / 100), Number(a.maxDiscount) || Infinity)
        : Number(a.originalPrice || 0)
      const discountB = b.discountType === "percentage"
        ? Math.min(subtotal * (Number(b.discountPercentage || 0) / 100), Number(b.maxDiscount) || Infinity)
        : Number(b.originalPrice || 0)
      return discountB - discountA
    })
  }, [availableCoupons, orderType, cart, pricing, userOrderCount])

  // Lock body scroll when auto coupon popup or coupon sheet is open
  // Preload Razorpay SDK as soon as cart opens so the modal appears instantly
  useEffect(() => {
    preloadRazorpayScript()
  }, [])

  // Handle Razorpay redirect callback
  useEffect(() => {
    if (typeof window === "undefined") return;
    const searchParams = new URLSearchParams(window.location.search);
    const razorpay_payment_id = searchParams.get('razorpay_payment_id');
    const razorpay_order_id = searchParams.get('razorpay_order_id');
    const razorpay_signature = searchParams.get('razorpay_signature');
    const error_code = searchParams.get('error[code]');

    if (error_code) {
        toast.error("Payment failed: " + (searchParams.get('error[description]') || "Unknown error"));
        window.history.replaceState({}, '', window.location.pathname);
    } else if (razorpay_payment_id && razorpay_order_id && razorpay_signature) {
        const processRedirectPayment = async () => {
            const savedPayloadRaw = window.localStorage.getItem('pendingOrderPayload');
            if (savedPayloadRaw) {
                try {
                    setIsPlacingOrder(true);
                    const orderPayload = JSON.parse(savedPayloadRaw);
                    
                    const createOrderPayload = {
                      ...orderPayload,
                      razorpayOrderId: razorpay_order_id,
                      razorpayPaymentId: razorpay_payment_id,
                      razorpaySignature: razorpay_signature,
                    };

                    const createResponse = await orderAPI.createOrder(createOrderPayload);
                    if (createResponse.data?.success) {
                      const { order } = createResponse.data.data;
                      setPlacedOrderId(order._id || order.orderId);
                      setPlacedOrderObj(order);
                      setShowOrderSuccess(true);
                      window.dispatchEvent(new CustomEvent('order-placed', { detail: { order } }));
                      clearCart();
                      setRestaurantNote("");
                      setShowRestaurantNoteInput(false);
                      try { window.localStorage.removeItem(CART_ORDER_NOTE_STORAGE_KEY) } catch {}
                      window.localStorage.removeItem('pendingOrderPayload');
                      window.localStorage.removeItem('pendingOrderSavings');
                    }
                } catch (error) {
                    debugError("Order creation after redirect payment error:", error);
                    const errorMessage =
                      error?.response?.data?.message ||
                      error?.message ||
                      "Payment verified but order creation failed. Please contact support.";
                    alert(errorMessage);
                } finally {
                    setIsPlacingOrder(false);
                    window.history.replaceState({}, '', window.location.pathname);
                }
            }
        };
        processRedirectPayment();
    }
  }, []);

  useEffect(() => {
    if (showAutoCouponPopup || showCouponSheet) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [showAutoCouponPopup, showCouponSheet])

  const renderCartCouponCard = (coupon, { compact = false, blocked = false } = {}) => {
    const meetsMinOrder = subtotal >= (Number(coupon.minOrder) || 0)
    const isApplicable = !blocked && meetsMinOrder

    return (
      <div
        key={coupon.code}
        className={`bg-[#DC2626]/5 dark:bg-[#DC2626]/10 border border-[#DC2626]/10 dark:border-[#DC2626]/20 rounded-xl flex items-center justify-between gap-3 ${
          compact ? "p-3 shadow-[0_2px_8px_rgba(220,38,38,0.02)] hover:shadow-[0_4px_12px_rgba(220,38,38,0.05)] transition-all" : "p-3.5"
        } ${blocked ? "opacity-60 grayscale" : ""}`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-[#DC2626]/20 flex items-center justify-center flex-shrink-0">
            <Percent className="w-4 h-4 text-[#DC2626]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-block text-[10px] font-bold text-[#DC2626] uppercase tracking-wider bg-white dark:bg-gray-900 border border-dashed border-[#DC2626]/30 px-2 py-0.5 rounded shadow-sm">
                {coupon.code}
              </span>
              <span className="text-xs font-black text-gray-900 dark:text-gray-100">
                {coupon.discountDisplay || `Save ${RUPEE_SYMBOL}${coupon.discount}`}
              </span>
            </div>
            <p className={`text-[11px] font-medium text-gray-500 dark:text-gray-400 mt-1 ${compact ? "line-clamp-1" : "line-clamp-2"}`}>
              {coupon.description || "Save flat amount on your order"}
            </p>
            {blocked ? (
              <p className="text-[9px] font-semibold text-gray-400 dark:text-gray-500 mt-0.5">
                Not available for this delivery location
              </p>
            ) : !meetsMinOrder ? (
              <p className="text-[9px] font-semibold text-gray-400 dark:text-gray-500 mt-0.5">
                Add items worth {RUPEE_SYMBOL}{Math.max(0, (Number(coupon.minOrder) || 0) - subtotal).toFixed(0)} more to apply
              </p>
            ) : null}
          </div>
        </div>
        <button
          disabled={!isApplicable}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleApplyCoupon(coupon)
          }}
          className={`text-xs font-black px-4 py-1.5 rounded-lg shadow-sm active:scale-95 transition-all flex-shrink-0 uppercase tracking-wider ${
            isApplicable
              ? "text-[#DC2626] bg-white dark:bg-gray-900 border border-[#DC2626]/20 hover:bg-[#DC2626]/5"
              : "text-gray-400 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-800 cursor-not-allowed"
          }`}
        >
          Apply
        </button>
      </div>
    )
  }

  const handleApplyAutoCoupon = () => {
    if (bestCoupon) {
      handleApplyCoupon(bestCoupon)
      setShowAutoCouponPopup(false)
    }
  }

  // Fee settings from database (used for platform fee and GST fallback only)
  const [feeSettings, setFeeSettings] = useState({
    deliveryFee: 25,
    deliveryFeeRanges: [],
    freeDeliveryUpTo: 0,
    platformFee: 5,
    packagingFee: 0,
    gstRate: 5,
  })


  const availableTimeSlots = useMemo(() => {
    if (!isScheduled || !scheduledDate || !restaurantData) return []

    try {
      const targetDate = new Date(scheduledDate)
      const status = getRestaurantAvailabilityStatus(restaurantData, targetDate)

      let openingHour = 9
      let closingHour = 22

      if (status.openingTime) {
        const [h] = status.openingTime.split(':')
        openingHour = parseInt(h, 10)
      }

      if (status.closingTime) {
        const [h] = status.closingTime.split(':')
        closingHour = parseInt(h, 10)
      }

      if (closingHour < openingHour) {
        closingHour += 24 // Handle overnight slots
      }

      const slots = []
      const now = new Date()
      // Fix timezone date comparison by comparing date strings YYYY-MM-DD
      const nowStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0]
      const targetStr = scheduledDate
      const isToday = targetStr === nowStr
      const currentHour = now.getHours()

      for (let h = openingHour; h <= closingHour; h++) {
        const actualHour = h % 24
        // Skip past hours if today. Add 1 hour buffer so they can't order right at the boundary
        if (isToday && h <= currentHour) continue

        const period = actualHour >= 12 ? 'PM' : 'AM'
        const display12 = actualHour % 12 || 12
        const timeString = `${String(actualHour).padStart(2, '0')}:00`
        const displayString = `${display12}:00 ${period}`

        slots.push({ value: timeString, label: displayString })
      }

      return slots
    } catch {
      return []
    }
  }, [isScheduled, scheduledDate, restaurantData])

  // Reset scheduledTime if it's no longer valid in the new slots
  useEffect(() => {
    if (isScheduled && availableTimeSlots.length > 0) {
      const isValid = availableTimeSlots.some(slot => slot.value === scheduledTime)
      if (!isValid) {
        setScheduledTime(availableTimeSlots[0].value)
      }
    } else if (!isScheduled) {
      setScheduledDate("")
      setScheduledTime("")
    }
  }, [isScheduled, availableTimeSlots, scheduledTime])

  const cartCount = getCartCount()
  const getAddressId = (address) => address?.id || address?._id || null
  const normalizeAddressLabel = (label) => {
    if (!label) return ""
    const value = String(label).trim().toLowerCase()
    if (value === "work" || value === "office") return "office"
    if (value === "home") return "home"
    if (value === "other") return "other"
    return value
  }
  const getDisplayAddressLabel = (label) => {
    const normalized = normalizeAddressLabel(label)
    if (normalized === "office") return "Work"
    if (normalized === "home") return "Home"
    if (normalized === "other") return "Other"
    return label || "Saved address"
  }
  const sanitizeRecipientPhone = (value) => String(value || "").replace(/[^\d+]/g, "").slice(0, 14)
  const savedAddress = getDefaultAddress()
  const selectedAddress = addresses.find((addr) => getAddressId(addr) && getAddressId(addr) === selectedAddressId)

  const currentLocationAddress = useMemo(() => {
    // `LocationSelectorOverlay` updates backend + localStorage, but Cart's live hook might lag.
    // So we fall back to `localStorage.userLocation` when `currentLocation` doesn't have a usable payload yet.
    let locFromStorage = null
    try {
      const storedRaw = localStorage.getItem("userLocation")
      locFromStorage = storedRaw ? JSON.parse(storedRaw) : null
    } catch {
      locFromStorage = null
    }

    const loc = currentLocation?.latitude && currentLocation?.longitude ? currentLocation : locFromStorage
    if (!loc?.latitude || !loc?.longitude) return null

    const formattedAddress = loc?.formattedAddress || loc?.address || ""
    if (!formattedAddress || formattedAddress === "Select location") return null

    return {
      // Backend deliveryAddressSchema expects label in ['Home','Office','Other'].
      label: "Home",
      formattedAddress,
      address: formattedAddress,
      street: loc?.street || loc?.address || loc?.area || "Current Location",
      additionalDetails: loc?.area || "",
      city: loc?.city || loc?.area || "Current City",
      state: loc?.state || loc?.city || "Current State",
      zipCode: loc?.postalCode || loc?.zipCode || "",
      phone: userProfile?.phone || "",
      location: {
        type: "Point",
        coordinates: [loc.longitude, loc.latitude], // [lng, lat]
      },
    }
  }, [
    currentLocation?.latitude,
    currentLocation?.longitude,
    currentLocation?.formattedAddress,
    currentLocation?.address,
    currentLocation?.street,
    currentLocation?.area,
    currentLocation?.city,
    currentLocation?.state,
    currentLocation?.postalCode,
    currentLocation?.zipCode,
    userProfile?.phone,
    // Re-evaluate derived address when mode changes (overlay closes -> Cart rerenders).
    deliveryAddressMode,
  ])

  const defaultAddress = useMemo(() => {
    return deliveryAddressMode === "current"
      ? currentLocationAddress || selectedAddress || savedAddress || null
      : selectedAddress || savedAddress || currentLocationAddress || null
  }, [deliveryAddressMode, currentLocationAddress, selectedAddress, savedAddress])

  const hasSavedAddress = Boolean(defaultAddress && formatFullAddress(defaultAddress))
  const recipientName = String(recipientDetails.name || "").trim() || userProfile?.name || "Your Name"
  const recipientPhone = sanitizeRecipientPhone(recipientDetails.phone || "") || userProfile?.phone || ""
  const selectedAddressCoordinates = defaultAddress?.location?.coordinates
  const zoneLocation = selectedAddressCoordinates?.length === 2
    ? {
      latitude: selectedAddressCoordinates[1],
      longitude: selectedAddressCoordinates[0]
    }
    : currentLocation
  const { zoneId, zoneStatus } = useZone(zoneLocation) // Prefer selected/saved address zone
  const defaultPayment = getDefaultPaymentMethod()

  const isCartZoneMismatch = useMemo(() => {
    if (orderType !== "delivery" || !cart.length || !zoneId || zoneStatus === "loading") {
      return false
    }
    const restaurantZoneId = cart[0]?.restaurantZoneId || restaurantData?.zoneId
    if (!restaurantZoneId) return false
    return String(restaurantZoneId).trim() !== String(zoneId).trim()
  }, [orderType, cart, zoneId, zoneStatus, restaurantData?.zoneId])

  useEffect(() => {
    // Sync delivery mode from overlay/localStorage changes.
    // No dependency array: overlay open/close re-renders Cart via provider state update,
    // even when GPS coords don't move enough to update `currentLocation`.
    try {
      const mode = localStorage.getItem("deliveryAddressMode") || "saved"
      setDeliveryAddressMode((prev) => (prev === mode ? prev : mode))
    } catch {
      // ignore
    }
  })

  useEffect(() => {
    if (typeof window === "undefined") return

    try {
      const raw = window.localStorage.getItem(CART_RECIPIENT_DETAILS_STORAGE_KEY)
      if (!raw) {
        hasRestoredRecipientRef.current = true
        return
      }

      const stored = JSON.parse(raw)
      setRecipientDetails({
        name: stored?.name || "",
        phone: sanitizeRecipientPhone(stored?.phone || ""),
      })
      setIsEditingRecipient(Boolean(stored?.isEditingRecipient))
    } catch {
      setRecipientDetails({ name: "", phone: "" })
      setIsEditingRecipient(false)
    } finally {
      hasRestoredRecipientRef.current = true
    }
  }, [])

  useEffect(() => {
    setRecipientDetails((prev) => ({
      name: prev.name || userProfile?.name || "",
      phone: prev.phone || userProfile?.phone || "",
    }))
  }, [userProfile?.name, userProfile?.phone])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!hasRestoredRecipientRef.current) return

    try {
      window.localStorage.setItem(
        CART_RECIPIENT_DETAILS_STORAGE_KEY,
        JSON.stringify({
          name: recipientDetails.name || "",
          phone: sanitizeRecipientPhone(recipientDetails.phone || ""),
          isEditingRecipient,
        })
      )
    } catch {
      // Ignore storage errors and keep cart flow working.
    }
  }, [recipientDetails, isEditingRecipient])

  useEffect(() => {
    hasRestoredNoteRef.current = true
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!hasRestoredNoteRef.current) return

    try {
      window.localStorage.setItem(
        CART_ORDER_NOTE_STORAGE_KEY,
        JSON.stringify({
          restaurantNote,
          showRestaurantNoteInput,
        })
      )
    } catch {
      // Ignore storage errors and keep note flow working.
    }
  }, [restaurantNote, showRestaurantNoteInput])

  useEffect(() => {
    if (deliveryAddressMode === "current") {
      setSelectedAddressId(null)
    }
  }, [deliveryAddressMode])

  useEffect(() => {
    const defaultId = getAddressId(savedAddress)
    if (deliveryAddressMode !== "current" && !selectedAddressId && defaultId) {
      setSelectedAddressId(defaultId)
    }
  }, [savedAddress, selectedAddressId, deliveryAddressMode])

  // Get restaurant ID from cart or restaurant data
  // Priority: restaurantData > cart[0].restaurantId
  // DO NOT use cart[0].restaurant as slug fallback - it creates wrong slugs
  const restaurantId = cart.length > 0
    ? (restaurantData?._id || restaurantData?.restaurantId || cart[0]?.restaurantId || null)
    : null

  // Stable restaurant ID for addons fetch (memoized to prevent dependency array issues)
  // Prefer restaurantData IDs (more reliable) over slug from cart
  const restaurantIdForAddons = useMemo(() => {
    // Only use restaurantData if it's loaded, otherwise wait
    if (restaurantData) {
      return restaurantData._id || restaurantData.restaurantId || null
    }
    // If restaurantData is not loaded yet, return null to wait
    return null
  }, [restaurantData])



  // Lock body scroll and scroll to top when any full-screen modal opens
  useEffect(() => {
    if (showPlacingOrder || showOrderSuccess || showSavingsCongrats) {
      // Lock body scroll
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.width = '100%'
      document.body.style.top = `-${window.scrollY}px`

      // Scroll window to top
      window.scrollTo({ top: 0, behavior: 'instant' })
    } else {
      // Restore body scroll
      const scrollY = document.body.style.top
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.width = ''
      document.body.style.top = ''
      if (scrollY) {
        window.scrollTo(0, parseInt(scrollY || '0') * -1)
      }
    }

    return () => {
      // Cleanup on unmount
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.width = ''
      document.body.style.top = ''
    }
  }, [showPlacingOrder, showOrderSuccess, showSavingsCongrats])

  // Fetch restaurant data when cart has items
  useEffect(() => {
    const fetchRestaurantData = async () => {
      if (cart.length === 0) {
        if (!showOrderSuccess && !showPlacingOrder && !showSavingsCongrats) {
          setRestaurantData(null)
        }
        return
      }

      // If we already have restaurantData, don't fetch again
      if (restaurantData) {
        return
      }

      setLoadingRestaurant(true)

      // Strategy 1: Try using restaurantId from cart if available
      if (cart[0]?.restaurantId) {
        try {
          const cartRestaurantId = cart[0].restaurantId;
          const cartRestaurantName = cart[0].restaurant;

          debugLog("?? Fetching restaurant data by restaurantId from cart:", cartRestaurantId)
          const response = await restaurantAPI.getRestaurantById(cartRestaurantId)
          const data = response?.data?.data?.restaurant || response?.data?.restaurant

          if (data) {
            // CRITICAL: Validate that fetched restaurant matches cart items
            const fetchedRestaurantId = data.restaurantId || data._id?.toString();
            const fetchedRestaurantName = data.name;

            // Check if restaurantId matches
            const restaurantIdMatches =
              fetchedRestaurantId === cartRestaurantId ||
              data._id?.toString() === cartRestaurantId ||
              data.restaurantId === cartRestaurantId;

            // Check if restaurant name matches (if available in cart)
            const restaurantNameMatches =
              !cartRestaurantName ||
              fetchedRestaurantName?.toLowerCase().trim() === cartRestaurantName.toLowerCase().trim();

            if (!restaurantIdMatches) {
              debugError('? CRITICAL: Fetched restaurant ID does not match cart restaurantId!', {
                cartRestaurantId: cartRestaurantId,
                fetchedRestaurantId: fetchedRestaurantId,
                fetched_id: data._id?.toString(),
                fetched_restaurantId: data.restaurantId,
                cartRestaurantName: cartRestaurantName,
                fetchedRestaurantName: fetchedRestaurantName
              });
              // Don't set restaurantData if IDs don't match - this prevents wrong restaurant assignment
              setLoadingRestaurant(false);
              return;
            }

            if (!restaurantNameMatches) {
              debugWarn('?? WARNING: Restaurant name mismatch:', {
                cartRestaurantName: cartRestaurantName,
                fetchedRestaurantName: fetchedRestaurantName
              });
              // Still proceed but log warning
            }

            debugLog("? Restaurant data loaded from cart restaurantId:", {
              _id: data._id,
              restaurantId: data.restaurantId,
              name: data.name,
              cartRestaurantId: cartRestaurantId,
              cartRestaurantName: cartRestaurantName
            })
            setRestaurantData(data)
            setLoadingRestaurant(false)
            return
          }
        } catch (error) {
          debugWarn("?? Failed to fetch by cart restaurantId, trying fallback...", error)
        }
      }

      // Strategy 2: If no restaurantId in cart, search by restaurant name
      if (cart[0]?.restaurant && !restaurantData) {
        try {
          debugLog("?? Searching restaurant by name:", cart[0].restaurant)
          const searchResponse = await restaurantAPI.getRestaurants({ limit: 100 })
          const restaurants = searchResponse?.data?.data?.restaurants || searchResponse?.data?.data || []
          debugLog("?? Fetched", restaurants.length, "restaurants for name search")

          // Try exact match first
          let matchingRestaurant = restaurants.find(r =>
            r.name?.toLowerCase().trim() === cart[0].restaurant?.toLowerCase().trim()
          )

          // If no exact match, try partial match
          if (!matchingRestaurant) {
            debugLog("?? No exact match, trying partial match...")
            matchingRestaurant = restaurants.find(r =>
              r.name?.toLowerCase().includes(cart[0].restaurant?.toLowerCase().trim()) ||
              cart[0].restaurant?.toLowerCase().trim().includes(r.name?.toLowerCase())
            )
          }

          if (matchingRestaurant) {
            // CRITICAL: Validate that the found restaurant matches cart items
            const cartRestaurantName = cart[0]?.restaurant?.toLowerCase().trim();
            const foundRestaurantName = matchingRestaurant.name?.toLowerCase().trim();

            if (cartRestaurantName && foundRestaurantName && cartRestaurantName !== foundRestaurantName) {
              debugError("? CRITICAL: Restaurant name mismatch!", {
                cartRestaurantName: cart[0]?.restaurant,
                foundRestaurantName: matchingRestaurant.name,
                cartRestaurantId: cart[0]?.restaurantId,
                foundRestaurantId: matchingRestaurant.restaurantId || matchingRestaurant._id
              });
              // Don't set restaurantData if names don't match - this prevents wrong restaurant assignment
              setLoadingRestaurant(false);
              return;
            }

            debugLog("? Found restaurant by name:", {
              name: matchingRestaurant.name,
              _id: matchingRestaurant._id,
              restaurantId: matchingRestaurant.restaurantId,
              slug: matchingRestaurant.slug,
              cartRestaurantName: cart[0]?.restaurant
            })
            setRestaurantData(matchingRestaurant)
            setLoadingRestaurant(false)
            return
          } else {
            debugWarn("?? Restaurant not found even by name search. Searched in", restaurants.length, "restaurants")
            if (restaurants.length > 0) {
              debugLog("?? Available restaurant names:", restaurants.map(r => r.name).slice(0, 10))
            }
          }
        } catch (searchError) {
          debugWarn("?? Error searching restaurants by name:", searchError)
        }
      }

      // If all strategies fail, set to null
      setRestaurantData(null)
      setLoadingRestaurant(false)
    }

    fetchRestaurantData()
  }, [cart.length, cart[0]?.restaurantId, cart[0]?.restaurant, showOrderSuccess, showPlacingOrder, showSavingsCongrats])

  // Fetch approved addons for the restaurant
  useEffect(() => {
    const fetchAddonsWithId = async (idToUse) => {

      debugLog("?? Addons fetch - Using ID:", {
        restaurantData: restaurantData ? {
          _id: restaurantData._id,
          restaurantId: restaurantData.restaurantId,
          name: restaurantData.name
        } : 'Not loaded',
        cartRestaurantId: restaurantId,
        idToUse: idToUse
      })

      // Convert to string for validation
      const idString = String(idToUse)
      debugLog("?? Restaurant ID string:", idString, "Type:", typeof idString, "Length:", idString.length)

      // Validate ID format (should be ObjectId or restaurantId format)
      const isValidIdFormat = /^[a-zA-Z0-9\-_]+$/.test(idString) && idString.length >= 3

      if (!isValidIdFormat) {
        debugWarn("?? Restaurant ID format invalid:", idString)
        setAddons([])
        return
      }

      try {
        setLoadingAddons(true)
        debugLog("?? Fetching addons for restaurant ID:", idString)
        const response = await restaurantAPI.getAddonsByRestaurantId(idString)
        debugLog("? Addons API response received:", response?.data)
        debugLog("?? Response structure:", {
          success: response?.data?.success,
          data: response?.data?.data,
          addons: response?.data?.data?.addons,
          directAddons: response?.data?.addons
        })

        const data = response?.data?.data?.addons || response?.data?.addons || []
        debugLog("?? Fetched addons count:", data.length)
        debugLog("?? Fetched addons data:", JSON.stringify(data, null, 2))

        if (data.length === 0) {
          debugWarn("?? No addons returned from API. Response:", response?.data)
        } else {
          debugLog("? Successfully fetched", data.length, "addons:", data.map(a => a.name))
        }

        setAddons(data)
      } catch (error) {
        // Log error for debugging
        debugError("? Addons fetch error:", {
          code: error.code,
          status: error.response?.status,
          message: error.message,
          url: error.config?.url,
          data: error.response?.data
        })
        // Silently handle network errors and 404 errors
        // Network errors (ERR_NETWORK) happen when backend is not running - this is OK for development
        // 404 errors mean restaurant might not have addons or restaurant not found - also OK
        if (error.code !== 'ERR_NETWORK' && error.response?.status !== 404) {
          debugError("Error fetching addons:", error)
        }
        // Continue with cart even if addons fetch fails
        setAddons([])
      } finally {
        setLoadingAddons(false)
      }
    }

    const fetchAddons = async () => {
      if (cart.length === 0) {
        setAddons([])
        return
      }

      // Wait for restaurantData to be loaded (including fallback search)
      if (loadingRestaurant) {
        debugLog("? Waiting for restaurantData to load (including fallback search)...")
        return
      }

      // Must have restaurantData to fetch addons
      if (!restaurantData) {
        debugWarn("?? No restaurantData available for addons fetch")
        setAddons([])
        return
      }

      // Use restaurantData ID (most reliable)
      const idToUse = restaurantData._id || restaurantData.restaurantId
      if (!idToUse) {
        debugWarn("?? No valid restaurant ID in restaurantData")
        setAddons([])
        return
      }

      debugLog("? Using restaurantData ID for addons:", idToUse)
      fetchAddonsWithId(idToUse)
    }

    fetchAddons()
  }, [restaurantData, cart.length, loadingRestaurant])

  // Fetch restaurant-level coupons once (same source as restaurant details page)
  useEffect(() => {
    const fetchCouponsForCart = async () => {
      if (cart.length === 0) {
        setAvailableCoupons([])
        return
      }

      const resolvedRestaurantId =
        restaurantData?._id ||
        restaurantData?.restaurantId ||
        cart[0]?.restaurantId ||
        null

      setLoadingCoupons(true)

      try {
        const response = await restaurantAPI.getPublicOffers()
        const list = response?.data?.data?.allOffers || response?.data?.allOffers || []
        const filteredOffers = filterPublicOffers(list, {
          restaurantId: resolvedRestaurantId,
          restaurantSlug: restaurantData?.slug || restaurantData?.restaurantNameNormalized,
          restaurant: restaurantData,
          orderType,
          requireShowInCart: true,
        })

        const coupons = filteredOffers.map((offer) => mapPublicOfferToCartCoupon(offer, RUPEE_SYMBOL))
        debugLog(`[CART-COUPONS] Loaded ${coupons.length} coupons for restaurant`, {
          resolvedRestaurantId,
          orderType,
        })
        setAvailableCoupons(coupons)
      } catch (error) {
        debugError("[CART-COUPONS] Error fetching coupons:", error)
        setAvailableCoupons([])
      } finally {
        setLoadingCoupons(false)
      }
    }

    fetchCouponsForCart()
  }, [cart, restaurantData, orderType])

  // Calculate pricing from backend whenever cart, address, or coupon changes
  useEffect(() => {
    const calculatePricing = async () => {
      const resolvedRestaurantId = restaurantData?.restaurantId || restaurantData?._id || cart[0]?.restaurantId || undefined
      
      // For takeaway, we don't need a delivery address to calculate pricing, but we MUST have a restaurantId
      const canCalculate = cart.length > 0 && resolvedRestaurantId && (orderType === "takeaway" || hasSavedAddress)
      
      if (!canCalculate) {
        setPricing(null)
        return
      }

      try {
        setLoadingPricing(true)
        const items = cart.map(item => ({
          itemId: item.itemId || item.id,
          name: item.name,
          price: item.price, // Price should already be in INR
          variantId: item.variantId || undefined,
          variantName: item.variantName || undefined,
          variantPrice: item.variantPrice || item.price,
          quantity: item.quantity || 1,
          image: item.image,
          description: item.description,
          isVeg: item.isVeg !== false
        }))

        const resolvedRestaurantId = restaurantData?.restaurantId || restaurantData?._id || cart[0]?.restaurantId || undefined
        const resolvedCouponCode = appliedCoupon?.code || couponCode || undefined

        const requestBody = {
          useCart: true,
          items: [],
          restaurantId: resolvedRestaurantId,
          deliveryAddress: orderType === "takeaway" ? undefined : (defaultAddress || undefined),
          couponCode: resolvedCouponCode,
          orderType: orderType,
          zoneId: zoneId || undefined,
        }
        
        debugLog("Recalculating pricing with body:", requestBody)

        const response = await orderAPI.calculateOrder(requestBody)

        if (response?.data?.success && response?.data?.data?.pricing) {
          setPricing(response.data.data.pricing)

          const backendApplied = response.data.data.pricing.appliedCoupon
          if (backendApplied) {
            if (!appliedCoupon || appliedCoupon.code !== backendApplied.code) {
              const coupon = availableCoupons.find(c => c.code === backendApplied.code)
              if (coupon) {
                setAppliedCoupon(coupon)
              } else {
                setAppliedCoupon({
                  code: backendApplied.code,
                  discount: backendApplied.discount || 0,
                  minOrder: 0,
                  customerGroup: "all",
                  couponType: "all",
                })
              }
            }
          } else {
            if (appliedCoupon) {
              setAppliedCoupon(null)
              setCouponCode("")
              setManualCouponCode("")
              toast.error("Applied coupon is not valid for this order type")
            }
          }
        }
      } catch (error) {
        // Network errors or 404 errors - silently handle, fallback to frontend calculation
        if (error.code !== 'ERR_NETWORK' && error.response?.status !== 404) {
          debugError("Error calculating pricing:", error)
        }
        // Fallback to frontend calculation if backend fails
        setPricing(null)
      } finally {
        setLoadingPricing(false)
      }
    }

    calculatePricing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, defaultAddress, restaurantId, orderType, zoneId])

  // Fetch wallet balance
  useEffect(() => {
    const fetchWalletBalance = async () => {
      try {
        setIsLoadingWallet(true)
        const response = await userAPI.getWallet()
        if (response?.data?.success && response?.data?.data?.wallet) {
          setWalletBalance(response.data.data.wallet.balance || 0)
        }
      } catch (error) {
        debugError("Error fetching wallet balance:", error)
        setWalletBalance(0)
      } finally {
        setIsLoadingWallet(false)
      }
    }
    fetchWalletBalance()
  }, [])

  // Fetch user order count (used for first-time coupon eligibility)
  useEffect(() => {
    const fetchOrderCount = async () => {
      try {
        const response = await userAPI.getOrders({ page: 1, limit: 1 })
        if (response?.data?.success) {
          const totalOrders = response?.data?.data?.pagination?.total || 0
          setUserOrderCount(totalOrders)
        }
      } catch (error) {
        debugError("Error fetching user order count:", error)
        setUserOrderCount(0)
      }
    }

    fetchOrderCount()
  }, [])

  // Fetch fee settings on mount
  useEffect(() => {
    const fetchFeeSettings = async () => {
      try {
        const response = await adminAPI.getPublicFeeSettings()
        if (response.data.success && response.data.data.feeSettings) {
          setFeeSettings({
            deliveryFee: response.data.data.feeSettings.deliveryFee ?? 25,
            deliveryFeeRanges: response.data.data.feeSettings.deliveryFeeRanges ?? [],
            freeDeliveryUpTo: response.data.data.feeSettings.freeDeliveryUpTo ?? 0,
            platformFee: response.data.data.feeSettings.platformFee ?? 5,
            packagingFee: response.data.data.feeSettings.packagingFee ?? 0,
            gstRate: response.data.data.feeSettings.gstRate ?? 5,
          })
        }
      } catch (error) {
        debugError('Error fetching fee settings:', error)
        // Keep default values on error
      }
    }

    const handleFocus = () => {
      fetchFeeSettings()
    }

    fetchFeeSettings()
    window.addEventListener("focus", handleFocus)
    const intervalId = setInterval(fetchFeeSettings, 30000)

    return () => {
      window.removeEventListener("focus", handleFocus)
      clearInterval(intervalId)
    }
  }, [])

  // Use backend pricing if available, otherwise fallback to database fee settings
  // subtotal is declared at the top of the component
  const fallbackDeliveryFee = (() => {
    if (appliedCoupon?.freeDelivery) {
      return 0
    }

    const freeUpTo = Number(feeSettings.freeDeliveryUpTo || 0)
    if (Number.isFinite(freeUpTo) && freeUpTo > 0 && subtotal >= freeUpTo) {
      return 0
    }

    const distanceKm = (() => {
      const rCoords = restaurantData?.location?.coordinates
      const dCoords = defaultAddress?.location?.coordinates
      if (!Array.isArray(rCoords) || !Array.isArray(dCoords)) return null
      if (rCoords.length !== 2 || dCoords.length !== 2) return null
      const [rLng, rLat] = rCoords
      const [dLng, dLat] = dCoords
      return calculateDistance(rLat, rLng, dLat, dLng)
    })()

    const ranges = Array.isArray(feeSettings.deliveryFeeRanges) ? [...feeSettings.deliveryFeeRanges] : []
    if (ranges.length > 0 && Number.isFinite(distanceKm)) {
      const sortedRanges = ranges.sort((a, b) => Number(a.min) - Number(b.min))
      for (let i = 0; i < sortedRanges.length; i += 1) {
        const range = sortedRanges[i]
        const min = Number(range.min)
        const max = Number(range.max)
        const fee = Number(range.fee)
        const isLastRange = i === sortedRanges.length - 1
        const inRange = isLastRange
          ? distanceKm >= min && distanceKm <= max
          : distanceKm >= min && distanceKm < max

        if (inRange) return fee
      }

      return Number(feeSettings.deliveryFee || 0)
    }

    return Number(feeSettings.deliveryFee || 0)
  })()
  const deliveryFee = pricing != null ? (pricing.deliveryFee ?? 0) : fallbackDeliveryFee
  const deliveryFeeBreakdown = pricing?.deliveryFeeBreakdown || null
  const hasDistanceDeliveryBreakdown =
    deliveryFeeBreakdown?.source === "distance" &&
    Number.isFinite(Number(deliveryFeeBreakdown?.distanceKm))
  const deliveryFeeBreakdownText = hasDistanceDeliveryBreakdown
    ? `Distance ${Number(deliveryFeeBreakdown.distanceKm).toFixed(1)} km`
    : null
  const platformFee = pricing != null ? (pricing.platformFee ?? 0) : (feeSettings.platformFee ?? 0)
  const packagingFee = pricing != null ? (pricing.packagingFee ?? 0) : (feeSettings.packagingFee ?? 0)
  const gstCharges = pricing != null ? (pricing.tax ?? 0) : Math.round(subtotal * ((feeSettings.gstRate ?? 0) / 100))
  const discount = pricing?.discount || (appliedCoupon ? Math.min(appliedCoupon.discount, subtotal * 0.5) : 0)
  const totalBeforeDiscount = subtotal + deliveryFee + platformFee + packagingFee + gstCharges
  const total = pricing?.total || (totalBeforeDiscount - discount)
  const savings = pricing?.savings ?? Math.max(0, totalBeforeDiscount - total)
  
  // Platform compare-at savings removed — admin markup is charged via price/markupAmount.
  const platformPricingSavings = useMemo(() => {
    return {
      hasPlatformPricing: false,
      totalPlatformPrice: 0,
      totalPlatformGst: 0,
      totalPlatformPriceWithGst: 0,
      totalFoodelloPrice: 0,
      totalSavings: 0,
      savingsPercentage: 0,
      comparison: [],
      items: [],
    }
  }, [])
  const selectedPaymentLabel =
    selectedPaymentMethod === "wallet"
      ? "Wallet"
      : selectedPaymentMethod === "razorpay"
        ? "Online Payment"
        : "Cash on Delivery"

  // Restaurant name from data or cart
  const restaurantName = restaurantData?.name || cart[0]?.restaurant || "Restaurant"

  const availability = useMemo(() => {
    if (!restaurantData) return { isOpen: true }
    return getRestaurantAvailabilityStatus(restaurantData)
  }, [restaurantData])

  const isRestaurantClosed = !availability.isOpen
  const isCartUnavailable = isRestaurantClosed || isCartZoneMismatch

  // Trigger auto-coupon popup only when cart is orderable for this location
  useEffect(() => {
    if (cart.length === 0) {
      hasShownPromoPopupRef.current = { delivery: false, takeaway: false, dining: false }
      return
    }

    if (isCartUnavailable) {
      setShowAutoCouponPopup(false)
      setShowCouponSheet(false)
      return
    }

    const currentOrderType = orderType || "delivery"

    if (
      cart.length > 0 &&
      filteredCoupons.length > 0 &&
      !appliedCoupon &&
      !couponCode &&
      !hasShownPromoPopupRef.current[currentOrderType] &&
      !loadingCoupons
    ) {
      const topCoupon = filteredCoupons[0]
      const discountAmount = topCoupon.discountType === "percentage"
        ? Math.min(subtotal * (Number(topCoupon.discountPercentage || 0) / 100), Number(topCoupon.maxDiscount) || Infinity)
        : Number(topCoupon.originalPrice || 0)
      const isApplicable = subtotal >= (Number(topCoupon.minOrder) || 0) && discountAmount > 0

      if (isApplicable) {
        setBestCoupon(topCoupon)
        setShowAutoCouponPopup(true)
        hasShownPromoPopupRef.current[currentOrderType] = true
      }
    }
  }, [filteredCoupons, appliedCoupon, loadingCoupons, subtotal, cart.length, orderType, isCartUnavailable, couponCode])

  const handleShare = async () => {
    const restaurantNameStr = restaurantName || companyName || "this restaurant"
    const shareUrl = window.location.href
    const shareText = `Check out what I'm ordering from ${restaurantNameStr}! ${shareUrl}`

    const payload = {
      title: `My Cart at ${restaurantNameStr}`,
      text: shareText,
      url: shareUrl,
    }

    if (isMobileDevice()) {
      openShareModal(payload)
      return
    }

    const shared = await tryNativeShare(payload)
    if (shared) {
      toast.success("Link shared successfully")
      return
    }

    openShareModal(payload)
  }

  const openShareModal = (payload) => {
    setSharePayload(payload)
    setShowShareModal(true)
  }

  const tryNativeShare = async (payload) => {
    if (typeof navigator === "undefined" || !navigator.share) return false
    try {
      await navigator.share(payload)
      return true
    } catch (error) {
      if (error?.name === "AbortError") return true
      return false
    }
  }

  const isMobileDevice = () => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false
    const mobileUA = /Android|iPhone|iPad|iPod|Windows Phone|Opera Mini|IEMobile/i.test(navigator.userAgent)
    const smallViewport = window.matchMedia?.("(max-width: 768px)")?.matches
    return Boolean(mobileUA || smallViewport)
  }

  const openShareTarget = (target) => {
    if (!sharePayload?.url) return

    const text = sharePayload.text || ""
    const url = sharePayload.url
    const encodedText = encodeURIComponent(text)
    const encodedUrl = encodeURIComponent(url)

    let shareLink = ""

    if (target === "whatsapp") {
      shareLink = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`
    } else if (target === "telegram") {
      shareLink = `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`
    } else if (target === "email") {
      shareLink = `mailto:?subject=${encodeURIComponent(sharePayload.title || "Check this out")}&body=${encodeURIComponent(`${text}\n\n${url}`)}`
    }

    if (shareLink) {
      window.open(shareLink, "_blank", "noopener,noreferrer")
      setShowShareModal(false)
    }
  }

  const copyShareLink = async () => {
    if (!sharePayload?.url) return
    await copyToClipboard(sharePayload.url)
    setShowShareModal(false)
  }

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Link copied to clipboard!")
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement("textarea")
      textArea.value = text
      textArea.style.position = "fixed"
      textArea.style.opacity = "0"
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand("copy")
        toast.success("Link copied to clipboard!")
      } catch (err) {
        toast.error("Failed to copy link")
      }
      if (document.body.contains(textArea)) {
        document.body.removeChild(textArea)
      }
    }
  }

  const handleSystemShareFromModal = async () => {
    if (!sharePayload) return
    const shared = await tryNativeShare(sharePayload)
    if (shared) {
      setShowShareModal(false)
      toast.success("Shared successfully")
    }
  }

  const handleBack = () => {
    goBack()
  }

  // Handler to select address by label (Home, Office, Other)
  const handleSelectAddressByLabel = async (label) => {
    try {
      // Find address with matching label
      const targetLabel = normalizeAddressLabel(label)
      const address = addresses.find(addr => normalizeAddressLabel(addr.label) === targetLabel)

      if (!address) {
        toast.error(`No ${label} address found. Please add an address first.`)
        return
      }

      await handleSelectSavedAddress(address)
    } catch (error) {
      debugError(`Error selecting ${label} address:`, error)
      toast.error(`Failed to select ${label} address. Please try again.`)
    }
  }

  const handleSelectSavedAddress = async (address) => {
    try {
      const addressId = getAddressId(address)
      if (addressId) {
        setSelectedAddressId(addressId)
        setDefaultAddress(addressId)
      }

      // Get coordinates from address location
      const coordinates = address.location?.coordinates || []
      const longitude = coordinates[0]
      const latitude = coordinates[1]

      if (!latitude || !longitude) {
        toast.error(`Invalid coordinates for ${address.label || "saved"} address`)
        return
      }

      // Update location in backend
      await userAPI.updateLocation({
        latitude,
        longitude,
        address: `${address.street}, ${address.city}`,
        city: address.city,
        state: address.state,
        area: address.additionalDetails || "",
        formattedAddress: address.additionalDetails
          ? `${address.additionalDetails}, ${address.street}, ${address.city}, ${address.state}${address.zipCode ? ` ${address.zipCode}` : ''}`
          : `${address.street}, ${address.city}, ${address.state}${address.zipCode ? ` ${address.zipCode}` : ''}`
      })

      // Update the location in localStorage
      const locationData = {
        city: address.city,
        state: address.state,
        address: `${address.street}, ${address.city}`,
        area: address.additionalDetails || "",
        zipCode: address.zipCode,
        latitude,
        longitude,
        formattedAddress: address.additionalDetails
          ? `${address.additionalDetails}, ${address.street}, ${address.city}, ${address.state}${address.zipCode ? ` ${address.zipCode}` : ''}`
          : `${address.street}, ${address.city}, ${address.state}${address.zipCode ? ` ${address.zipCode}` : ''}`
      }
      localStorage.setItem("userLocation", JSON.stringify(locationData))
      try {
        window.dispatchEvent(new CustomEvent("userLocationUpdated"))
      } catch (evtErr) {
        debugWarn("Failed to dispatch custom event:", evtErr)
      }
      // User selected a saved address from Cart; prefer saved mode.
      try {
        localStorage.setItem("deliveryAddressMode", "saved")
        setDeliveryAddressMode("saved")
      } catch { }

      toast.success(`${address.label || "Saved"} address selected!`)
    } catch (error) {
      debugError("Error selecting saved address:", error)
      toast.error("Failed to select address. Please try again.")
    }
  }

  const handleApplyCoupon = async (coupon) => {
    if (isCartZoneMismatch) {
      toast.error("This restaurant does not deliver to your selected location")
      return
    }
    if (isRestaurantClosed) {
      toast.error("Restaurant is closed. Coupons cannot be applied right now.")
      return
    }

    const isFirstTimeOnly = coupon?.customerGroup === "new" || coupon?.customerGroup === "first-time"
    if (isFirstTimeOnly && userOrderCount > 0) {
      toast.error("This coupon is only for first-time users")
      return
    }

    if (subtotal < (Number(coupon.minOrder) || 0)) {
      toast.error(`Min order ${RUPEE_SYMBOL}${Number(coupon.minOrder || 0)}`)
      return
    }

    if (coupon?.couponType && coupon.couponType !== "all" && coupon.couponType !== orderType) {
      toast.error(`This coupon is only valid for ${coupon.couponType} orders`)
      return
    }

    // Save previous state for rollback
    const prevAppliedCoupon = appliedCoupon
    const prevCouponCode = couponCode
    const prevManualCouponCode = manualCouponCode

    // Optimistically update states & close sheet instantly
    setAppliedCoupon(coupon)
    setCouponCode(coupon.code)
    setManualCouponCode(coupon.code)
    setShowCouponSheet(false)

    // Validate with backend first; only set applied if backend accepts
    if (cart.length > 0 && (orderType === "takeaway" || hasSavedAddress)) {
      try {
        const items = cart.map(item => ({
          itemId: item.itemId || item.id,
          name: item.name,
          price: item.price,
          variantId: item.variantId || item.variant?._id || item.variant?.id || undefined,
          variantName: item.variantName || (typeof item.variant === 'string' ? item.variant : item.variant?.name) || (typeof item.selectedVariant === 'string' ? item.selectedVariant : item.selectedVariant?.name) || undefined,
          variantPrice: item.variantPrice || item.price,
          quantity: item.quantity || 1,
          image: item.image,
          description: item.description,
          isVeg: item.isVeg !== false
        }))

        const response = await orderAPI.calculateOrder({
          useCart: true,
          items: [],
          restaurantId: restaurantData?.restaurantId || restaurantData?._id || restaurantId || null,
          deliveryAddress: orderType === "takeaway" ? undefined : defaultAddress,
          couponCode: coupon.code,
          orderType: orderType,
          zoneId: zoneId || undefined
        })

        const pricingData = response?.data?.data?.pricing
        if (!pricingData || !pricingData.appliedCoupon) {
          throw new Error("Coupon not applicable")
        }

        setPricing(pricingData)
        toast.success("Coupon applied")
      } catch (error) {
        debugError("Error recalculating pricing:", error)
        // Rollback states
        setAppliedCoupon(prevAppliedCoupon)
        setCouponCode(prevCouponCode)
        setManualCouponCode(prevManualCouponCode)
        toast.error(error?.response?.data?.error || error?.message || "Failed to apply coupon")
      }
    }
  }

  const handleApplyCouponCode = async () => {
    const inputCode = manualCouponCode.trim().toUpperCase()
    if (!inputCode) {
      toast.error("Enter coupon code")
      return
    }

    if (isCartZoneMismatch) {
      toast.error("This restaurant does not deliver to your selected location")
      return
    }
    if (isRestaurantClosed) {
      toast.error("Restaurant is closed. Coupons cannot be applied right now.")
      return
    }

    if (cart.length === 0 || (orderType !== "takeaway" && !hasSavedAddress)) {
      toast.error(orderType === "takeaway" ? "Add items first" : "Add items and delivery address first")
      return
    }

    const matchedCoupon = availableCoupons.find(
      (coupon) => String(coupon.code || "").toUpperCase() === inputCode,
    )

    // If we know this is first-time only and user already ordered, block early.
    const isFirstTimeOnly = matchedCoupon?.customerGroup === "new" || matchedCoupon?.customerGroup === "first-time"
    if (isFirstTimeOnly && userOrderCount > 0) {
      toast.error("This coupon is only for first-time users")
      return
    }

    if (matchedCoupon && matchedCoupon.couponType && matchedCoupon.couponType !== "all" && matchedCoupon.couponType !== orderType) {
      toast.error(`This coupon is only valid for ${matchedCoupon.couponType} orders`)
      return
    }

    // Save previous state for rollback
    const prevAppliedCoupon = appliedCoupon
    const prevCouponCode = couponCode
    const prevManualCouponCode = manualCouponCode

    // Optimistically update states & close sheet instantly
    setCouponCode(inputCode)
    setManualCouponCode(inputCode)
    setAppliedCoupon(
      matchedCoupon || {
        code: inputCode,
        discount: 0,
        minOrder: 0,
        customerGroup: "all",
        couponType: "all",
      },
    )
    setShowCouponSheet(false)

    try {
      const items = cart.map(item => ({
        itemId: item.itemId || item.id,
        name: item.name,
        price: item.price,
        variantId: item.variantId || undefined,
        variantName: item.variantName || undefined,
        variantPrice: item.variantPrice || item.price,
        quantity: item.quantity || 1,
        image: item.image,
        description: item.description,
        isVeg: item.isVeg !== false
      }))

      const response = await orderAPI.calculateOrder({
        useCart: true,
        items: [],
        restaurantId: restaurantData?.restaurantId || restaurantData?._id || restaurantId || null,
        deliveryAddress: orderType === "takeaway" ? undefined : defaultAddress,
        couponCode: inputCode,
        orderType: orderType,
        zoneId: zoneId || undefined
      })

      const pricingData = response?.data?.data?.pricing
      if (!pricingData) {
        throw new Error("Unable to validate coupon")
      }

      if (!pricingData.appliedCoupon) {
        throw new Error("Invalid or unavailable coupon code")
      }

      setPricing(pricingData)
      setAppliedCoupon(
        matchedCoupon || {
          code: inputCode,
          discount: pricingData.appliedCoupon.discount || 0,
          minOrder: 0,
          customerGroup: "all",
          couponType: "all",
        },
      )
      toast.success("Coupon applied")
    } catch (error) {
      debugError("Error applying coupon code:", error)
      // Rollback states
      setAppliedCoupon(prevAppliedCoupon)
      setCouponCode(prevCouponCode)
      setManualCouponCode(prevManualCouponCode)
      toast.error(error?.response?.data?.error || error?.message || "Failed to apply coupon")
    }
  }


  const handleRemoveCoupon = async () => {
    setAppliedCoupon(null)
    setCouponCode("")
    setManualCouponCode("")

    // Recalculate pricing without coupon
    if (cart.length > 0 && hasSavedAddress) {
      try {
        const items = cart.map(item => ({
          itemId: item.itemId || item.id,
          name: item.name,
          price: item.price,
          variantId: item.variantId || undefined,
          variantName: item.variantName || undefined,
          variantPrice: item.variantPrice || item.price,
          quantity: item.quantity || 1,
          image: item.image,
          description: item.description,
          isVeg: item.isVeg === true || item.foodType === 'Veg'
        }))

        const response = await orderAPI.calculateOrder({
          useCart: true,
          items: [],
          restaurantId: restaurantData?.restaurantId || restaurantData?._id || restaurantId || null,
          deliveryAddress: orderType === "takeaway" ? undefined : defaultAddress,
          couponCode: undefined,
          orderType: orderType,
          zoneId: zoneId || undefined
        })

        if (response?.data?.success && response?.data?.data?.pricing) {
          setPricing(response.data.data.pricing)
        }
      } catch (error) {
        debugError("Error recalculating pricing:", error)
      }
    }
  }


  const handlePlaceOrder = async () => {
    if (!hasSavedAddress) {
      toast.error("Please choose a delivery location to continue")
      openLocationSelector()
      return
    }

    if (isCartZoneMismatch) {
      toast.error("This restaurant does not deliver to your selected location")
      return
    }

    if (isScheduled) {
      if (!scheduledDate || !scheduledTime) {
        toast.error("Please select both date and time to schedule your order")
        return
      }
      const scheduleString = `${scheduledDate}T${scheduledTime}:00`
      const scheduleDateObj = new Date(scheduleString)
      if (scheduleDateObj < new Date()) {
        toast.error("Scheduled time must be in the future")
        return
      }
    }

    if (cart.length === 0) {
      alert("Your cart is empty")
      return
    }

    setIsPlacingOrder(true)

    // Use API_BASE_URL from config (supports both dev and production)

    try {
      debugLog("?? Starting order placement process...")
      debugLog("?? Cart items:", cart.map(item => ({ id: item.id, name: item.name, quantity: item.quantity, price: item.price })))
      debugLog("?? Applied coupon:", appliedCoupon?.code || "None")
      debugLog("?? Delivery address:", defaultAddress?.label || defaultAddress?.city)

      // Ensure couponCode is included in pricing
      const orderPricing = pricing || {
        subtotal,
        deliveryFee,
        tax: gstCharges,
        platformFee,
        discount,
        total,
        couponCode: appliedCoupon?.code || null
      };

      // Add couponCode if not present but coupon is applied
      if (!orderPricing.couponCode && appliedCoupon?.code) {
        orderPricing.couponCode = appliedCoupon.code;
      }

      // Include all cart items (main items + addons)
      // Note: Addons are added as separate cart items when user clicks the + button
      const orderItems = cart.map(item => {
        const vName = item.variantName || (typeof item.variant === 'string' ? item.variant : item.variant?.name) || (typeof item.selectedVariant === 'string' ? item.selectedVariant : item.selectedVariant?.name) || item.variant_name || item.size || undefined;
        const vId = item.variantId || item.variant?._id || item.variant?.id || item.selectedVariant?._id || item.selectedVariant?.id || undefined;
        return {
          itemId: item.itemId || item.id,
          name: item.name,
          price: item.price,
          variantId: vId,
          variantName: vName,
          variantPrice: item.variantPrice || item.price,
          quantity: item.quantity || 1,
          image: item.image || "",
          description: item.description || "",
          isVeg: item.isVeg === true || item.foodType === 'Veg',
          preparationTime: item.preparationTime
        };
      })

      debugLog("?? Order items to send:", orderItems)
      debugLog("?? Order pricing:", orderPricing)

      // Check API base URL before making request (for debugging)
      const fullUrl = `${API_BASE_URL}${API_ENDPOINTS.ORDER.CREATE}`;
      debugLog("?? Making request to:", fullUrl)
      debugLog("?? Authentication token present:", !!localStorage.getItem('accessToken') || !!localStorage.getItem('user_accessToken'))

      // CRITICAL: Validate restaurant ID before placing order
      // Ensure we're using the correct restaurant from restaurantData (most reliable)
      const finalRestaurantId = restaurantData?.restaurantId || restaurantData?._id || null;
      const finalRestaurantName = restaurantData?.name || null;

      if (!finalRestaurantId) {
        debugError('? CRITICAL: Cannot place order - Restaurant ID is missing!');
        debugError('?? Debug info:', {
          restaurantData: restaurantData ? {
            _id: restaurantData._id,
            restaurantId: restaurantData.restaurantId,
            name: restaurantData.name
          } : 'Not loaded',
          cartRestaurantId: restaurantId,
          cartRestaurantName: cart[0]?.restaurant,
          cartItems: cart.map(item => ({
            id: item.id,
            name: item.name,
            restaurant: item.restaurant,
            restaurantId: item.restaurantId
          }))
        });
        alert('Error: Restaurant information is missing. Please refresh the page and try again.');
        setIsPlacingOrder(false);
        return;
      }

      // CRITICAL: Validate that ALL cart items belong to the SAME restaurant
      const cartRestaurantIds = cart
        .map(item => item.restaurantId)
        .filter(Boolean)
        .map(id => String(id).trim()); // Normalize to string and trim

      const cartRestaurantNames = cart
        .map(item => item.restaurant)
        .filter(Boolean)
        .map(name => name.trim().toLowerCase()); // Normalize names

      // Get unique values (after normalization)
      const uniqueRestaurantIds = [...new Set(cartRestaurantIds)];
      const uniqueRestaurantNames = [...new Set(cartRestaurantNames)];

      // Check if cart has items from multiple restaurants
      // Note: If restaurant names match, allow even if IDs differ (same restaurant, different ID format)
      if (uniqueRestaurantNames.length > 1) {
        // Different restaurant names = definitely different restaurants
        debugError('? CRITICAL ERROR: Cart contains items from multiple restaurants!', {
          restaurantIds: uniqueRestaurantIds,
          restaurantNames: uniqueRestaurantNames,
          cartItems: cart.map(item => ({
            id: item.id,
            name: item.name,
            restaurant: item.restaurant,
            restaurantId: item.restaurantId
          }))
        });

        // Automatically clean cart to keep items from the restaurant matching restaurantData
        if (finalRestaurantId && finalRestaurantName) {
          debugLog('?? Auto-cleaning cart to keep items from:', finalRestaurantName);
          cleanCartForRestaurant(finalRestaurantId, finalRestaurantName);
          toast.error('Cart contained items from different restaurants. Items from other restaurants have been removed.');
        } else {
          // If restaurantData is not available, keep items from first restaurant in cart
          const firstRestaurantId = cart[0]?.restaurantId;
          const firstRestaurantName = cart[0]?.restaurant;
          if (firstRestaurantId && firstRestaurantName) {
            debugLog('?? Auto-cleaning cart to keep items from first restaurant:', firstRestaurantName);
            cleanCartForRestaurant(firstRestaurantId, firstRestaurantName);
            toast.error('Cart contained items from different restaurants. Items from other restaurants have been removed.');
          } else {
            toast.error('Cart contains items from different restaurants. Please clear cart and try again.');
          }
        }

        setIsPlacingOrder(false);
        return;
      }

      // If restaurant names match but IDs differ, that's OK (same restaurant, different ID format)
      // But log a warning in development
      if (uniqueRestaurantIds.length > 1 && uniqueRestaurantNames.length === 1) {
        if (process.env.NODE_ENV === 'development') {
          debugWarn('?? Cart items have different restaurant IDs but same name. This is OK if IDs are in different formats.', {
            restaurantIds: uniqueRestaurantIds,
            restaurantName: uniqueRestaurantNames[0]
          });
        }
      }

      // Validate that cart items' restaurantId matches the restaurantData
      if (cartRestaurantIds.length > 0) {
        const cartRestaurantId = cartRestaurantIds[0];

        // Check if cart restaurantId matches restaurantData
        const restaurantIdMatches =
          cartRestaurantId === finalRestaurantId ||
          cartRestaurantId === restaurantData?._id?.toString() ||
          cartRestaurantId === restaurantData?.restaurantId;

        if (!restaurantIdMatches) {
          debugError('? CRITICAL ERROR: Cart restaurantId does not match restaurantData!', {
            cartRestaurantId: cartRestaurantId,
            finalRestaurantId: finalRestaurantId,
            restaurantDataId: restaurantData?._id?.toString(),
            restaurantDataRestaurantId: restaurantData?.restaurantId,
            restaurantDataName: restaurantData?.name,
            cartRestaurantName: cartRestaurantNames[0]
          });
          alert(`Error: Cart items belong to "${cartRestaurantNames[0] || 'Unknown Restaurant'}" but restaurant data doesn't match. Please refresh the page and try again.`);
          setIsPlacingOrder(false);
          return;
        }
      }

      // Validate restaurant name matches
      if (cartRestaurantNames.length > 0 && finalRestaurantName) {
        const cartRestaurantName = cartRestaurantNames[0];
        if (cartRestaurantName.toLowerCase().trim() !== finalRestaurantName.toLowerCase().trim()) {
          debugError('? CRITICAL ERROR: Restaurant name mismatch!', {
            cartRestaurantName: cartRestaurantName,
            finalRestaurantName: finalRestaurantName
          });
          alert(`Error: Cart items belong to "${cartRestaurantName}" but restaurant data shows "${finalRestaurantName}". Please refresh the page and try again.`);
          setIsPlacingOrder(false);
          return;
        }
      }

      // Log order details for debugging
      debugLog('? Order validation passed - Placing order with restaurant:', {
        restaurantId: finalRestaurantId,
        restaurantName: finalRestaurantName,
        restaurantDataId: restaurantData?._id,
        restaurantDataRestaurantId: restaurantData?.restaurantId,
        cartRestaurantId: cartRestaurantIds[0],
        cartRestaurantName: cartRestaurantNames[0],
        cartItemCount: cart.length
      });

      // FINAL VALIDATION: Double-check restaurantId before sending to backend
      const cartRestaurantId = cart[0]?.restaurantId;
      if (cartRestaurantId && cartRestaurantId !== finalRestaurantId &&
        cartRestaurantId !== restaurantData?._id?.toString() &&
        cartRestaurantId !== restaurantData?.restaurantId) {
        debugError('? CRITICAL: Final validation failed - restaurantId mismatch!', {
          cartRestaurantId: cartRestaurantId,
          finalRestaurantId: finalRestaurantId,
          restaurantDataId: restaurantData?._id?.toString(),
          restaurantDataRestaurantId: restaurantData?.restaurantId,
          cartRestaurantName: cart[0]?.restaurant,
          finalRestaurantName: finalRestaurantName
        });
        alert('Error: Restaurant information mismatch detected. Please refresh the page and try again.');
        setIsPlacingOrder(false);
        return;
      }

      const orderPayload = {
        useCart: true,
        // Server loads items from DB food cart; do not trust client cart lines/prices.
        items: [],
        address: {
          ...defaultAddress,
          phone: recipientPhone || defaultAddress?.phone || "",
          name: recipientName,
          fullName: recipientName,
        },
        customerName: recipientName,
        customerPhone: recipientPhone || defaultAddress?.phone || "",
        restaurantId: finalRestaurantId,
        restaurantName: finalRestaurantName || undefined,
        couponCode: appliedCoupon?.code || couponCode || undefined,
        note: "",
        restaurantNote: restaurantNote || "",
        sendCutlery: sendCutlery !== false,
        paymentMethod: selectedPaymentMethod,
        // `useZone()` can return `null`. Zod expects string/undefined, not null.
        zoneId: zoneId || undefined,
        scheduledAt: isScheduled ? new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString() : undefined,
        orderType: orderType || "delivery",
      };
      // Log final order details (including paymentMethod for COD debugging)
      debugLog('?? FINAL: Sending order to backend with:', {
        restaurantId: finalRestaurantId,
        restaurantName: finalRestaurantName,
        itemCount: orderItems.length,
        totalAmount: orderPricing.total,
        paymentMethod: orderPayload.paymentMethod
      });

      // Check wallet balance if wallet payment selected
      if (selectedPaymentMethod === "wallet" && walletBalance < total) {
        toast.error(`Insufficient wallet balance. Required: ${RUPEE_SYMBOL}${total.toFixed(0)}, Available: ${RUPEE_SYMBOL}${walletBalance.toFixed(0)}`)
        setIsPlacingOrder(false)
        return
      }

      // Cash flow: order placed without online payment
      if (selectedPaymentMethod === "cash") {
        const orderResponse = await orderAPI.createOrder(orderPayload)
        debugLog("? Cash order created successfully:", orderResponse.data)
        const { order } = orderResponse.data.data

        toast.success("Order placed with Cash on Delivery")
        setPlacedOrderId(order?._id || order?.orderId || order?.id || null)
        setPlacedOrderObj(order)
        setShowOrderSuccess(true)
        window.dispatchEvent(new CustomEvent('order-placed', { detail: { order } }))
        clearCart()
        setRestaurantNote("")
        setShowRestaurantNoteInput(false)
        try {
          window.localStorage.removeItem(CART_ORDER_NOTE_STORAGE_KEY)
        } catch {
          // ignore
        }
        setIsPlacingOrder(false)
        return
      }

      // Wallet flow: order placed with wallet payment
      if (selectedPaymentMethod === "wallet") {
        const orderResponse = await orderAPI.createOrder(orderPayload)
        debugLog("? Wallet order created successfully:", orderResponse.data)
        const { order } = orderResponse.data.data

        toast.success("Order placed with Wallet payment")
        setPlacedOrderId(order?._id || order?.orderId || order?.id || null)
        setPlacedOrderObj(order)
        setShowOrderSuccess(true)
        window.dispatchEvent(new CustomEvent('order-placed', { detail: { order } }))
        clearCart()
        setRestaurantNote("")
        setShowRestaurantNoteInput(false)
        try {
          window.localStorage.removeItem(CART_ORDER_NOTE_STORAGE_KEY)
        } catch {
          // ignore
        }
        setIsPlacingOrder(false)
        // Refresh wallet balance
        try {
          const walletResponse = await userAPI.getWallet()
          if (walletResponse?.data?.success && walletResponse?.data?.data?.wallet) {
            setWalletBalance(walletResponse.data.data.wallet.balance || 0)
          }
        } catch (error) {
          debugError("Error refreshing wallet balance:", error)
        }
        return
      }

      // Online payment (Razorpay) flow: Initiate payment order FIRST (no DB order created yet)
      const initiateResponse = await orderAPI.initiateOnlinePayment(orderPayload)
      debugLog("? Online payment initiated successfully:", initiateResponse.data)

      const razorpay = initiateResponse.data.data

      if (!razorpay || !razorpay.orderId || !razorpay.key) {
        debugError("? Razorpay initialization failed:", { razorpay })
        throw new Error("Failed to initialize payment gateway. Please contact support.")
      }

      debugLog("?? Razorpay gateway order created:", {
        orderId: razorpay.orderId,
        amount: razorpay.amount,
        currency: razorpay.currency,
        keyPresent: !!razorpay.key
      })

      // Get user info for Razorpay prefill
      const userInfo = userProfile || {}
      const userPhone = recipientPhone || userInfo.phone || defaultAddress?.phone || ""
      const userEmail = userInfo.email || ""
      const userName = recipientName || userInfo.name || ""

      // Format phone number (remove non-digits, take last 10 digits)
      const formattedPhone = userPhone.replace(/\D/g, "").slice(-10)

      // Get company name for Razorpay
      const companyName = await getCompanyNameAsync()

      // Flag to prevent duplicate execution (onError + onClose)
      let paymentHandled = false

      // Store payload in localStorage for redirect-based checkout (PhonePe intent fix)
      try {
        window.localStorage.setItem('pendingOrderPayload', JSON.stringify(orderPayload))
        window.localStorage.removeItem('pendingOrderSavings')
      } catch (err) {
        debugError("Failed to save pending order payload to localStorage", err)
      }

      // API_BASE_URL usually ends with /api/v1 or similar. We strip the /v1 part to form the webhook URL.
      const baseUrlStr = String(API_BASE_URL).replace(/\/v1\/?$/, '');
      const callbackUrl = `${baseUrlStr}/v1/payments/webhook/razorpay-redirect?frontendUrl=${encodeURIComponent(window.location.origin + window.location.pathname)}`

      // Initialize Razorpay payment modal
      await initRazorpayPayment({
        key: razorpay.key,
        amount: razorpay.amount, // Already in paise from backend
        currency: razorpay.currency || 'INR',
        order_id: razorpay.orderId,
        name: companyName,
        description: `Order Payment - ${RUPEE_SYMBOL}${(razorpay.amount / 100).toFixed(2)}`,
        callback_url: callbackUrl,
        redirect: true,
        prefill: {
          name: userName,
          email: userEmail,
          contact: formattedPhone
        },
        notes: {
          userId: userInfo.id || "",
          restaurantId: finalRestaurantId || "unknown"
        },
        handler: async (response) => {
          paymentHandled = true
          try {
            debugLog("? Payment successful, creating order in DB...", {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id
            })

            // Now create the order in DB with payment signature verification
            const createOrderPayload = {
              ...orderPayload,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            }

            const createResponse = await orderAPI.createOrder(createOrderPayload)
            debugLog("? Order created after payment:", createResponse.data)

            if (createResponse.data?.success) {
              const { order } = createResponse.data.data
              setPlacedOrderId(order._id || order.orderId)
              setPlacedOrderObj(order)
              setShowOrderSuccess(true)
              window.dispatchEvent(new CustomEvent('order-placed', { detail: { order } }))
              clearCart()
              setRestaurantNote("")
              setShowRestaurantNoteInput(false)
              try {
                window.localStorage.removeItem(CART_ORDER_NOTE_STORAGE_KEY)
              } catch {
                // ignore
              }
              setIsPlacingOrder(false)
            } else {
              throw new Error(createResponse.data?.message || "Payment verified but order creation failed")
            }
          } catch (error) {
            debugError("? Order creation after payment error:", error)
            const errorMessage =
              error?.response?.data?.message ||
              error?.response?.data?.error?.message ||
              error?.response?.data?.errors?.[0]?.message ||
              error?.message ||
              "Payment verification failed. Please contact support."
            alert(errorMessage)
            setIsPlacingOrder(false)
          }
        },
        onError: async (error) => {
          if (paymentHandled) return
          paymentHandled = true
          debugError("? Razorpay payment error:", error)
          if (error?.code !== 'PAYMENT_CANCELLED' && error?.message !== 'PAYMENT_CANCELLED') {
            const errorMessage = error?.description || error?.message || "Payment failed. Please try again."
            alert(errorMessage)
          } else {
            toast.info("Payment was cancelled. No order has been placed.")
          }
          setIsPlacingOrder(false)
        },
        onClose: async () => {
          if (paymentHandled) return
          paymentHandled = true
          debugLog("?? Payment modal closed by user - no DB order was created")
          toast.info("Payment was not completed. No order has been placed.")
          setIsPlacingOrder(false)
        }
      })
    } catch (error) {
      debugError("? Order creation error:", error)

      let errorMessage = "Failed to create order. Please try again."

      // Handle network errors
      if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
        const backendUrl = API_BASE_URL.replace('/api', '');
        errorMessage = `Network Error: Cannot connect to backend server.\n\n` +
          `Expected backend URL: ${backendUrl}\n\n` +
          `Please check:\n` +
          `1. Backend server is running\n` +
          `2. Backend is accessible at ${backendUrl}\n` +
          `3. Check browser console (F12) for more details\n\n` +
          `If backend is not running, start it with:\n` +
          `cd appzetofood/backend && npm start`

        debugError("?? Network Error Details:", {
          code: error.code,
          message: error.message,
          config: {
            url: error.config?.url,
            baseURL: error.config?.baseURL,
            fullUrl: error.config?.baseURL + error.config?.url,
            method: error.config?.method
          },
          backendUrl: backendUrl,
          apiBaseUrl: API_BASE_URL
        })

        // Backend disconnected - no health check (new backend in progress)
      }
      // Handle timeout errors
      else if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        errorMessage = "Request timed out. The server is taking too long to respond. Please try again."
      }
      // Handle other axios errors
      else if (error.response) {
        // Server responded with error status
        errorMessage = error.response.data?.message || `Server error: ${error.response.status}`
      }
      // Handle other errors
      else if (error.message) {
        errorMessage = error.message
      }

      alert(errorMessage)
      setIsPlacingOrder(false)
    }
  }

  const handleGoToOrders = () => {
    setShowSavingsCongrats(false)
    setCongratssSavingsAmount(0)
    setCongratssSavingsPercentage(0)
    setCongratssSavingsItems([])
    setOrderSuccessSavingsAmount(0)
    setShowOrderSuccess(false)
    setShowPlacingOrder(false)
    navigate(`/user/orders/${placedOrderId}?confirmed=true`, {
      replace: true,
      state: { order: placedOrderObj, fromOrderPlaced: true, from: 'cart' }
    })
  }

  // Empty cart state - but don't show if order success or placing order modal is active
  if (cart.length === 0 && !showOrderSuccess && !showPlacingOrder && !showSavingsCongrats) {
    return (
      <AnimatedPage className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a]">
        <div className="bg-white dark:bg-[#1a1a1a] border-b dark:border-gray-800 sticky top-0 z-10">
          <div className="flex items-center gap-3 px-4 py-3">
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={handleBack}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="font-semibold text-gray-800 dark:text-white">Cart</span>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <Utensils className="h-10 w-10 text-gray-400" />
          </div>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-1">Your cart is empty</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 text-center">Add items from a restaurant to start a new order</p>
          <Link to="/user">
            <Button className="bg-[#DC2626] hover:bg-[#991B1B] text-white">Browse Restaurants</Button>
          </Link>
        </div>
      </AnimatedPage>
    )
  }

  return (
    <div className="relative min-h-screen bg-slate-50 dark:bg-[#0a0a0a]">
      {/* Header - Sticky at top */}
      <div className="bg-white dark:bg-[#1a1a1a] border-b border-gray-100/80 dark:border-gray-800/80 sticky top-0 z-20 flex-shrink-0">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between px-4 md:px-6 py-2.5">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <button 
                className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-white/90 dark:bg-gray-800/90 border border-gray-100/50 dark:border-gray-700/50 shadow-sm flex items-center justify-center flex-shrink-0 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200 active:scale-95"
                onClick={handleBack}
              >
                <ArrowLeft className="h-[18px] w-[18px] md:h-5 md:w-5 stroke-[2.5]" />
              </button>
              <div className="min-w-0 flex-1 ml-2 md:ml-3">
                <h1 className="text-base md:text-lg font-bold text-[#1C2534] dark:text-white tracking-tight truncate antialiased transform-gpu">
                  {restaurantName}
                </h1>
                {isRestaurantClosed && (
                  <p className="text-xs font-semibold text-red-600 dark:text-red-400 mt-0.5">
                    Restaurant is closed. Please order when they are online.
                  </p>
                )}
              </div>
            </div>
            <button
              className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-white/90 dark:bg-gray-800/90 border border-gray-100/50 dark:border-gray-700/50 shadow-sm flex items-center justify-center flex-shrink-0 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-750 transition-all duration-200 active:scale-95"
              onClick={handleShare}
            >
              <Share className="h-[18px] w-[18px] md:h-5 md:w-5 stroke-[2.5]" />
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-44 md:pb-52">
        {/* Zone mismatch warning */}
        {isCartZoneMismatch && (
          <div className="px-4 md:px-6 pt-4 pb-1 flex-shrink-0">
            <div className="max-w-7xl mx-auto">
              <div className="relative overflow-hidden rounded-2xl border border-amber-200/80 dark:border-amber-800/50 bg-gradient-to-br from-amber-50 via-orange-50/80 to-white dark:from-amber-950/40 dark:via-[#1a1a1a] dark:to-[#1a1a1a] shadow-[0_8px_24px_rgba(245,158,11,0.08)]">
                <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-amber-400 to-orange-500" />
                <div className="p-4 pl-5 flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 border border-amber-200/70 dark:border-amber-800/60 flex items-center justify-center flex-shrink-0 shadow-sm">
                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-amber-950 dark:text-amber-100 tracking-tight">
                      Delivery not available here
                    </p>
                    <p className="text-xs text-amber-800/80 dark:text-amber-200/70 mt-1 leading-relaxed">
                      {restaurantName} doesn’t deliver to your selected location. Switch address to continue, or clear this cart.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={openLocationSelector}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold tracking-wide transition-colors active:scale-[0.98] shadow-sm"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        Change location
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          clearCart()
                          toast.success("Cart cleared")
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800/70 text-amber-800 dark:text-amber-200 text-[11px] font-bold tracking-wide hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors active:scale-[0.98]"
                      >
                        Clear cart
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Savings Banner */}
        {savings > 0 && (
          <div className="bg-green-50 dark:bg-green-950/20 px-4 md:px-6 py-2.5 flex-shrink-0 border-b border-green-100/30 dark:border-green-900/10">
            <div className="max-w-7xl mx-auto flex items-center gap-2">
              <span className="text-sm md:text-base">🎉</span>
              <p className="text-sm md:text-base font-semibold text-green-700 dark:text-green-400">
                {appliedCoupon?.code 
                  ? `You saved ${RUPEE_SYMBOL}${savings} with '${appliedCoupon.code}' on this order!`
                  : `You saved ${RUPEE_SYMBOL}${savings} on this order!`}
              </p>
            </div>
          </div>
        )}

        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
          <div className="max-w-3xl mx-auto">
            {/* Main Cart Content */}
            <div className="space-y-2 md:space-y-4">
              {/* Cart Items */}
              <div className="bg-white dark:bg-[#1a1a1a] px-4 md:px-6 py-4 md:py-5 rounded-2xl md:rounded-3xl shadow-sm border border-slate-100 dark:border-gray-800">
                <div className="space-y-3 md:space-y-4">
                  <div className="space-y-6">
                    {cart.map((item, index) => (
                      <div key={item.id} className={isCartUnavailable ? "opacity-60 grayscale transition-all duration-300" : ""}>
                        <div className="flex items-center gap-4">
                          {/* Veg/Non-veg indicator */}
                          <div className={`w-4 h-4 border-2 ${item.isVeg === true || item.foodType === 'Veg' ? 'border-green-600' : 'border-red-600'} flex items-center justify-center flex-shrink-0 rounded-[2px]`}>
                            <div className={`w-2 h-2 rounded-full ${item.isVeg === true || item.foodType === 'Veg' ? 'bg-green-600' : 'bg-red-600'}`} />
                          </div>

                          <div className="flex-1 min-w-0 flex items-center gap-4">
                              <div className="w-16 h-16 md:w-20 md:h-20 flex-shrink-0 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800">
                                <img
                                  src={item.image || dishFallbackImage}
                                  alt={item.name}
                                  className="w-full h-full object-cover transform hover:scale-110 transition-transform duration-700"
                                  onError={(e) => {
                                    e.target.src = dishFallbackImage;
                                  }}
                                />
                              </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="text-sm md:text-base font-bold text-gray-900 dark:text-gray-100 leading-tight">{item.name}</h3>
                              {item.variantName ? (
                                <p className="text-[10px] md:text-xs text-red-600 dark:text-red-300 mt-1 font-semibold bg-red-50 dark:bg-red-950/20 border border-red-100/50 dark:border-red-900/30 w-fit px-2.5 py-0.5 rounded-full whitespace-nowrap">
                                  {item.variantName}
                                </p>
                              ) : null}
                              {isRestaurantClosed && (
                                <p className="text-[11px] text-red-500 dark:text-red-400 font-semibold mt-1">
                                  Remove this dish to order available dishes
                                </p>
                              )}
                              {isCartZoneMismatch && !isRestaurantClosed && (
                                <p className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold mt-1">
                                  Not deliverable to your selected location
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-2.5 flex-shrink-0">
                            <div className="flex items-center border border-[#DC2626]/30 dark:border-[#DC2626]/40 rounded-lg overflow-hidden bg-white dark:bg-gray-900 shadow-sm">
                              <button
                                onClick={() => updateQuantity(item.id, item.quantity - 1)}
                                className="px-2.5 py-1.5 hover:bg-[#DC2626]/5 text-[#DC2626] transition-colors"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <span className="px-2 text-sm md:text-base font-black text-[#DC2626] min-w-[28px] text-center">
                                {item.quantity}
                              </span>
                              <button
                                onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                className="px-2.5 py-1.5 hover:bg-[#DC2626]/5 text-[#DC2626] transition-colors"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <p className="text-sm md:text-base font-black text-gray-900 dark:text-gray-100">
                              {RUPEE_SYMBOL}{((item.price || 0) * (item.quantity || 1)).toFixed(0)}
                            </p>
                          </div>
                        </div>
                        {index < cart.length - 1 && (
                          <div className="mt-6 border-b border-gray-100 dark:border-gray-800/40 border-dashed" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Add more items */}
                <button
                  onClick={handleBack}
                  className="flex items-center gap-2 mt-4 md:mt-6 text-[#DC2626] dark:text-[#DC2626]"
                >
                  <Plus className="h-4 w-4 md:h-5 md:w-5" />
                  <span className="text-sm md:text-base font-medium">Add more items</span>
                </button>
              </div>

              {/* Note for restaurant */}
              <div className="bg-white dark:bg-[#1a1a1a] px-4 md:px-6 py-4 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-800">
                <button
                  onClick={() => setShowRestaurantNoteInput(!showRestaurantNoteInput)}
                  className="w-full flex items-center gap-2 px-3 md:px-4 py-2 md:py-3 border border-gray-200 dark:border-gray-700 rounded-lg md:rounded-xl text-sm md:text-base text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <Utensils className="h-4 w-4 md:h-5 md:w-5" />
                  <span className="truncate">{restaurantNote || "Add note for restaurant"}</span>
                </button>
              </div>

              {/* Restaurant Note Input */}
              {showRestaurantNoteInput && (
                <div className="bg-white dark:bg-[#1a1a1a] px-4 md:px-6 py-3 md:py-4 rounded-lg md:rounded-xl border border-slate-100 dark:border-gray-800">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                    Restaurant instructions
                  </p>
                  <textarea
                    value={restaurantNote}
                    onChange={(e) => setRestaurantNote(e.target.value)}
                    placeholder="Eg. Don't add onions, make it extra spicy, etc."
                     className="w-full border border-gray-200 dark:border-gray-700 rounded-lg md:rounded-xl p-3 md:p-4 text-sm md:text-base resize-none h-20 md:h-24 focus:outline-none focus:border-[#DC2626] dark:focus:border-[#DC2626] bg-white dark:bg-[#0a0a0a] text-gray-900 dark:text-gray-100"
                    maxLength={240}
                  />
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      Note for restaurant.
                    </p>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                      {restaurantNote.length}/240
                    </span>
                  </div>
                </div>
              )}

              {/* Complete your meal section - Approved Addons */}
              {addons.length > 0 && (
                <div className="bg-white dark:bg-[#1a1a1a] px-4 md:px-6 py-5 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-800">
                  <div className="flex items-center gap-2 md:gap-3 mb-3 md:mb-4">
                    <div className="w-6 h-6 md:w-8 md:h-8 bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-center">
                       <Sparkles className="h-4 w-4 md:h-5 md:w-5 text-[#DC2626]" />
                    </div>
                    <span className="text-sm md:text-base font-semibold text-gray-800 dark:text-gray-200">Complete your meal with</span>
                  </div>
                  {loadingAddons ? (
                    <div className="flex gap-3 md:gap-4 overflow-x-auto pb-2 -mx-4 md:-mx-6 px-4 md:px-6 scrollbar-hide">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="flex-shrink-0 w-28 md:w-36 animate-pulse">
                          <div className="w-full h-28 md:h-36 bg-gray-200 dark:bg-gray-700 rounded-lg md:rounded-xl" />
                          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded mt-2" />
                          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded mt-1 w-2/3" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex gap-3 md:gap-4 overflow-x-auto pb-2 -mx-4 md:-mx-6 px-4 md:px-6 scrollbar-hide">
                      {addons.map((addon) => (
                        <div key={addon.id} className="flex-shrink-0 w-28 md:w-36">
                          <div className="relative bg-gray-100 dark:bg-gray-800 rounded-lg md:rounded-xl overflow-hidden">
                            <img
                              src={addon.image || (addon.images && addon.images[0]) || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200&h=200&fit=crop"}
                              alt={addon.name}
                              className="w-full h-28 md:h-36 object-cover rounded-lg md:rounded-xl"
                              onError={(e) => {
                                e.target.onerror = null
                                e.target.src = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200&h=200&fit=crop"
                              }}
                            />
                            <div className="absolute top-1 md:top-2 left-1 md:left-2">
                              <div className="w-3.5 h-3.5 md:w-4 md:h-4 bg-white border border-green-600 flex items-center justify-center rounded">
                                <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-green-600" />
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                // Use restaurant info from existing cart items to ensure format consistency
                                const cartRestaurantId = cart[0]?.restaurantId || restaurantId;
                                const cartRestaurantName = cart[0]?.restaurant || restaurantName;

                                if (!cartRestaurantId || !cartRestaurantName) {
                                  debugError('? Cannot add addon: Missing restaurant information', {
                                    cartRestaurantId,
                                    cartRestaurantName,
                                    restaurantId,
                                    restaurantName,
                                    cartItem: cart[0]
                                  });
                                  toast.error('Restaurant information is missing. Please refresh the page.');
                                  return;
                                }

                                addToCart({
                                  id: addon.id,
                                  name: addon.name,
                                  price: addon.price,
                                  image: addon.image || (addon.images && addon.images[0]) || "",
                                  description: addon.description || "",
                                  isVeg: true,
                                  restaurant: cartRestaurantName,
                                  restaurantId: cartRestaurantId
                                });
                              }}
                               className="absolute bottom-1 md:bottom-2 right-1 md:right-2 w-6 h-6 md:w-7 md:h-7 bg-white border border-[#DC2626] rounded flex items-center justify-center shadow-sm hover:bg-[#DC262605] dark:hover:bg-[#DC262610] transition-colors"
                            >
                               <Plus className="h-3.5 w-3.5 md:h-4 md:w-4 text-[#DC2626]" />
                            </button>
                          </div>
                          <p className="text-xs md:text-sm font-medium text-gray-800 dark:text-gray-200 mt-1.5 md:mt-2 line-clamp-2 leading-tight">{addon.name}</p>
                          {addon.description && (
                            <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{addon.description}</p>
                          )}
                          <p className="text-xs md:text-sm text-gray-800 dark:text-gray-200 font-semibold mt-0.5">{RUPEE_SYMBOL}{addon.price}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Simplified Coupon Section */}
              <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl overflow-hidden border border-slate-100 dark:border-gray-800 shadow-sm">
                <div className="w-full px-4 py-4 md:px-6 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Tag className="h-5 w-5 text-gray-400" />
                    <span className="text-sm md:text-base font-bold text-gray-800 dark:text-gray-200">Offers & Coupons</span>
                  </div>
                </div>

                {/* Cart coupon preview */}
                {!appliedCoupon && !couponCode && (
                  <div className="px-4 pb-4 md:px-6 md:pb-5 pt-1 animate-in fade-in duration-300">
                    {filteredCoupons.length > 0 ? (
                      <div className="space-y-2.5">
                        <div className="flex flex-col gap-2.5">
                          {filteredCoupons.slice(0, 2).map((coupon) =>
                            renderCartCouponCard(coupon, { compact: true, blocked: isCartUnavailable }),
                          )}
                        </div>
                        <button
                          onClick={() => {
                            if (isCartUnavailable) {
                              toast.error(
                                isCartZoneMismatch
                                  ? "This restaurant does not deliver to your selected location"
                                  : "Restaurant is closed. Coupons cannot be applied right now.",
                              )
                              return
                            }
                            setShowCouponSheet(true)
                          }}
                          className={`w-full py-2.5 px-4 bg-gray-50/50 hover:bg-gray-50 dark:bg-gray-900/30 dark:hover:bg-gray-900/50 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl text-xs font-bold text-[#DC2626] flex items-center justify-between transition-all active:scale-[0.98] mt-2.5 ${
                            isCartUnavailable ? "opacity-60 grayscale pointer-events-auto" : ""
                          }`}
                        >
                          <span>
                            {filteredCoupons.length > 2
                              ? `+ ${filteredCoupons.length - 2} more offer${filteredCoupons.length - 2 > 1 ? "s" : ""}`
                              : "More offers available"}
                          </span>
                          <span className="flex items-center gap-1 font-black uppercase tracking-wider text-[10px]">
                            VIEW ALL
                            <ChevronRight className="h-3.5 w-3.5" />
                          </span>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          if (isCartUnavailable) {
                            toast.error(
                              isCartZoneMismatch
                                ? "This restaurant does not deliver to your selected location"
                                : "Restaurant is closed. Coupons cannot be applied right now.",
                            )
                            return
                          }
                          setShowCouponSheet(true)
                        }}
                        className={`w-full py-2.5 px-4 bg-gray-50/50 hover:bg-gray-50 dark:bg-gray-900/30 dark:hover:bg-gray-900/50 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl text-xs font-bold text-[#DC2626] flex items-center justify-between transition-all active:scale-[0.98] ${
                          isCartUnavailable ? "opacity-60 grayscale" : ""
                        }`}
                      >
                        <span>Have a coupon code?</span>
                        <span className="flex items-center gap-1 font-black uppercase tracking-wider text-[10px]">
                          APPLY
                          <ChevronRight className="h-3.5 w-3.5" />
                        </span>
                      </button>
                    )}
                  </div>
                )}

                {couponCode && !appliedCoupon && (
                  <div className="px-4 py-4 md:px-6 flex items-center justify-between bg-slate-50/50 dark:bg-zinc-900/30 border-t border-dashed border-slate-100 dark:border-zinc-800/60 animate-pulse">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-zinc-800" />
                      <div>
                        <div className="h-3 w-16 bg-slate-200 dark:bg-zinc-800 rounded animate-pulse" />
                        <div className="h-4 w-28 bg-slate-200 dark:bg-zinc-800 rounded mt-1.5 animate-pulse" />
                      </div>
                    </div>
                    <div className="h-8 w-16 bg-slate-200 dark:bg-zinc-800 rounded-lg animate-pulse" />
                  </div>
                )}

                {appliedCoupon && (
                  <div className="px-4 py-3.5 md:px-6 bg-emerald-50/50 dark:bg-emerald-950/10 border-t border-emerald-100/60 dark:border-emerald-900/30 flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center flex-shrink-0 shadow-sm shadow-emerald-500/10">
                        <Check className="h-4 w-4 text-white stroke-[3px]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Applied:</span>
                          <span className="text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300 bg-emerald-100/60 dark:bg-emerald-900/40 px-2 py-0.5 rounded-md border border-dashed border-emerald-500/30 uppercase tracking-wider">{appliedCoupon.code}</span>
                        </div>
                        <p className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">
                          You saved {RUPEE_SYMBOL}{Math.round(discount)}
                        </p>
                      </div>
                    </div>
                    <button 
                      onClick={handleRemoveCoupon} 
                      className="text-xs font-black text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 px-3 py-1.5 bg-red-50 hover:bg-red-100/70 dark:bg-red-950/20 dark:hover:bg-red-950/40 border border-red-100 dark:border-red-900/30 rounded-lg active:scale-95 transition-all duration-200 flex-shrink-0"
                    >
                      REMOVE
                    </button>
                  </div>
                )}
              </div>

              {/* Delivery Time - Hidden in Takeaway */}
              {orderType !== "takeaway" && (
                <div className="bg-white dark:bg-[#1a1a1a] px-4 md:px-6 py-5 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-800">
                  <div className="flex items-start gap-3 md:gap-4">
                    <div className="mt-0.5">
                      <Zap className="h-5 w-5 text-green-600 fill-green-600/20" />
                    </div>
                    <div className="flex-1">
                      <p className="text-base text-gray-800 dark:text-gray-200">
                        Delivery in <span className="text-green-600 font-bold">{restaurantData?.estimatedDeliveryTime || "15-20 mins"}</span>
                      </p>
                      {/* Commented out Scheduled Delivery option
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 flex items-center gap-1">
                        Want this later?
                        <button onClick={() => {
                          const next = !isScheduled
                          setIsScheduled(next)
                          if (next && !scheduledDate) {
                            // Auto-set today's date so time slots populate immediately
                            const now = new Date()
                            const todayStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0]
                            setScheduledDate(todayStr)
                          }
                        }} className="border-b border-dashed border-gray-500 font-medium outline-none">
                          {isScheduled ? "Cancel schedule" : "Schedule it"}
                        </button>
                      </p>
                      */}
                    </div>
                  </div>

                  {/* Commented out Scheduled inputs container
                  {isScheduled && (
                    <div className="mt-5 flex flex-col sm:flex-row gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Date (Up to Tomorrow)</label>
                        <input
                          type="date"
                          min={new Date().toLocaleDateString('en-CA')}
                          max={new Date(Date.now() + 86400000).toLocaleDateString('en-CA')}
                          value={scheduledDate}
                          onChange={(e) => setScheduledDate(e.target.value)}
                          className="w-full text-sm p-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-[#0a0a0a] text-gray-800 dark:text-gray-200 focus:outline-none focus:border-[#DC2626]"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Time</label>
                        {availableTimeSlots.length > 0 ? (
                          <div className="relative">
                            <select
                              value={scheduledTime}
                              onChange={(e) => setScheduledTime(e.target.value)}
                               className="w-full text-sm p-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-[#0a0a0a] text-gray-800 dark:text-gray-200 focus:outline-none focus:border-[#DC2626] appearance-none pr-8"
                            >
                              {availableTimeSlots.map(slot => (
                                <option key={slot.value} value={slot.value}>{slot.label}</option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                          </div>
                        ) : (
                          <div className="w-full text-sm p-2 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-md text-center border border-gray-200 dark:border-gray-700">
                            {scheduledDate ? "No slots available" : "Select date first"}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  */}
                </div>
              )}

              {/* Delivery Address or Pickup Info */}
              <div className="bg-white dark:bg-[#1a1a1a] px-4 md:px-6 py-5 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-800">
                {orderType === "takeaway" ? (
                  <div className="flex items-start gap-4">
                    <div className="bg-[#DC262605] dark:bg-[#DC262610] p-3.5 rounded-2xl border border-[#DC262615] dark:border-[#DC262630]">
                      <ShoppingBag className="h-6 w-6 text-[#DC2626]" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest leading-none">PICKUP FROM</h3>
                      <p className="text-lg font-black text-gray-900 dark:text-white mt-1.5 leading-tight">
                        {restaurantData?.name || cart[0]?.restaurant || "Restaurant"}
                      </p>
                      <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 font-medium">
                        {restaurantData?.address || restaurantData?.location?.address || "Restaurant Address"}
                      </p>
                      <div className="mt-4 flex items-center gap-2">
                        <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-[11px] font-black bg-green-50 dark:bg-green-900/10 px-3 py-1.5 rounded-lg border border-green-100 dark:border-green-900/20">
                          <CheckCircle2 className="h-4 w-4" />
                          <span className="uppercase tracking-tight">READY FOR PICKUP IN {restaurantData?.preparationTime || "25-30"} MINS</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between w-full text-left">
                    <div className="flex items-start gap-4 flex-1">
                       <div className="bg-[#DC262605] dark:bg-[#DC262610] p-2 rounded-xl mt-0.5">
                         <MapPin className="h-5 w-5 text-[#DC2626]" />
                       </div>
                      <div className="flex-1">
                          <div className="flex flex-col">
                            <p className="text-sm md:text-base text-gray-800 dark:text-gray-200">
                              Delivery at{" "}
                              <span className="font-semibold">
                                {deliveryAddressMode === "current" ? "Current location" : "Location"}
                              </span>
                            </p>
                            {deliveryAddressMode === "current" ? (
                              <div className="mt-1">
                                {currentLocationLoading || !currentLocationAddress ? (
                                  <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 animate-pulse">
                                    Finding your current address...
                                  </p>
                                ) : (
                                  <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                                    {formatFullAddress(currentLocationAddress) ||
                                      currentLocationAddress?.formattedAddress ||
                                      currentLocationAddress?.address ||
                                      "Add delivery address"}
                                  </p>
                                )}
                                <div className="mt-1 flex items-center gap-2">
                                   <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] md:text-[11px] font-semibold bg-[#DC262605] text-[#DC2626] dark:bg-[#DC262610] dark:text-[#DC2626] border border-[#DC2626]/30">
                                     GPS enabled
                                   </span>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 pr-4">
                                {defaultAddress ? (formatFullAddress(defaultAddress) || defaultAddress?.formattedAddress || defaultAddress?.address || "Add delivery address") : "Add delivery address"}
                              </p>
                            )}
                          </div>
                          {!hasSavedAddress && (
                             <p className="text-sm text-[#DC2626] mt-2 font-medium">
                               Select a delivery location to continue
                             </p>
                          )}
                          {/* Address Selection Buttons */}
                          <div className="flex flex-wrap gap-2 mt-3">
                            {["Home", "Work", "Other"].map((label) => {
                              const normalizedLabel = normalizeAddressLabel(label)
                              const addressExists = addresses.some(addr => normalizeAddressLabel(addr.label) === normalizedLabel)
                              return (
                                <button
                                  key={label}
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handleSelectAddressByLabel(label)
                                  }}
                                  disabled={!addressExists}
                                  className={`text-xs px-4 py-1.5 rounded-full font-semibold transition-all ${addressExists
                                    ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-gray-800 dark:text-gray-300'
                                    : 'bg-gray-50 text-gray-400 border border-gray-100 cursor-not-allowed dark:bg-gray-900'
                                    }`}
                                >
                                  {label}
                                </button>
                              )
                            })}
                          </div>
                          {addresses.length > 0 && (
                            <div className="mt-4 space-y-3">
                              {addresses.map((address) => {
                                const addressId = getAddressId(address)
                                const isSelected = addressId && addressId === selectedAddressId
                                return (
                                  <button
                                    key={addressId || `${address.label}-${address.street}-${address.city}`}
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      handleSelectSavedAddress(address)
                                    }}
                                     className={`w-full text-left rounded-xl border-2 p-3 transition-colors ${isSelected
                                       ? "border-[#DC2626] bg-[#DC262605] dark:bg-[#DC2626]/5"
                                       : "border-slate-100 dark:border-gray-800 hover:border-slate-200"
                                       }`}
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                                          {getDisplayAddressLabel(address.label)}
                                        </p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-1">
                                          {formatFullAddress(address) || address.address || "Address details"}
                                        </p>
                                      </div>
                                      {isSelected && (
                                         <span className="text-[10px] bg-[#DC2626] text-white px-2 py-0.5 rounded uppercase font-bold tracking-wider whitespace-nowrap">
                                           Selected
                                         </span>
                                      )}
                                    </div>
                                  </button>
                                )
                              })}
                            </div>
                          )}
                      </div>
                    </div>
                    <button
                      type="button"
                       onClick={openLocationSelector}
                       className="p-2 text-[#DC2626] bg-[#DC262605] rounded-full hover:bg-[#DC262610] transition-colors dark:bg-[#DC262615] dark:hover:bg-[#DC262620]"
                       aria-label="Open location selector"
                     >
                       <ChevronRight className="h-5 w-5" />
                     </button>
                  </div>
                )}
              </div>

              {/* Contact */}
              <div className="bg-white dark:bg-[#1a1a1a] px-4 md:px-6 py-4 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 md:gap-4 flex-1 min-w-0">
                    <Phone className="h-4 w-4 md:h-5 md:w-5 text-gray-500 dark:text-gray-400 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm md:text-base text-gray-800 dark:text-gray-200 font-medium">
                        {recipientName}, <span className="font-semibold">{recipientPhone || "+91-XXXXXXXXXX"}</span>
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Order recipient details
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingRecipient((prev) => !prev)}
                     className="text-[#DC2626] text-xs md:text-sm font-semibold whitespace-nowrap"
                  >
                    {isEditingRecipient ? "Done" : "Change"}
                  </button>
                </div>

                {isEditingRecipient && (
                  <div className="mt-4 pt-4 border-t border-dashed border-gray-200 dark:border-gray-800 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                        Name
                      </label>
                      <input
                        type="text"
                        value={recipientDetails.name}
                        onChange={(e) =>
                          setRecipientDetails((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                        placeholder="Enter recipient name"
                         className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#111111] px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#DC2626]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        value={recipientDetails.phone}
                        onChange={(e) =>
                          setRecipientDetails((prev) => ({
                            ...prev,
                            phone: sanitizeRecipientPhone(e.target.value),
                          }))
                        }
                        placeholder="Enter recipient phone"
                         className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#111111] px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-[#DC2626]"
                      />
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      Agar aap kisi aur ke liye order kar rahe ho, to yahan uska naam aur phone save kar do.
                    </p>
                  </div>
                )}
              </div>
{/* Bill Details */}
              <div className="bg-white dark:bg-[#1a1a1a] px-4 md:px-6 py-5 rounded-2xl shadow-sm border border-slate-100 dark:border-gray-800">
                <button
                  onClick={() => setShowBillDetails(!showBillDetails)}
                  className="flex items-center justify-between w-full group focus:outline-none"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-gray-700 dark:text-gray-300 group-hover:text-[#DC2626] transition-colors" />
                    <span className="text-base text-gray-900 dark:text-gray-100 font-black tracking-tight group-hover:text-[#DC2626] transition-colors">Bill Details</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-black text-gray-900 dark:text-white">
                        {loadingPricing ? (
                          <span className="inline-block h-5 w-16 rounded bg-gray-200 dark:bg-gray-700 animate-pulse align-middle" />
                        ) : (
                          `${RUPEE_SYMBOL}${total.toFixed(2)}`
                        )}
                      </p>
                    </div>
                    <div className="w-7 h-7 rounded-full bg-slate-50 dark:bg-gray-800 group-hover:bg-[#DC2626]/5 flex items-center justify-center transition-all border border-slate-100 dark:border-gray-700 group-hover:border-[#DC2626]/20">
                      <ChevronRight className={`h-4 w-4 text-gray-500 group-hover:text-[#DC2626] transition-transform duration-300 ${showBillDetails ? 'rotate-90' : 'rotate-0'}`} />
                    </div>
                  </div>
                </button>

                {showBillDetails && (
                  <div className="mt-4 pt-4 border-t border-dashed border-gray-200 dark:border-gray-800 space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Item Total</span>
                      <span className="text-gray-800 dark:text-gray-200 font-medium">
                        {loadingPricing ? (
                          <span className="inline-block h-4 w-12 rounded bg-gray-200 dark:bg-gray-700 animate-pulse align-middle" />
                        ) : (
                          `${RUPEE_SYMBOL}${subtotal.toFixed(2)}`
                        )}
                      </span>
                    </div>

                    {orderType !== "takeaway" && (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600 dark:text-gray-400">Delivery Fee</span>
                           <span className={deliveryFee === 0 ? "text-[#DC2626] font-medium" : "text-gray-800 dark:text-gray-200 font-medium"}>
                             {loadingPricing ? (
                               <span className="inline-block h-4 w-12 rounded bg-gray-200 dark:bg-gray-700 animate-pulse align-middle" />
                             ) : (
                               deliveryFee === 0 ? "FREE" : `${RUPEE_SYMBOL}${deliveryFee.toFixed(2)}`
                             )}
                           </span>
                        </div>
                        {deliveryFeeBreakdownText && (
                          <div className="text-[11px] text-gray-500 dark:text-gray-400 -mt-1.5 ml-1 border-l-2 border-gray-100 pl-2">
                            {deliveryFeeBreakdownText}
                          </div>
                        )}
                        {Number((pricing?.freeDeliveryUpTo ?? feeSettings.freeDeliveryUpTo) || 0) > 0 && (
                          <div className="-mt-1.5">
                            <div className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#DC2626]/10 via-[#DC2626]/20 to-[#DC2626]/10 text-[#DC2626] border border-[#DC2626]/25 px-2.5 py-1 text-[11px] font-semibold shadow-sm">
                              <Sparkles className="h-3 w-3" />
                              <span>Free delivery at</span>
                              <span className="text-[#991B1B]">
                                {RUPEE_SYMBOL}{Number((pricing?.freeDeliveryUpTo ?? feeSettings.freeDeliveryUpTo) || 0).toFixed(0)}+
                              </span>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Removed TAKEAWAY ORDER badge from here */}
                    {platformFee > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400 font-medium">Platform Fee</span>
                        <span className="text-gray-800 dark:text-gray-200 font-bold">
                          {loadingPricing ? (
                            <span className="inline-block h-4 w-12 rounded bg-gray-200 dark:bg-gray-700 animate-pulse align-middle" />
                          ) : (
                            `${RUPEE_SYMBOL}${platformFee.toFixed(2)}`
                          )}
                        </span>
                      </div>
                    )}
                    {(packagingFee > 0 || gstCharges > 0) && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400 font-medium">GST and Restaurant Charges</span>
                        <span className="text-gray-800 dark:text-gray-200 font-bold">
                          {loadingPricing ? (
                            <span className="inline-block h-4 w-12 rounded bg-gray-200 dark:bg-gray-700 animate-pulse align-middle" />
                          ) : (
                            `${RUPEE_SYMBOL}${(packagingFee + gstCharges).toFixed(2)}`
                          )}
                        </span>
                      </div>
                    )}
                    {discount > 0 && (
                       <div className="flex justify-between text-sm text-[#DC2626] font-medium">
                         <span>Coupon Discount</span>
                         <span>
                           {loadingPricing ? (
                             <span className="inline-block h-4 w-12 rounded bg-[#DC2626]/20 animate-pulse align-middle" />
                           ) : (
                             `-${RUPEE_SYMBOL}${discount.toFixed(2)}`
                           )}
                         </span>
                       </div>
                    )}

                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* Bottom Sticky - Place Order */}
      <div
        className="bg-white dark:bg-[#1a1a1a] border-t dark:border-gray-800 shadow-lg z-30 flex-shrink-0 fixed bottom-0 left-0 right-0"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4">
          <div className="w-full max-w-lg mx-auto space-y-3">
            {/* Pay Using - Slim Pro UI */}
            <div
              className="flex items-center justify-between p-2 bg-gray-50 dark:bg-[#222222] rounded-xl border border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-100 dark:hover:bg-[#282828] active:scale-[0.98] transition-all duration-200 shadow-sm"
              onClick={() => setShowPaymentSheet(true)}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#DC262610] dark:bg-[#DC262620] flex items-center justify-center flex-shrink-0">
                   {selectedPaymentMethod === "wallet" ? (
                    <Wallet className="h-5 w-5 text-[#DC2626]" />
                  ) : selectedPaymentMethod === "razorpay" ? (
                    <Zap className="h-5 w-5 text-[#DC2626]" />
                  ) : (
                    <Banknote className="h-5 w-5 text-[#DC2626]" />
                  )}
                </div>
                <div className="leading-tight">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-bold opacity-80">
                    PAYING WITH
                  </p>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
                      {selectedPaymentLabel}
                    </p>
                    {selectedPaymentMethod === "wallet" && (
                      <p className="text-[10px] text-green-600 dark:text-green-400 font-bold bg-green-50 dark:bg-green-900/20 px-1 rounded">
                        {RUPEE_SYMBOL}{walletBalance.toFixed(0)}
                      </p>
                    )}
                  </div>
                </div>
              </div>

               <div className="flex items-center gap-0.5 text-[#DC2626] font-bold text-[11px] uppercase tracking-widest bg-[#DC262605] dark:bg-[#DC262610] px-2.5 py-1 rounded-lg">
                CHANGE <ChevronRight className="h-3.5 w-3.5" />
              </div>
            </div>

            {/* Place Order Button */}
            <button
              onClick={handlePlaceOrder}
              disabled={isPlacingOrder || loadingPricing || isCartZoneMismatch || (selectedPaymentMethod === "wallet" && walletBalance < total) || isRestaurantClosed}
              className="w-full bg-gradient-to-r from-[#DC2626] to-[#991B1B] hover:from-[#991B1B] hover:to-[#7F1D1D] text-white px-6 h-12 md:h-14 rounded-2xl font-black shadow-lg shadow-[#DC2626]/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between transition-all active:scale-[0.98] border-b-4 border-red-900/30"
            >
              {(selectedPaymentMethod === "razorpay" || selectedPaymentMethod === "wallet" || selectedPaymentMethod === "cash") && (
                <div className="text-left flex flex-col justify-center border-r-[1.5px] border-white/20 pr-4">
                  <span className="text-xs md:text-sm font-semibold text-white/90">{RUPEE_SYMBOL}{total.toFixed(2)}</span>
                  <span className="text-[9px] md:text-[10px] uppercase font-bold tracking-wider text-white/80 mt-[-2px]">Total</span>
                </div>
              )}
              <div className="flex items-center gap-1 mx-auto text-sm md:text-lg tracking-wide">
                {isRestaurantClosed
                  ? "Restaurant Closed"
                  : isCartZoneMismatch
                    ? "Not Deliverable Here"
                  : isPlacingOrder
                    ? "Processing..."
                  : loadingPricing
                    ? "Calculating..."
                    : (orderType !== "takeaway" && !hasSavedAddress)
                      ? "Select Address"
                      : "Place Order"}
                <div className="flex align-center h-full">
                  <ChevronRight className="h-4 w-4 md:h-5 md:w-5" />
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>

          {/* Placing Order Modal */}
          {showPlacingOrder && (
            <div className="fixed inset-0 z-[60] h-screen w-screen overflow-hidden">
              {/* Backdrop */}
              <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

              {/* Modal Sheet */}
              <div
                className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl overflow-hidden"
                style={{ animation: 'slideUpModal 0.4s cubic-bezier(0.16, 1, 0.3, 1)' }}
              >
                <div className="px-6 py-8">
                  {/* Title */}
                  <h2 className="text-2xl font-bold text-gray-900 mb-6">
                    {orderType === "takeaway" ? "Placing takeaway order" : "Placing your order"}
                  </h2>

                  {/* Payment Info */}
                  <div className="flex items-center gap-4 mb-5">
                    <div className="w-14 h-14 rounded-xl border border-gray-200 flex items-center justify-center bg-white shadow-sm">
                      <CreditCard className="w-6 h-6 text-gray-600" />
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-gray-900">
                        {selectedPaymentMethod === "razorpay"
                          ? `Pay ${RUPEE_SYMBOL}${total.toFixed(2)} online (Razorpay)`
                          : selectedPaymentMethod === "wallet"
                            ? `Pay ${RUPEE_SYMBOL}${total.toFixed(2)} from Wallet`
                            : `Pay on delivery (COD)`}
                      </p>
                    </div>
                  </div>

                  {/* Delivery Address */}
                  <div className="flex items-center gap-4 mb-8">
                    <div className="w-14 h-14 rounded-xl border border-gray-200 flex items-center justify-center bg-gray-50">
                      <svg className="w-7 h-7 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path d="M9 22V12h6v10" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-gray-900">
                        {orderType === "takeaway" ? "Picking up from Restaurant" : "Delivering to Location"}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">
                        {orderType === "takeaway" 
                          ? (restaurantData?.name || cart[0]?.restaurant || "Restaurant")
                          : (defaultAddress ? (formatFullAddress(defaultAddress) || defaultAddress?.formattedAddress || defaultAddress?.address || "Address") : "Add address")}
                      </p>
                      <p className="text-sm text-gray-500">
                        {orderType === "takeaway"
                          ? (restaurantData?.address || restaurantData?.location?.address || "Restaurant Address")
                          : (defaultAddress ? (formatFullAddress(defaultAddress) || "Address") : "Address")}
                      </p>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="relative mb-6">
                    <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                         className="h-full bg-gradient-to-r from-[#DC2626] to-[#991B1B] rounded-full transition-all duration-100 ease-linear"
                        style={{
                           width: `${orderProgress}%`,
                           boxShadow: '0 0 10px rgba(126, 56, 102, 0.5)'
                         }}
                      />
                    </div>
                    {/* Animated shimmer effect */}
                    <div
                      className="absolute inset-0 h-2.5 rounded-full overflow-hidden pointer-events-none"
                      style={{
                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
                        animation: 'shimmer 1.5s infinite',
                        width: `${orderProgress}%`
                      }}
                    />
                  </div>

                  {/* Cancel Button */}
                   <button
                    onClick={() => {
                      setShowPlacingOrder(false)
                      setIsPlacingOrder(false)
                    }}
                    className="w-full text-right"
                  >
                    <span className="text-[#DC2626] font-semibold text-base hover:text-[#991B1B] transition-colors">
                      CANCEL
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Savings Congratulations Page removed (other-platform compare-at discontinued) */}

          {/* Order Success Celebration Page */}
          {showOrderSuccess && (
            <div
              className="fixed inset-0 z-[70] bg-white dark:bg-[#0a0a0a] flex flex-col items-center justify-center h-screen w-screen overflow-hidden"
              style={{ animation: 'fadeIn 0.3s ease-out' }}
            >
              {/* Confetti Background */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                {/* Animated confetti pieces */}
                {[...Array(50)].map((_, i) => (
                  <div
                    key={i}
                    className="absolute w-3 h-3 rounded-sm"
                    style={{
                      left: `${Math.random() * 100}%`,
                      top: `-10%`,
                      backgroundColor: ['#DC2626', '#3b82f6', '#f59e0b', '#ef4444', '#991B1B', '#ec4899'][Math.floor(Math.random() * 6)],
                      animation: `confettiFall ${2 + Math.random() * 2}s linear ${Math.random() * 2}s infinite`,
                      transform: `rotate(${Math.random() * 360}deg)`,
                    }}
                  />
                ))}
              </div>

              {/* Success Content */}
              <div className="relative z-10 flex flex-col items-center px-6">
                {/* Success Tick Circle */}
                <div
                  className="relative mb-8"
                  style={{ animation: 'scaleIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s both' }}
                >
                  {/* Outer ring animation */}
                  <div
                    className="absolute inset-0 w-32 h-32 rounded-full border-4 border-green-500 dark:border-green-400"
                    style={{
                      animation: 'ringPulse 1.5s ease-out infinite',
                      opacity: 0.3
                    }}
                  />
                  {/* Main circle */}
                  <div className="w-32 h-32 bg-gradient-to-br from-green-500 to-green-600 dark:from-green-500 dark:to-emerald-500 rounded-full flex items-center justify-center shadow-2xl shadow-green-200/60 dark:shadow-green-900/40">
                    <svg
                      className="w-16 h-16 text-white"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ animation: 'checkDraw 0.5s ease-out 0.5s both' }}
                    >
                      <path d="M5 12l5 5L19 7" className="check-path" />
                    </svg>
                  </div>
                  {/* Sparkles */}
                  {[...Array(6)].map((_, i) => (
                    <div
                      key={i}
                      className="absolute w-2 h-2 bg-yellow-400 dark:bg-yellow-300 rounded-full"
                      style={{
                        top: '50%',
                        left: '50%',
                        animation: `sparkle 0.6s ease-out ${0.3 + i * 0.1}s both`,
                        transform: `rotate(${i * 60}deg) translateY(-80px)`,
                      }}
                    />
                  ))}
                </div>

                {/* Location Info */}
                <div
                  className="text-center"
                  style={{ animation: 'slideUp 0.5s ease-out 0.6s both' }}
                >
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <div className="w-5 h-5 text-red-500 dark:text-red-400">
                      {orderType === "takeaway" ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                          <polyline points="9 22 9 12 15 12 15 22" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                        </svg>
                      )}
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                      {orderType === "takeaway"
                        ? (restaurantData?.name || "Restaurant")
                        : (defaultAddress?.city || "Your Location")}
                    </h2>
                  </div>
                  <p className="text-gray-500 dark:text-gray-400 text-base max-w-sm mx-auto">
                    {orderType === "takeaway"
                      ? (restaurantData?.location
                          ? (restaurantData.location.addressLine1 || restaurantData.location.formattedAddress || restaurantData.location.address || `${restaurantData.location.city || ''}${restaurantData.location.area ? ', ' + restaurantData.location.area : ''}`)
                          : (restaurantData?.address || restaurantData?.formattedAddress || "Self-Pickup from Restaurant"))
                      : (defaultAddress ? (formatFullAddress(defaultAddress) || defaultAddress?.formattedAddress || defaultAddress?.address || "Delivery Address") : "Delivery Address")}
                  </p>
                </div>

                {/* Order Placed Message */}
                 <div
                  className="mt-12 text-center"
                  style={{ animation: 'slideUp 0.5s ease-out 0.8s both' }}
                >
                  <h3 className="text-3xl font-bold text-[#DC2626] dark:text-[#a65d8a] mb-2">Order Placed!</h3>
                  <p className="text-gray-600 dark:text-gray-300">
                    {orderType === "takeaway"
                      ? "Your delicious food is being prepared for pickup"
                      : "Your delicious food is on its way"}
                  </p>
                </div>

                {/* Action Button */}
                 <button
                  onClick={handleGoToOrders}
                  className="mt-10 bg-[#DC2626] hover:bg-[#991B1B] text-white font-semibold py-4 px-12 rounded-xl shadow-lg shadow-[#DC2626]/20 dark:shadow-[#DC2626]/40 transition-all hover:shadow-xl hover:scale-105"
                  style={{ animation: 'slideUp 0.5s ease-out 1s both' }}
                >
                  Track Your Order
                </button>
              </div>
            </div>
          )}

          {/* Payment Selection Bottom Sheet */}
          <AnimatePresence>
            {showPaymentSheet && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowPaymentSheet(false)}
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
                />
                <motion.div
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", damping: 30, stiffness: 350 }}
                  className="fixed bottom-0 left-0 right-0 bg-white dark:bg-[#1a1a1a] rounded-t-[2rem] z-[101] shadow-2xl overflow-hidden max-h-[82vh] md:max-h-[60vh] flex flex-col"
                  style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
                >
                  <div className="p-5 md:p-6 flex flex-col h-full min-h-0">
                    {/* Compact Drag handle */}
                    <div className="w-10 h-1 bg-gray-200 dark:bg-gray-800 rounded-full mx-auto mb-5" />

                    <div className="flex items-center justify-between mb-5">
                      <div>
                        <h2 className="text-xl font-extrabold text-gray-900 dark:text-white leading-none">Payment Method</h2>
                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-tighter mt-1">Select how you want to pay</p>
                      </div>
                      <button
                        onClick={() => setShowPaymentSheet(false)}
                        className="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      >
                        <X className="w-4 h-4 text-gray-500" />
                      </button>
                    </div>

                    <div className="space-y-3 overflow-y-auto pr-1 custom-scrollbar pb-4 flex-1 min-h-0">
                      {[
                        {
                          id: 'razorpay',
                          name: 'Online Payment',
                          description: 'UPI, Cards, Netbanking',
                          icon: <Zap className="w-5 h-5" />,
                          color: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
                          selectedColor: 'bg-emerald-500 text-white',
                          badge: 'SECURE',
                          disabled: !isPaymentMethodEnabled("razorpay"),
                          disabledText: 'Online Pay Disabled'
                        },
                        {
                          id: 'wallet',
                          name: 'Quick Wallet',
                          description: 'Pay from your wallet',
                          icon: <Wallet className="w-5 h-5" />,
                          color: 'bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400',
                          selectedColor: 'bg-blue-500 text-white',
                          subInfo: `Bal: ${RUPEE_SYMBOL}${walletBalance.toFixed(0)}`,
                          disabled: walletBalance < total || !isPaymentMethodEnabled("wallet"),
                          disabledText: !isPaymentMethodEnabled("wallet") ? 'Wallet Disabled' : 'Low Balance'
                        },
                        {
                          id: 'cash',
                          name: 'Cash on Delivery',
                          description: 'Pay when order arrives',
                          icon: <Banknote className="w-5 h-5" />,
                          color: 'bg-orange-50 text-#991B1B dark:bg-orange-900/40 dark:text-orange-400',
                          selectedColor: 'bg-[#DC2626] text-white',
                          disabled: !isPaymentMethodEnabled("cash"),
                          disabledText: 'COD Disabled',
                          hideWhenDisabled: true
                        }
                      ].filter(option => !option.hideWhenDisabled || !option.disabled).map((option) => (
                        <button
                          key={option.id}
                          onClick={() => {
                            if (!option.disabled) {
                              setSelectedPaymentMethod(option.id)
                              setShowPaymentSheet(false)
                            }
                          }}
                           className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all duration-300 group ${selectedPaymentMethod === option.id
                               ? 'border-[#DC2626] bg-[#DC2626] shadow-lg shadow-[#DC2626]/30'
                               : 'border-gray-100 dark:border-gray-800/80 bg-white dark:bg-[#222222] hover:border-[#DC2626]/30 dark:hover:border-[#DC2626]/30 shadow-sm'
                             } ${option.disabled ? 'opacity-40 grayscale-[0.8] cursor-not-allowed' : 'cursor-pointer active:scale-[0.98]'}`}
                        >
                          <div className="flex items-center gap-4">
                            <div className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300 ${selectedPaymentMethod === option.id
                                ? 'bg-white/20 text-white'
                                : option.color
                              }`}>
                              {option.icon}
                            </div>
                            <div className="text-left">
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-black tracking-tight leading-none transition-colors ${selectedPaymentMethod === option.id ? 'text-white' : 'text-gray-900 dark:text-gray-100'
                                  }`}>
                                  {option.name}
                                </span>
                                {option.badge && (
                                  <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full shadow-sm tracking-wider ${selectedPaymentMethod === option.id
                                      ? 'bg-white/20 text-white'
                                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                    }`}>
                                    {option.badge}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-1">
                                <p className={`text-[11px] font-bold transition-colors ${selectedPaymentMethod === option.id ? 'text-white/80' : 'text-gray-400'
                                  }`}>
                                  {option.description}
                                </p>
                                {option.subInfo && !option.disabled && (
                                  <>
                                    <span className={`w-1 h-1 rounded-full ${selectedPaymentMethod === option.id ? 'bg-white/40' : 'bg-orange-300 dark:bg-orange-700'
                                      }`} />
                                    <p className={`text-[10px] font-black uppercase tracking-tighter transition-colors ${selectedPaymentMethod === option.id ? 'text-white' : 'text-green-600 dark:text-green-500'
                                      }`}>
                                      {option.subInfo}
                                    </p>
                                  </>
                                )}
                              </div>
                              {option.disabled && (
                                <p className="text-[9px] font-black text-red-500 mt-1 uppercase tracking-wide">
                                  {option.disabledText}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${selectedPaymentMethod === option.id
                              ? 'bg-white border-white'
                              : 'border-gray-200 dark:border-gray-700'
                            }`}>
                             {selectedPaymentMethod === option.id && <Check className="w-3.5 h-3.5 text-[#DC2626]" strokeWidth={4} />}
                           </div>
                        </button>
                      ))}
                    </div>

                    <div
                      className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center gap-4 bg-white dark:bg-[#1a1a1a]"
                      style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom, 0px))" }}
                    >
                      <div className="flex-shrink-0">
                         <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Total Pay</p>
                         <p className="text-xl font-black text-[#DC2626] tabular-nums">{RUPEE_SYMBOL}{total.toFixed(0)}</p>
                       </div>
                       <Button
                        onClick={() => setShowPaymentSheet(false)}
                        className="flex-1 bg-[#DC2626] hover:bg-[#991B1B] text-white h-11 rounded-xl text-sm font-bold shadow-lg shadow-[#DC2626]/20 transition-all active:scale-[0.98]"
                      >
                        Confirm Order
                      </Button>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Animation Styles */}
          <style>{`
        @keyframes fadeInBackdrop {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUpBannerSmooth {
          from { transform: translateY(100%) scale(0.95); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes slideUpBanner {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes shimmerBanner {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes scaleInBounce {
          0% { transform: scale(0); opacity: 0; }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes pulseRing {
          0% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.4); opacity: 0; }
          100% { transform: scale(1); opacity: 0; }
        }
        @keyframes checkMarkDraw {
          0% { stroke-dasharray: 100; stroke-dashoffset: 100; opacity: 0; }
          50% { opacity: 1; }
          100% { stroke-dasharray: 100; stroke-dashoffset: 0; opacity: 1; }
        }
        @keyframes slideUpFull {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes slideUpModal {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { transform: scale(0); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes checkDraw {
          0% { stroke-dasharray: 100; stroke-dashoffset: 100; }
          100% { stroke-dasharray: 100; stroke-dashoffset: 0; }
        }
        @keyframes ringPulse {
          0% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.3); opacity: 0; }
          100% { transform: scale(1); opacity: 0; }
        }
        @keyframes sparkle {
          0% { transform: rotate(var(--rotation, 0deg)) translateY(0) scale(0); opacity: 1; }
          100% { transform: rotate(var(--rotation, 0deg)) translateY(-80px) scale(1); opacity: 0; }
        }
        @keyframes slideUp {
          from { transform: translateY(30px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes confettiFall {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
        }
        .animate-slideUpFull {
          animation: slideUpFull 0.3s ease-out;
        }
        .check-path {
          stroke-dasharray: 100;
          stroke-dashoffset: 0;
        }
      `}</style>

      {/* All Coupons Bottom Sheet */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showCouponSheet && !appliedCoupon && !isCartUnavailable && (
              <>
                <motion.div
                  className="fixed inset-0 bg-black/60 z-[10020]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowCouponSheet(false)}
                />
                <div className="fixed inset-0 flex items-end justify-center z-[10021] pointer-events-none p-0">
                  <motion.div
                    className="relative w-full max-w-lg pointer-events-auto bg-white dark:bg-[#1a1a1a] rounded-t-3xl shadow-2xl border border-gray-100 dark:border-gray-800 flex flex-col max-h-[85vh]"
                    initial={{ y: "100%" }}
                    animate={{ y: 0 }}
                    exit={{ y: "100%" }}
                    transition={{ type: "spring", damping: 30, stiffness: 300 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-5 pt-5 pb-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">All Offers & Coupons</h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {filteredCoupons.length} offer{filteredCoupons.length === 1 ? "" : "s"} available
                        </p>
                      </div>
                      <button
                        onClick={() => setShowCouponSheet(false)}
                        className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                        aria-label="Close coupons"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/30">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-white dark:bg-gray-950 rounded-xl px-4 h-11 border border-gray-200 dark:border-gray-800 flex items-center focus-within:border-[#DC2626] focus-within:ring-1 focus-within:ring-[#DC2626]/20 transition-all">
                          <input
                            type="text"
                            value={manualCouponCode}
                            onChange={(e) => setManualCouponCode(e.target.value.toUpperCase())}
                            placeholder="Enter coupon code"
                            className="w-full bg-transparent text-sm font-semibold text-gray-800 dark:text-gray-100 outline-none placeholder:text-gray-400/85"
                          />
                        </div>
                        <button
                          onClick={handleApplyCouponCode}
                          disabled={isCartUnavailable}
                          className="h-11 px-5 border border-[#DC2626] text-[#DC2626] rounded-xl text-xs font-black uppercase tracking-widest hover:bg-[#DC262605] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Apply
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                      {loadingCoupons ? (
                        <div className="py-10 text-center text-sm text-gray-500">Loading offers...</div>
                      ) : filteredCoupons.length > 0 ? (
                        filteredCoupons.map((coupon) =>
                          renderCartCouponCard(coupon, { blocked: isCartUnavailable }),
                        )
                      ) : (
                        <div className="py-10 text-center text-sm text-gray-500">
                          No offers available right now. You can still enter a coupon code above.
                        </div>
                      )}
                    </div>
                  </motion.div>
                </div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}

      {/* Share Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showShareModal && sharePayload && (
              <>
                <motion.div
                  className="fixed inset-0 bg-black/50 z-[10020]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowShareModal(false)}
                />
                <motion.div
                  className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[10021] w-[92vw] max-w-md bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.16 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">Share</h3>
                    <button
                      className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                      onClick={() => setShowShareModal(false)}
                      aria-label="Close share modal"
                    >
                      <X className="h-4 w-4 text-gray-600 dark:text-gray-300" />
                    </button>
                  </div>

                  <div className="px-5 py-4 space-y-2">
                    {typeof navigator !== "undefined" && navigator.share && (
                      <button
                        className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                        onClick={handleSystemShareFromModal}
                      >
                        <Share2 className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">Share via system apps</span>
                      </button>
                    )}
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={() => openShareTarget("whatsapp")}
                    >
                      <MessageCircle className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">WhatsApp</span>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={() => openShareTarget("telegram")}
                    >
                      <Send className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Telegram</span>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={() => openShareTarget("email")}
                    >
                      <Mail className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Email</span>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-left"
                      onClick={copyShareLink}
                    >
                      <Copy className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Copy link</span>
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

        {/* Auto Apply Coupon Popup Sheet */}
        {createPortal(
          <AnimatePresence>
            {showAutoCouponPopup && bestCoupon && !isCartUnavailable && (
              <>
                {/* Backdrop Overlay */}
                <motion.div
                  className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-[10020] cursor-pointer"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowAutoCouponPopup(false)}
                />
                
                {/* Modal Layout Wrapper */}
                <div className="fixed inset-0 flex items-end sm:items-center justify-center z-[10021] pointer-events-none sm:p-4">
                  {/* Modal Card */}
                  <motion.div
                    className="w-full sm:max-w-md bg-white dark:bg-[#1a1a1a] rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 flex flex-col items-center justify-between pb-8 sm:pb-6 relative pointer-events-auto"
                    initial={{ y: "100%", opacity: 0.5 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: "100%", opacity: 0.5 }}
                    transition={{ type: "spring", damping: 28, stiffness: 240 }}
                  >
                    {/* Background overlay with overflow-hidden to clip sunburst rays */}
                    <div className="absolute inset-0 rounded-t-3xl sm:rounded-3xl overflow-hidden pointer-events-none z-0">
                      {/* Soft radial blue glow */}
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.08)_0%,transparent_75%)]" />
                      
                      {/* Spinning SVG Sunburst rays */}
                      <svg className="absolute left-1/2 -translate-x-1/2 -top-16 w-80 h-80 animate-[spin_80s_linear_infinite] opacity-30 text-blue-500/10" viewBox="0 0 100 100" fill="currentColor">
                        <g opacity="0.12">
                          <path d="M50 50 L45 0 L55 0 Z" />
                          <path d="M50 50 L95 15 L100 25 Z" />
                          <path d="M50 50 L100 45 L100 55 Z" />
                          <path d="M50 50 L95 85 L85 95 Z" />
                          <path d="M50 50 L55 100 L45 100 Z" />
                          <path d="M50 50 L5 85 L0 75 Z" />
                          <path d="M50 50 L0 55 L0 45 Z" />
                          <path d="M50 50 L5 15 L15 5 Z" />
                          <path d="M50 50 L75 5 L85 15 Z" />
                          <path d="M50 50 L100 75 L95 85 Z" />
                          <path d="M50 50 L25 95 L15 85 Z" />
                          <path d="M50 50 L0 25 L5 15 Z" />
                        </g>
                      </svg>
                    </div>

                    {/* Absolute close button */}
                    <motion.button
                      onClick={() => setShowAutoCouponPopup(false)}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.15 }}
                      className="absolute bottom-[calc(100%+16px)] left-1/2 -translate-x-1/2 sm:bottom-auto sm:top-4 sm:right-4 sm:left-auto sm:translate-x-0 w-12 h-12 sm:w-8 sm:h-8 rounded-full bg-neutral-800/80 backdrop-blur-sm border border-white/15 sm:border-0 sm:bg-gray-100 sm:dark:bg-gray-800 flex items-center justify-center text-white sm:text-gray-500 sm:dark:text-gray-400 hover:bg-neutral-700/80 sm:hover:bg-gray-200 sm:dark:hover:bg-gray-700 transition-colors z-50 cursor-pointer shadow-lg"
                    >
                      <X className="h-5 w-5 sm:h-4 sm:w-4" />
                    </motion.button>



                    {/* Coupon Icon with Sunburst Effect */}
                    <div className="w-full flex flex-col items-center justify-center pt-6 pb-2 relative z-10 flex-shrink-0">
                      <div className="relative z-10 w-24 h-24 flex-shrink-0 flex items-center justify-center">
                        {/* Outer glow */}
                        <div className="absolute inset-0 rounded-full bg-blue-500/20 blur-xl animate-pulse" />
                        
                        {/* Scalloped Badge SVG */}
                        <svg className="w-20 h-20 flex-shrink-0 text-[#3B82F6] dark:text-blue-500 drop-shadow-xl" viewBox="0 0 100 100" fill="currentColor">
                          <path d="M 86.29 42.78 Q 95.00 50.00 86.29 57.22 Q 91.57 67.22 80.76 70.56 Q 81.82 81.82 70.56 80.76 Q 67.22 91.57 57.22 86.29 Q 50.00 95.00 42.78 86.29 Q 32.78 91.57 29.44 80.76 Q 18.18 81.82 19.24 70.56 Q 8.43 67.22 13.71 57.22 Q 5.00 50.00 13.71 42.78 Q 8.43 32.78 19.24 29.44 Q 18.18 18.18 29.44 19.24 Q 32.78 8.43 42.78 13.71 Q 50.00 5.00 57.22 13.71 Q 67.22 8.43 70.56 19.24 Q 81.82 18.18 80.76 29.44 Q 91.57 32.78 86.29 42.78 Z" />
                        </svg>
                        
                        <Percent className="absolute w-9 h-9 text-white font-bold drop-shadow-md" />
                      </div>
                    </div>

                    {/* Exclusive Tag */}
                    <span className="text-[11px] font-bold text-gray-800 dark:text-gray-200 tracking-[0.2em] uppercase mt-4 flex items-center gap-1.5 justify-center relative z-10">
                      ✦ EXCLUSIVELY FOR YOU ✦
                    </span>

                    {/* Savings text */}
                    <h3 className="text-2xl font-black text-gray-900 dark:text-gray-100 mt-3 text-center leading-tight relative z-10">
                      Save <span className="text-[#3B82F6] dark:text-blue-400 font-extrabold">{RUPEE_SYMBOL}{bestCouponDiscount}</span> on this order
                    </h3>

                    {/* Coupon code name */}
                    <p className="text-sm font-semibold text-gray-500 dark:text-gray-400 mt-1.5 text-center relative z-10">
                      with coupon '<span className="text-gray-900 dark:text-gray-200 font-extrabold uppercase">{bestCoupon.code}</span>'
                    </p>

                    {/* Tip */}
                    <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 mt-5 text-center relative z-10">
                      Tap on 'APPLY' to avail this
                    </p>

                    {/* Apply Button */}
                    <button
                      onClick={handleApplyAutoCoupon}
                      className="w-full mt-6 h-12 bg-[#DC2626] hover:bg-[#B91C1C] text-white rounded-xl text-sm font-bold uppercase tracking-widest active:scale-95 transition-all shadow-md shadow-[#DC2626]/20 relative z-10 cursor-pointer"
                    >
                      APPLY
                    </button>
                  </motion.div>
                </div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

        {/* Placing Order Loading Overlay */}
        {createPortal(
          <AnimatePresence>
            {isPlacingOrder && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100000] bg-white/90 dark:bg-black/90 backdrop-blur-md flex flex-col items-center justify-center pointer-events-auto"
              >
                <div className="flex flex-col items-center gap-4 text-center px-6">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full border-4 border-gray-200 dark:border-gray-800" />
                    <div className="absolute inset-0 w-16 h-16 rounded-full border-4 border-t-[#DC2626] dark:border-t-red-500 animate-spin" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white mt-4">
                    Placing Your Order...
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
                    {selectedPaymentMethod === "razorpay" 
                      ? "Please wait while we verify your payment. Do not close or refresh the page."
                      : "We are creating your order. Please wait."}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  )
}      

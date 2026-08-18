import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useNavigate } from "react-router-dom"
import { 
  User,
  Utensils,
  Megaphone,
  Settings,
  Monitor,
  Plus,
  Grid3x3,
  Tag,
  FileText,
  MessageSquare,
  Shield,
  Globe,
  MessageCircle,
  CheckSquare,
  LogOut,
  LogIn,
  UserPlus,
  Trash2,
  AlertTriangle,
} from "lucide-react"
import { authAPI, restaurantAPI } from "@food/api"
import { toast } from "sonner"
import { clearModuleAuth } from "@food/utils/auth"

export default function MenuOverlay({ showMenu, setShowMenu }) {
  const navigate = useNavigate()
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem("restaurant_authenticated") === "true"
  })
  const [deleteCaptcha, setDeleteCaptcha] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false)
  const [showBalanceWarning, setShowBalanceWarning] = useState(false)
  const [balanceData, setBalanceData] = useState({ balance: 0, type: "Restaurant Available Balance" })
  const [isCheckingBalance, setIsCheckingBalance] = useState(false)

  const handleDeleteAccountClick = async () => {
    if (isCheckingBalance) return
    setShowMenu(false)
    setIsCheckingBalance(true)
    try {
      const response = await authAPI.checkBalance("restaurant")
      const payload = response?.data?.data ?? response?.data ?? {}
      const balance = Number(payload.balance || 0)
      const type = payload.type || "Restaurant Available Balance"
      setDeleteCaptcha("")
      if (balance > 0) {
        setBalanceData({ balance, type })
        setShowBalanceWarning(true)
        return
      }
      setDeleteAccountOpen(true)
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not verify your available balance")
    } finally {
      setIsCheckingBalance(false)
    }
  }

  // Lock scroll when any popup is open
  useEffect(() => {
    const isPopupOpen = showMenu || deleteAccountOpen || showBalanceWarning;
    if (isPopupOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [showMenu, deleteAccountOpen, showBalanceWarning]);

  // Listen for authentication state changes
  useEffect(() => {
    const checkAuth = () => {
      setIsAuthenticated(localStorage.getItem("restaurant_authenticated") === "true")
    }

    // Check on mount
    checkAuth()

    // Listen for storage changes
    window.addEventListener('storage', checkAuth)
    
    // Custom event for same-tab updates
    window.addEventListener('restaurantAuthChanged', checkAuth)

    return () => {
      window.removeEventListener('storage', checkAuth)
      window.removeEventListener('restaurantAuthChanged', checkAuth)
    }
  }, [])

  // Get menu options based on authentication state
  const getMenuOptions = () => {
    const baseOptions = [
      { id: 4, name: "All Food", icon: Utensils, route: "/food/restaurant/food/all" },
      { id: 6, name: "Restaurant Config", icon: Settings, route: "/food/restaurant/config" },
      { id: 7, name: "Advertisements", icon: Monitor, route: "/food/restaurant/advertisements" },
      { id: 9, name: "Categories", icon: Grid3x3, route: "/food/restaurant/categories" },
      { id: 10, name: "Coupon", icon: Tag, route: "/food/restaurant/coupon" },
      { id: 11, name: "My Business Plan", icon: FileText, route: "/food/restaurant/business-plan" },
      { id: 12, name: "Reviews", icon: MessageSquare, route: "/food/restaurant/reviews" },
      { id: 14, name: "Wallet Method", icon: Settings, route: "/food/restaurant/wallet" },
      { id: 16, name: "Settings", icon: Settings, route: "/food/restaurant/settings" },
      { id: 17, name: "Conversation", icon: MessageCircle, route: "/food/restaurant/conversation" },
      { id: 18, name: "Privacy Policy", icon: Shield, route: "/food/restaurant/privacy" },
      { id: 19, name: "Terms & Condition", icon: CheckSquare, route: "/food/restaurant/terms" },
    ]

    if (isAuthenticated) {
      // If authenticated, show logout at the end
      return [
        ...baseOptions,
        { id: 21, name: "Delete Account", icon: Trash2, route: "/delete", isDelete: true },
        { id: 20, name: "Logout", icon: LogOut, route: "/logout", isLogout: true },
      ]
    } else {
      // If not authenticated, show only login at the top
      return [
        { id: 1, name: "Login", icon: LogIn, route: "/food/restaurant/login" },
        ...baseOptions
      ]
    }
  }

  const menuOptions = getMenuOptions()

  return (
    <>
    <AnimatePresence mode="wait">
      {showMenu && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={() => setShowMenu(false)}
            className="fixed inset-0 bg-black/50/40 z-[100] backdrop-blur-sm"
          />
          
          {/* Menu Sheet - Full bottom slide */}
          <motion.div
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ 
              type: "spring", 
              damping: 25, 
              stiffness: 300,
              mass: 0.8
            }}
            onClick={(e) => e.stopPropagation()}
            className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl z-[110] max-h-[90vh] overflow-hidden"
          >
            {/* Drag Handle */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, duration: 0.3 }}
              className="flex justify-center pt-3 pb-3"
            >
              <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
            </motion.div>

            {/* Menu Grid - Improved Layout */}
            <div className="px-4 pb-20 md:pb-6 pt-2 overflow-y-auto max-h-[calc(90vh-60px)] scrollbar-hide scroll-smooth">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15, duration: 0.3 }}
                className="grid grid-cols-3 gap-3 md:gap-4"
              >
                {menuOptions.map((option, index) => {
                  const IconComponent = option.icon
                  return (
                    <motion.button
                      key={option.id}
                      initial={{ opacity: 0, y: 20, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ 
                        duration: 0.3, 
                        delay: 0.2 + (index * 0.02),
                        type: "spring",
                        stiffness: 200,
                        damping: 20
                      }}
                      whileHover={{ scale: 1.03, y: -2 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => {
                        if (option.isDelete) {
                          handleDeleteAccountClick()
                        } else {
                          setShowMenu(false)
                          if (option.isLogout) {
                          // Handle logout
                          if (window.confirm("Are you sure you want to logout?")) {
                            // Clear authentication state
                            localStorage.removeItem("restaurant_authenticated")
                            localStorage.removeItem("restaurant_user")
                            setIsAuthenticated(false)
                            // Dispatch custom event for same-tab updates
                            window.dispatchEvent(new Event('restaurantAuthChanged'))
                            // Redirect to login
                            navigate("/food/restaurant/login")
                          }
                        } else {
                          navigate(option.route)
                        }
                        }
                      }}
                      className={`flex flex-col items-center justify-center gap-2 p-3 md:p-4 rounded-xl transition-all shadow-md hover:shadow-lg ${
                        option.isLogout
                          ? "bg-gray-800 hover:bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white"
                          : option.isDelete
                          ? "bg-[#FF3131] hover:bg-[#D41B1B] text-white"
                          : "bg-gradient-to-br from-[#ff8100] to-[#ff9500] hover:from-[#e67300] hover:to-[#e68500] text-white"
                      }`}
                    >
                      <motion.div
                        initial={{ scale: 0, rotate: -180 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ 
                          delay: 0.25 + (index * 0.02),
                          type: "spring",
                          stiffness: 200,
                          damping: 15
                        }}
                        className="flex items-center justify-center"
                      >
                        {isCheckingBalance && option.isDelete ? (
                          <div className="w-5 h-5 md:w-6 md:h-6 border-2 border-white/30 border-t-white rounded-full animate-spin flex-shrink-0" />
                        ) : (
                          <IconComponent className="w-5 h-5 md:w-6 md:h-6 text-white flex-shrink-0" />
                        )}
                      </motion.div>
                      <motion.span 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.35 + (index * 0.02), duration: 0.2 }}
                        className="text-[10px] md:text-[11px] font-semibold text-white text-center leading-tight px-1"
                        style={{ 
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                      >
                        {option.name}
                      </motion.span>
                    </motion.button>
                  )
                })}
              </motion.div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>

    {/* Balance Warning Popup */}
    <AnimatePresence>
      {showBalanceWarning && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50/60 z-[200] backdrop-blur-sm"
            onClick={() => setShowBalanceWarning(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed inset-0 flex items-center justify-center z-[201] px-4"
          >
            <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6 text-center border border-orange-100">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8 text-orange-600" />
                </div>
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Wait! Balance Found</h3>
              
              <div className="bg-gray-50 rounded-2xl p-4 mb-5 text-center">
                <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1">{balanceData.type}</p>
                <p className="text-[#B80B3D]xl font-black text-black">₹{balanceData.balance.toLocaleString('en-IN')}</p>
              </div>

              <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                You still have unsettled payout available to withdraw. Continue deleting your account or go to Payout to withdraw first.
              </p>

              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    setShowBalanceWarning(false);
                    setDeleteCaptcha("");
                    setDeleteAccountOpen(true);
                  }}
                  className="w-full h-12 rounded-xl bg-gray-100 text-gray-700 font-bold hover:bg-gray-200 transition-colors"
                >
                  Continue Anyway
                </button>
                <button
                  onClick={() => {
                    setShowBalanceWarning(false);
                    navigate("/food/restaurant/hub-finance");
                  }}
                  className="w-full h-12 rounded-xl bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white font-bold hover:bg-gradient-to-br from-[#B80B3D] to-[#66001D] transition-colors"
                >
                  Go to Payout
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>

    {deleteAccountOpen && (
      <div
        className="fixed inset-0 z-[200] overflow-y-auto bg-black/60 backdrop-blur-sm"
      >
        <div className="flex min-h-screen items-center justify-center p-4 py-10">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                <Trash2 className="w-8 h-8 text-[#B80B3D]" />
              </div>
            </div>

            <h3 className="text-xl font-bold text-gray-900 mb-2">Delete Your Account?</h3>
            <p className="text-sm text-gray-500 mb-5 leading-relaxed">
              Are you sure you want to delete your account?
            </p>

            <div className="mb-5 bg-red-50 border-l-4 border-red-500 rounded-r-xl p-3 text-left">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-[#B80B3D] flex-shrink-0" />
                <span className="text-xs font-bold text-red-700 uppercase tracking-wider">Warning</span>
              </div>
              <p className="text-[11px] text-red-800 font-medium leading-tight">
                Your account will be Deleted. Admin will keep your historical records for revenue reporting.
              </p>
            </div>

            {/* Input field */}
            <div className="mb-6">
              <input 
                type="text" 
                placeholder="Type DELETE to confirm" 
                value={deleteCaptcha}
                onChange={(e) => setDeleteCaptcha(e.target.value.toUpperCase())}
                className="w-full h-12 px-4 rounded-xl border-2 border-gray-100 focus:border-[#B80B3D] focus:ring-4 focus:ring-red-50 outline-none transition-all font-bold text-center tracking-widest placeholder:tracking-normal placeholder:font-medium placeholder:text-gray-400"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setDeleteAccountOpen(false)}
                disabled={isDeleting}
                className="flex-1 h-12 rounded-xl border-2 border-gray-200 text-gray-800 font-bold text-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                No, Cancel
              </button>
              <button
                onClick={async () => {
                  if (isDeleting || deleteCaptcha !== "DELETE") return;
                  setIsDeleting(true);
                  try {
                    await authAPI.deleteAccount("restaurant");
                    toast.success("Account deleted successfully");
                    clearModuleAuth("restaurant");
                    localStorage.removeItem("restaurant_authenticated");
                    localStorage.removeItem("restaurant_user");
                    setIsAuthenticated(false);
                    window.dispatchEvent(new Event('restaurantAuthChanged'));
                    window.location.href = "/food/restaurant/login";
                  } catch (err) {
                    toast.error(err?.response?.data?.message || "Failed to delete account");
                  } finally {
                    setIsDeleting(false);
                    setDeleteAccountOpen(false);
                  }
                }}
                disabled={isDeleting || deleteCaptcha !== "DELETE"}
                className="flex-1 h-12 rounded-xl bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white font-bold text-sm transition-all hover:bg-red-700 active:scale-95 disabled:opacity-50"
              >
                {isDeleting ? "Deleting..." : "Delete Account"}
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    )}
    </>
  )
}









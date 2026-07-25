import { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, ChevronDown, Search, Mic, Bell, CheckCircle2, Tag, Gift, AlertCircle, Clock, BellOff, X, ChevronRight, ShoppingBag, Menu } from 'lucide-react';
import { Badge } from "@food/components/ui/badge";
import { Avatar, AvatarFallback } from "@food/components/ui/avatar";
import foodIcon from "@food/assets/category-icons/food.png";
import quickIcon from "@food/assets/category-icons/quick.png";
import taxiIcon from "@food/assets/category-icons/taxi.png";
import hotelIcon from "@food/assets/category-icons/hotel.png";
import useNotificationInbox from "@food/hooks/useNotificationInbox";
import { useSearchOverlay } from "../UserLayout";
const ICON_MAP = {
  CheckCircle2,
  Tag,
  Gift,
  AlertCircle
};



export default function HomeHeader({ 
  activeTab,
  setActiveTab,
  location, 
  savedAddressText, 
  handleLocationClick, 
  handleSearchFocus, 
  placeholderIndex, 
  placeholders,
  handleVegModeChange,
  isVegMode,
  vegModeToggleRef,
  isCategoryStuck = false,
  topBanners = [],
  topBannersLoaded = false,
}) {
  const { startVoiceSearch } = useSearchOverlay();
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState(() => {
    const saved = localStorage.getItem('food_user_notifications');
    return saved ? JSON.parse(saved) : [];
  });
  const {
    items: broadcastNotifications,
    unreadCount: broadcastUnreadCount,
    dismiss: dismissBroadcastNotification,
  } = useNotificationInbox("user", { limit: 20 });

  useEffect(() => {
    const syncNotifications = () => {
      const saved = localStorage.getItem('food_user_notifications');
      setNotifications(saved ? JSON.parse(saved) : []);
    };

    // Listen for updates from the main Notifications page
    window.addEventListener('notificationsUpdated', syncNotifications);
    // Also listen for new notifications being added via listeners in Notifications.jsx (indirectly via localStorage update)
    // But since localStorage doesn't fire events on same window, we can use a custom event or a simple interval if needed.
    // However, the Notifications.jsx already multi-dispatches.
    
    return () => window.removeEventListener('notificationsUpdated', syncNotifications);
  }, []);

  const festCategories = [
    { id: "food", name: "Food", icon: foodIcon, bgColor: "bg-white dark:bg-[#1a1a1a]" },
    { id: "quick", name: "Quick", icon: quickIcon, bgColor: "bg-white dark:bg-[#1a1a1a]" },
    { id: "taxi", name: "Taxi", icon: taxiIcon, bgColor: "bg-white dark:bg-[#1a1a1a]" },
    { id: "hotel", name: "Hotel", icon: hotelIcon, bgColor: "bg-white dark:bg-[#1a1a1a]" },
  ];

  const mergedNotifications = useMemo(() => {
    const localItems = Array.isArray(notifications)
      ? notifications.map((item) => ({ ...item, source: "local" }))
      : [];
    const broadcastItems = (broadcastNotifications || []).map((item) => ({
      ...item,
      source: "broadcast",
      time: item.createdAt
        ? new Date(item.createdAt).toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          })
        : "Just now",
      type: "broadcast",
      icon: "Bell",
      iconColor: "text-blue-600",
    }));

    return [...broadcastItems, ...localItems].sort(
      (a, b) =>
        new Date(b.createdAt || b.timestamp || 0).getTime() -
        new Date(a.createdAt || a.timestamp || 0).getTime()
    );
  }, [broadcastNotifications, notifications]);

  const unreadCount = notifications.filter(n => !n.read).length + broadcastUnreadCount;

  const handleDeleteNotification = (id, source = "local") => {
    if (source === "broadcast") {
      dismissBroadcastNotification(id);
      return;
    }
    setNotifications((prev) => {
      const next = prev.filter((notification) => notification.id !== id);
      localStorage.setItem('food_user_notifications', JSON.stringify(next));
      window.dispatchEvent(new CustomEvent('notificationsUpdated', { detail: { count: next.filter((n) => !n.read).length } }));
      return next;
    });
  };

  const [currentSlide, setCurrentSlide] = useState(0);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const notificationsHistoryPushedRef = useRef(false);
  const touchStartXRef = useRef(0);
  const touchEndXRef = useRef(0);

  const hasDynamicBanners = Array.isArray(topBanners) && topBanners.length > 0;

  useEffect(() => {
    const slideCount = hasDynamicBanners ? topBanners.length : 0;

    if (slideCount <= 1) {
      setCurrentSlide(0);
      return;
    }

    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return
      setCurrentSlide((prev) => (prev + 1) % slideCount);
    }, 4000);

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        setCurrentSlide((prev) => (prev + 1) % slideCount);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hasDynamicBanners, topBanners]);

  const handleTouchStart = (event) => {
    touchStartXRef.current = event.touches[0]?.clientX || 0;
    touchEndXRef.current = touchStartXRef.current;
  };

  const handleTouchMove = (event) => {
    touchEndXRef.current = event.touches[0]?.clientX || touchEndXRef.current;
  };

  const handleTouchEnd = () => {
    const deltaX = touchStartXRef.current - touchEndXRef.current;
    const minSwipeDistance = 45;

    if (Math.abs(deltaX) < minSwipeDistance) return;

    if (deltaX > 0) {
      // Swipe left -> next slide
      setCurrentSlide((prev) => (prev + 1) % displayBanners.length);
      return;
    }

    // Swipe right -> previous slide
    setCurrentSlide((prev) => (prev - 1 + displayBanners.length) % displayBanners.length);
  };

  useEffect(() => {
    if (!isNotificationsOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    if (!notificationsHistoryPushedRef.current) {
      window.history.pushState({ notificationsPopup: true }, "");
      notificationsHistoryPushedRef.current = true;
    }

    const handlePopState = () => {
      notificationsHistoryPushedRef.current = false;
      setIsNotificationsOpen(false);
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isNotificationsOpen]);

  const closeNotifications = (useHistoryBack = true) => {
    if (useHistoryBack && notificationsHistoryPushedRef.current) {
      notificationsHistoryPushedRef.current = false;
      window.history.back();
      return;
    }
    setIsNotificationsOpen(false);
  };

  const displayBanners = hasDynamicBanners
    ? topBanners.map((banner, index) => ({
        id: index,
        bg: "bg-gray-100 dark:bg-gray-800",
        content: (
          <img 
            src={banner.image || banner.imageUrl} 
            alt={`Banner ${index + 1}`} 
            className="absolute inset-0 w-full h-full object-cover" 
          />
        )
      }))
    : [];

  return (
    <>
      <div className="w-full bg-gradient-to-b from-amber-50/40 via-white to-white dark:from-[#1a1a1a] dark:via-[#0a0a0a] dark:to-[#0a0a0a] pb-3">
        
        {/* Static Location Row */}
        <div className="px-4 pt-5 pb-3 flex items-center justify-between gap-3 md:hidden">
          <div 
            className="flex items-center gap-1.5 cursor-pointer group min-w-0 flex-1"
            onClick={handleLocationClick}
          >
            <div className="bg-[#E2AD4B]/10 p-1.5 rounded-full border border-[#E2AD4B]/20 hover:bg-[#E2AD4B]/20 transition-colors shadow-sm dark:bg-black/20 dark:border-white/10 dark:hover:bg-white/10 flex-shrink-0">
              <MapPin className="h-4 w-4 text-[#E2AD4B] dark:text-white" />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                <span className="text-[10px] font-bold text-gray-500 dark:text-white/80 uppercase tracking-wider">Deliver to</span>
                <ChevronDown className="h-2.5 w-2.5 text-gray-500 dark:text-white/80" />
              </div>
              <span className="text-sm font-bold text-gray-900 dark:text-white truncate drop-shadow-sm max-w-full">
                {savedAddressText || (location?.area && location?.city 
                  ? `${location.area}, ${location.city}` 
                  : location?.area || location?.city || "Select Location")}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-2 flex-shrink-0">
            <div
              onClick={() => setIsNotificationsOpen(true)}
              className="h-10 w-10 relative flex items-center justify-center rounded-full bg-gray-100 border border-gray-200 shadow-sm cursor-pointer active:scale-95 transition-all hover:bg-gray-200 dark:bg-black/20 dark:border-white/10 dark:hover:bg-white/10 flex-shrink-0"
            >
              <Bell className="h-[22px] w-[22px] text-gray-800 dark:text-white" />
              {unreadCount > 0 && (
                <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-yellow-400 rounded-full border-2 border-white animate-pulse dark:border-gray-900" />
              )}
            </div>

            {/* Profile Action (Menu icon) */}
            <Link
              to="/food/user/profile"
              className="h-10 w-10 flex items-center justify-center rounded-full bg-gray-100 border border-gray-200 shadow-sm cursor-pointer active:scale-95 transition-all hover:bg-gray-200 dark:bg-black/20 dark:border-white/10 dark:hover:bg-white/10 flex-shrink-0"
            >
              <svg 
                width="22" 
                height="22" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2.5" 
                strokeLinecap="round" 
                strokeLinejoin="round"
                className="text-gray-800 dark:text-white"
              >
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="9" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Sticky Search Bar (Clean flow) */}
        <div
          className={`z-[60] transition-all duration-300 md:hidden ${
            isCategoryStuck 
              ? 'fixed top-0 left-0 right-0 h-[72px] flex items-end pb-2.5 px-4 bg-white dark:bg-[#1a1a1a] border-none shadow-none outline-none' 
              : 'sticky top-2 px-4 pb-3 pt-0 bg-transparent'
          }`}
        >
          <div className="flex items-center gap-2 w-full">
            <div 
              className={`relative z-[60] flex-1 rounded-[1.5rem] flex items-center px-4 border cursor-pointer active:scale-[0.98] group pointer-events-auto ${
                isCategoryStuck
                  ? "py-1.5 bg-white dark:bg-[#1a1a1a] border-gray-100 dark:border-gray-800 shadow-sm"
                  : "py-2 bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-gray-800 shadow-sm"
              }`}
              onClick={handleSearchFocus}
              onTouchStart={handleSearchFocus}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSearchFocus();
                }
              }}
            >
              <Search className="h-5 w-5 text-gray-400 mr-3 group-hover:text-[#E2AD4B] transition-colors duration-300 dark:text-gray-500" strokeWidth={2.5} />
              <div className="flex-1 overflow-hidden relative h-5">
                <input
                  type="text"
                  readOnly
                  aria-label="Search"
                  onFocus={handleSearchFocus}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <AnimatePresence mode="wait">
                  <motion.span
                    key={placeholderIndex}
                    initial={{ y: 15, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -15, opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="absolute inset-0 text-[14px] font-bold text-gray-500 dark:text-gray-400"
                  >
                    {placeholders?.[placeholderIndex] || 'Search "pizza"'}
                  </motion.span>
                </AnimatePresence>
              </div>
              <div 
                className="bg-[#E2AD4B]/5 dark:bg-[#E2AD4B]/10 p-1.5 rounded-full border border-[#E2AD4B]/10 ml-2 group-hover:bg-[#E2AD4B]/10 transition-all flex items-center justify-center"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate('/user/search?voice=true');
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  navigate('/user/search?voice=true');
                }}
              >
                <Mic className="h-4 w-4 text-[#E2AD4B]" strokeWidth={2.5} />
              </div>
            </div>

            {/* Veg Mode Toggle next to search bar */}
            {!isCategoryStuck && (
              <div 
                className={`flex flex-col items-center justify-center w-[50px] h-[50px] rounded-full border cursor-pointer active:scale-95 transition-all duration-200 flex-shrink-0 shadow-sm ${
                  isVegMode 
                    ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50' 
                    : 'bg-white dark:bg-[#1a1a1a] border-gray-200 dark:border-gray-800'
                }`}
                onClick={() => handleVegModeChange && handleVegModeChange(!isVegMode)}
                ref={vegModeToggleRef}
              >
                <span className={`text-[9px] font-black uppercase tracking-wider leading-none mb-1.5 ${
                  isVegMode ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'
                }`}>
                  Veg
                </span>
                
                {/* Horizontal Switch Track */}
                <div className={`w-8 h-4.5 rounded-full p-[1px] relative transition-colors duration-200 ${
                  isVegMode ? 'bg-emerald-200 dark:bg-emerald-900/50' : 'bg-gray-200 dark:bg-zinc-800'
                }`}>
                  {/* Slider Knob (Veg Symbol) */}
                  <div
                    className={`w-3.5 h-3.5 rounded-[3px] bg-white border flex items-center justify-center p-[1px] absolute top-[1px] transition-all duration-200 ${
                      isVegMode 
                        ? 'translate-x-[14px] border-green-600' 
                        : 'translate-x-[1px] border-green-600/60 dark:border-green-600/40'
                    }`}
                  >
                    <div
                      className={`w-1.5 h-1.5 rounded-full ${
                        isVegMode ? 'bg-green-600' : 'bg-green-600/60 dark:bg-green-600/40'
                      }`}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sliding Banner Carousel (Below Search Bar) */}
        {hasDynamicBanners && (
          <div 
            className="px-4 py-2 relative overflow-hidden max-w-md sm:max-w-xl md:max-w-6xl lg:max-w-7xl mx-auto w-full"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div className="relative w-full aspect-[18/8] sm:aspect-[24/9] md:aspect-[24/8] lg:aspect-[24/7] max-h-[160px] sm:max-h-[165px] md:max-h-[280px] lg:max-h-[360px] overflow-hidden rounded-[24px] shadow-lg bg-gray-100 dark:bg-gray-800">
              {displayBanners.map((banner, index) => (
                <div
                  key={banner.id}
                  className="absolute inset-0 transition-opacity duration-700 ease-in-out"
                  style={{
                    opacity: currentSlide === index ? 1 : 0,
                    zIndex: currentSlide === index ? 2 : 1,
                    pointerEvents: currentSlide === index ? "auto" : "none",
                  }}
                >
                  {banner.content}
                </div>
              ))}
              
              {/* Carousel Pager Dots */}
              {displayBanners.length > 1 && (
                <div className="absolute bottom-3 inset-x-0 flex justify-center gap-1.5 z-20">
                  {displayBanners.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      aria-label={`Go to slide ${i + 1}`}
                      onClick={() => setCurrentSlide(i)}
                      className={`h-1.5 rounded-full transition-all duration-300 ${i === currentSlide ? 'bg-white w-4' : 'bg-white/40 w-1.5'}`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {isNotificationsOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] bg-black/25 backdrop-blur-[1px]"
            onClick={() => closeNotifications()}
          >
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="absolute top-[84px] right-3 w-[calc(100vw-24px)] max-w-80 rounded-2xl overflow-hidden shadow-2xl bg-white dark:bg-gray-900"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/50">
                <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  Notifications
                  {unreadCount > 0 && (
                    <Badge variant="secondary" className="bg-orange-100 text-orange-600 border-none text-[10px] h-4">
                      {unreadCount} New
                    </Badge>
                  )}
                </h3>
                <div className="flex items-center gap-2">
                  <Link
                    to="/food/user/notifications"
                    onClick={() => closeNotifications()}
                    className="text-xs font-bold text-orange-600 hover:text-orange-700"
                  >
                    {mergedNotifications.length > 0 ? "View All" : ""}
                  </Link>
                  <button
                    type="button"
                    onClick={() => closeNotifications()}
                    className="rounded-full p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    aria-label="Close notifications"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="max-h-[60vh] overflow-y-auto overscroll-contain">
                {mergedNotifications.length > 0 ? (
                  mergedNotifications.slice(0, 5).map((notif) => {
                    const Icon = ICON_MAP[notif.icon] || Bell;
                    return (
                      <div
                        key={notif.id}
                        className={`p-4 flex items-start gap-3 border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer ${!notif.read ? 'bg-orange-50/20' : ''}`}
                      >
                        <div className={`mt-1 p-2 rounded-full ${notif.type === "order" ? "bg-green-100/50 text-green-600" : "bg-orange-100/50 text-orange-600"}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <span className="text-sm font-bold text-gray-900 dark:text-white truncate">{notif.title}</span>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-gray-400 whitespace-nowrap">{notif.time}</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDeleteNotification(notif.id, notif.source);
                                }}
                                className="rounded-full p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed">
                            {notif.message}
                          </p>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center flex flex-col items-center gap-2">
                    <BellOff className="h-10 w-10 text-gray-200" />
                    <p className="text-xs text-gray-400 font-medium">All caught up!</p>
                  </div>
                )}
              </div>
              <div className="p-3 bg-gray-50/50 dark:bg-gray-800/50 text-center">
                <Link
                  to="/food/user/notifications"
                  onClick={() => closeNotifications()}
                  className="text-xs font-bold text-gray-400 hover:text-gray-600"
                >
                  {mergedNotifications.length > 0 ? "Manage Settings" : "Check Notifications Page"}
                </Link>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

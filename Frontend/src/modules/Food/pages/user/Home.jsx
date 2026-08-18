import { useSearchParams, Link, useNavigate, useLocation as useRouterLocation } from "react-router-dom";
import React, {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useMemo,
  useCallback,
  startTransition,
} from "react";
import { createPortal } from "react-dom";
import {
  Star,
  Clock,
  MapPin,
  Heart,
  Search,
  Tag,
  Flame,
  ShoppingBag,
  ShoppingCart,
  Mic,
  SlidersHorizontal,
  CheckCircle2,
  Bookmark,
  BadgePercent,
  X,
  ArrowDownUp,
  Timer,
  CalendarClock,
  ShieldCheck,
  IndianRupee,
  UtensilsCrossed,
  Leaf,
  AlertCircle,
  Loader2,
  Plus,
  Check,
  Share2,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Footer from "@food/components/user/Footer";
import VoiceSearchOverlay from "@food/components/user/VoiceSearchOverlay";
import { useVoiceSearch } from "@food/hooks/useVoiceSearch";
import AddToCartButton from "@food/components/user/AddToCartButton";
import StickyCartCard from "@food/components/user/StickyCartCard";
import OrderTrackingCard from "@food/components/user/OrderTrackingCard";
import {
  CategoryChipRowSkeleton,
  HeroBannerSkeleton,
  LoadingSkeletonRegion,
  RestaurantGridSkeleton,
} from "@food/components/ui/loading-skeletons";
import { useProfile } from "@food/context/ProfileContext";
import { isModuleAuthenticated } from "@food/utils/auth";
import { isVegMenuItem, isNonVegCategoryScope } from "@food/utils/vegMode";
import { useCart } from "@food/context/CartContext";
import { HorizontalCarousel } from "@food/components/ui/horizontal-carousel";
import { DotPattern } from "@food/components/ui/dot-pattern";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@food/components/ui/card";
import { Button } from "@food/components/ui/button";
import { Badge } from "@food/components/ui/badge";
import { Input } from "@food/components/ui/input";
import { Switch } from "@food/components/ui/switch";
import { Checkbox } from "@food/components/ui/checkbox";
import {
  useSearchOverlay,
  useLocationSelector,
} from "@food/components/user/UserLayout";
import PageNavbar from "@food/components/user/PageNavbar";

const debugLog = (...args) => { };
const debugWarn = (...args) => { };
const debugError = (...args) => { };

// Import shared food images - prevents duplication
import { foodImages } from "@food/constants/images";

import { Avatar, AvatarFallback, AvatarImage } from "@food/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@food/components/ui/dropdown-menu";
import { useLocation, resolveServiceCity } from "@food/hooks/useLocation";
import { useZone } from "@food/hooks/useZone";
import quickSpicyLogo from "@food/assets/quicky-spicy-logo.png";
import offerImage from "@food/assets/offerimage.png";
import api, { publicGetOnce, restaurantAPI, adminAPI } from "@food/api";
import { API_BASE_URL } from "@food/api/config";
import OptimizedImage from "@food/components/OptimizedImage";
import RestaurantImageCarousel from "@food/components/user/RestaurantImageCarousel";
import { getRestaurantAvailabilityStatus } from "@food/utils/restaurantAvailability";
import { compareRestaurantsByAvailabilityAndDistance } from "@food/utils/restaurantBrowseSort";
import { normalizeImageUrl as normalizeServerImageUrl } from "@food/utils/common";
import {
  saveBrowseScroll,
  peekBrowseScroll,
  consumeBrowseScroll,
  restoreBrowseScroll,
} from "@food/utils/browseScrollMemory";
import { toFoodUserPath, getRestaurantRouteId } from "@food/utils/mainTabRoutes";
import {
  getCachedExploreIcons,
  setCachedExploreIcons,
  isExploreIconsCacheFresh,
  preloadImageUrls,
} from "@food/utils/foodPageCache";
import HomeHeader from "@food/components/user/home/HomeHeader";
import QuickSection from "@food/components/user/home/QuickSection";
import PromoRow from "@food/components/user/home/PromoRow";
import FestBanner from "@food/components/user/home/FestBanner";

// Persistence for back-navigation and refresh speed
const getSessionCache = (key) => {
  try {
    const cached = sessionStorage.getItem(key);
    return cached ? JSON.parse(cached) : null;
  } catch (e) { return null; }
};
const setSessionCache = (key, data) => {
  try { sessionStorage.setItem(key, JSON.stringify(data)); } catch (e) { }
};

// v2: added foodTypeScope field — old cache entries without it must be dropped
const HOME_CATEGORIES_CACHE_KEY = 'food_home_categories_v2';
let HOME_RESTAURANTS_CACHE = getSessionCache('food_home_restaurants');
let HOME_CATEGORIES_CACHE = getSessionCache(HOME_CATEGORIES_CACHE_KEY);


// Explore More Icons
import exploreOffers from "@food/assets/explore more icons/offers.png";
import exploreGourmet from "@food/assets/explore more icons/gourmet.png";
import exploreTop10 from "@food/assets/explore more icons/top 10.png";
import exploreCollection from "@food/assets/explore more icons/collection.png";

// Bundled Explore logos — warm browser cache as soon as Home module loads
preloadImageUrls([exploreOffers, exploreGourmet, exploreTop10, exploreCollection]);

const CACHED_EXPLORE_BOOT = (() => {
  try {
    const cached = getCachedExploreIcons();
    if (!cached || !isExploreIconsCacheFresh()) return null;
    preloadImageUrls(
      (cached.items || [])
        .map((it) => it.imageUrl || it.image)
        .filter(Boolean)
        .map(toExploreIconThumbUrl),
    );
    return cached;
  } catch {
    return null;
  }
})();

function toExploreIconThumbUrl(url) {
  return url;
}

/** Explore icons: skeleton until logo paints — never show alt/label text in the icon box. */
function ExploreIconImage({ src, fallbackSrc, className }) {
  const localSrc = fallbackSrc || "";
  const remoteSrc = src && src !== localSrc ? src : "";
  const targetSrc = remoteSrc || localSrc || src || "";
  const [shownSrc, setShownSrc] = useState(targetSrc);
  const [isLoaded, setIsLoaded] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    const preferred = remoteSrc || localSrc || "";
    setIsLoaded(false);
    setShownSrc(preferred);
  }, [remoteSrc, localSrc]);

  // Cached images often skip onLoad — mark loaded if already complete
  useEffect(() => {
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth > 0) {
      setIsLoaded(true);
    }
  }, [shownSrc]);

  return (
    <div className={`relative w-full h-full ${className || ""}`}>
      {!isLoaded && (
        <div
          className="absolute inset-0 z-20 rounded-xl bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-pulse dark:from-gray-700 dark:via-gray-600 dark:to-gray-700"
          aria-hidden="true"
        />
      )}
      {shownSrc ? (
        <img
          ref={imgRef}
          src={shownSrc}
          alt=""
          aria-hidden="true"
          className={`relative z-10 w-full h-full object-contain transition-opacity duration-150 ${
            isLoaded ? "opacity-100" : "opacity-0"
          }`}
          loading="eager"
          decoding="async"
          fetchPriority="high"
          draggable={false}
          onLoad={() => setIsLoaded(true)}
          onError={() => {
            if (localSrc && shownSrc !== localSrc) {
              setIsLoaded(false);
              setShownSrc(localSrc);
              return;
            }
            // Keep skeleton rather than broken-image alt text
            setIsLoaded(false);
            setShownSrc("");
          }}
        />
      ) : null}
    </div>
  );
}

// Banner images for hero carousel - will be fetched from API

// Animated placeholder for search - moved outside component to prevent recreation
const placeholders = [
  'Search "burger"',
  'Search "biryani"',
  'Search "pizza"',
  'Search "desserts"',
  'Search "chinese"',
  'Search "thali"',
  'Search "momos"',
  'Search "dosa"',
];

const getRestaurantDisplayName = (restaurant) => {
  const nameCandidates = [
    restaurant?.name,
    restaurant?.restaurantName,
    restaurant?.restaurantName?.english,
    restaurant?.restaurantName?.value,
    restaurant?.onboarding?.step1?.restaurantName,
  ];
  const resolvedName = nameCandidates.find(
    (candidate) =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  return resolvedName ? resolvedName.trim() : "Restaurant";
};

// Symmetrical Scallop Icon Badge (with inline % vector text) to look exactly like the restaurant details page
const ScallopBadge = ({ className = "" }) => (
  <svg
    viewBox="0 0 100 100"
    className={`text-[#2563EB] fill-current flex-shrink-0 ${className}`}
  >
    <path d="M 86.29 42.78 Q 95.00 50.00 86.29 57.22 Q 91.57 67.22 80.76 70.56 Q 81.82 81.82 70.56 80.76 Q 67.22 91.57 57.22 86.29 Q 50.00 95.00 42.78 86.29 Q 32.78 91.57 29.44 80.76 Q 18.18 81.82 19.24 70.56 Q 8.43 67.22 13.71 57.22 Q 5.00 50.00 13.71 42.78 Q 8.43 32.78 19.24 29.44 Q 18.18 18.18 29.44 19.24 Q 32.78 8.43 42.78 13.71 Q 50.00 5.00 57.22 13.71 Q 67.22 8.43 70.56 19.24 Q 81.82 18.18 80.76 29.44 Q 91.57 32.78 86.29 42.78 Z" />
    <text
      x="50"
      y="63"
      textAnchor="middle"
      fontSize="42"
      fontWeight="900"
      fill="white"
      className="select-none font-sans"
    >
      %
    </text>
  </svg>
);

const formatCouponText = (coupon) => {
  if (!coupon) return "";
  const minOrderValue = Number(coupon.minOrderValue);
  const minOrderText = Number.isFinite(minOrderValue) && minOrderValue > 0 ? ` above ₹${minOrderValue}` : "";
  if (coupon.discountType === "percentage") {
    const discountPercentage = coupon.discountPercentage ?? coupon.discountValue;
    const limitText = coupon.maxDiscount ? ` up to ₹${coupon.maxDiscount}` : "";
    return `${discountPercentage}% OFF${minOrderText}${limitText}`;
  }
  const value = coupon.originalPrice || coupon.discountValue || 0;
  return `Flat ₹${value} OFF${minOrderText}`;
};

// Restaurant Card Offer Carousel Component - cycles through active coupons
const RestaurantCardOfferCarousel = React.memo(({ coupons }) => {
  const uniqueCoupons = React.useMemo(() => {
    if (!coupons || coupons.length === 0) return [];
    const map = new Map();
    coupons.forEach(c => {
      const text = formatCouponText(c);
      if (text && !map.has(text)) {
        map.set(text, c);
      }
    });
    return Array.from(map.values());
  }, [coupons]);

  const [currentIndex, setCurrentIndex] = useState(0);

  const couponsKey = uniqueCoupons.map(c => c.couponCode || c.code || "").join(",");

  useEffect(() => {
    if (uniqueCoupons.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % uniqueCoupons.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [couponsKey, uniqueCoupons.length]);

  if (uniqueCoupons.length === 0) return null;

  // Static display if only 1 unique coupon exists to prevent layout shifting/unwanted sliding
  if (uniqueCoupons.length === 1) {
    return (
      <div className="flex items-center gap-2 mt-2 overflow-hidden h-[20px] relative">
        {/* Symmetrical Scallop Icon like Zomato */}
        <div className="flex-shrink-0 flex items-center justify-center w-5 h-5">
          <ScallopBadge className="h-5 w-5 text-[#2563EB]" />
        </div>
        <div className="flex-grow h-full overflow-hidden relative min-w-0">
          <span className="absolute inset-x-0 top-0 bottom-0 text-[11px] sm:text-xs font-bold text-slate-700 dark:text-slate-300 tracking-wide truncate flex items-center">
            {formatCouponText(uniqueCoupons[0])}
          </span>
        </div>
      </div>
    );
  }

  const currentCoupon = uniqueCoupons[currentIndex] || uniqueCoupons[0];

  return (
    <div className="flex items-center gap-2 mt-2 overflow-hidden h-[20px] relative">
      {/* Symmetrical Scallop Icon like Zomato */}
      <div className="flex-shrink-0 flex items-center justify-center w-5 h-5">
        <ScallopBadge className="h-5 w-5 text-[#2563EB]" />
      </div>

      {/* Animating Coupon Text - sliding down vertically */}
      <div className="flex-grow h-full overflow-hidden relative min-w-0">
        <AnimatePresence initial={false}>
          <motion.span
            key={`${currentCoupon.couponCode || currentCoupon.code || currentIndex}-${currentIndex}`}
            initial={{ top: -14, opacity: 0 }}
            animate={{ top: 0, opacity: 1 }}
            exit={{ top: 14, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="absolute inset-x-0 bottom-0 text-[11px] sm:text-xs font-bold text-slate-700 dark:text-slate-300 tracking-wide truncate flex items-center"
          >
            {formatCouponText(currentCoupon)}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
});

export default function Home({ homeMode = null, isTabActive = true }) {
  const navigate = useNavigate();
  const routerLocation = useRouterLocation();
  const hasRestoredBrowseScrollRef = useRef(false);
  const HERO_BANNER_AUTO_SLIDE_MS = 3500;
  const BACKEND_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const [heroSearch, setHeroSearch] = useState("");
  const [takeawaySearchOpen, setTakeawaySearchOpen] = useState(false);
  const { openSearch, closeSearch, searchValue, setSearchValue } =
    useSearchOverlay();
  const { openLocationSelector } = useLocationSelector();
  const { userProfile, vegMode, setVegMode: setVegModeContext, vegModeOption, setVegModeOption, orderType, setOrderType } = useProfile();
  // homeMode lets MainTabKeepAlive mount Delivery + Takeaway Home side-by-side
  // without both instances fighting over global orderType / pathname.
  const isTakeawayPage =
    homeMode === "takeaway" ||
    (!homeMode &&
      (routerLocation.pathname === "/food/takeaway" ||
        routerLocation.pathname.startsWith("/food/takeaway/") ||
        routerLocation.pathname.startsWith("/food/user/takeaway")));
  const effectiveOrderType =
    homeMode === "takeaway" || homeMode === "delivery"
      ? homeMode
      : isTakeawayPage
        ? "takeaway"
        : orderType;

  useEffect(() => {
    if (homeMode) return;
    if (isTakeawayPage) {
      if (orderType !== "takeaway") setOrderType("takeaway");
    } else if (routerLocation.pathname.includes("/dining")) {
      if (orderType !== "dining") setOrderType("dining");
    } else {
      // Default home paths set back to delivery if they were takeaway/dining
      const isHome = routerLocation.pathname === "/food/user" ||
        routerLocation.pathname === "/food/user/" ||
        routerLocation.pathname === "/user" ||
        routerLocation.pathname === "/user/" ||
        routerLocation.pathname === "/food" ||
        routerLocation.pathname === "/food/";
      if (isHome && orderType !== "delivery") {
        setOrderType("delivery");
      }
    }
  }, [homeMode, isTakeawayPage, routerLocation.pathname, orderType, setOrderType]);

  useEffect(() => {
    if (!isTakeawayPage) {
      setTakeawaySearchOpen(false);
      setHeroSearch("");
    }
  }, [isTakeawayPage]);



  const [prevVegMode, setPrevVegMode] = useState(vegMode);
  const [showVegModePopup, setShowVegModePopup] = useState(false);
  const [showSwitchOffPopup, setShowSwitchOffPopup] = useState(false);
  const [isApplyingVegMode, setIsApplyingVegMode] = useState(false);
  const [isSwitchingOffVegMode, setIsSwitchingOffVegMode] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0, triangleLeft: 0 });
  const vegModeToggleRef = useRef(null);
  const [isStickyHeaderVisible, setIsStickyHeaderVisible] = useState(false);
  const [showStickySearch, setShowStickySearch] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const handleScrollHeader = () => {
      const currentScrollY = window.scrollY;
      const categoriesSection = document.getElementById("categories-section");

      if (!categoriesSection) return;

      const rect = categoriesSection.getBoundingClientRect();
      const sectionBottom = rect.bottom + currentScrollY;

      // When to show/hide the sticky header
      // Sticky header visibility
      setIsStickyHeaderVisible(currentScrollY > sectionBottom);
      setShowStickySearch(currentScrollY > sectionBottom);

      lastScrollY.current = currentScrollY;
    };

    window.addEventListener("scroll", handleScrollHeader, { passive: true });
    return () => window.removeEventListener("scroll", handleScrollHeader);
  }, []);

  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [isTransitionEnabled, setIsTransitionEnabled] = useState(true);
  const [publicOffers, setPublicOffers] = useState([]);

  useEffect(() => {
    let active = true;
    const fetchOffers = async () => {
      try {
        const response = await restaurantAPI.getPublicOffers();
        if (!active) return;
        const list = response?.data?.data?.allOffers || response?.data?.allOffers || [];
        const activeOffers = list.filter((o) => {
          if (o.showInCart === false) return false;
          if (o.status && o.status !== "active") return false;
          return true;
        });
        setPublicOffers(activeOffers);
      } catch (err) {
        debugError("Error fetching public offers for Home page:", err);
      }
    };
    fetchOffers();
    return () => {
      active = false;
    };
  }, []);

  const [heroBannerImages, setHeroBannerImages] = useState([]);
  const [heroBannersData, setHeroBannersData] = useState([]); // Store full banner data with linked restaurants
  const [loadingBanners, setLoadingBanners] = useState(true);
  const [hasScrolledPastBanner, setHasScrolledPastBanner] = useState(false);
  const [landingCategories, setLandingCategories] = useState([]);
  const [landingExploreMore, setLandingExploreMore] = useState(
    () => CACHED_EXPLORE_BOOT?.items || [],
  );
  const [exploreMoreHeading, setExploreMoreHeading] = useState(
    () => CACHED_EXPLORE_BOOT?.heading || "Explore More",
  );
  const CACHED_FEST_BANNER = (() => {
    if (typeof window !== "undefined") {
      try { return localStorage.getItem("CACHED_FEST_BANNER") || null; }
      catch (e) { return null; }
    }
    return null;
  })();
  const [festBannerImageUrl, setFestBannerImageUrl] = useState(CACHED_FEST_BANNER);
  const [festBannerTopColor, setFestBannerTopColor] = useState(() => {
    if (typeof window !== "undefined") {
      try { return localStorage.getItem("CACHED_FEST_BANNER_COLOR") || ''; } catch (e) { return ''; }
    }
    return '';
  });

  const [recommendedRestaurantIds, setRecommendedRestaurantIds] = useState([]);
  const [under250PriceLimit, setUnder250PriceLimit] = useState(250);
  const [
    recommendedRestaurantsFromSettings,
    setRecommendedRestaurantsFromSettings,
  ] = useState([]);
  const [restaurantsData, setRestaurantsData] = useState(HOME_RESTAURANTS_CACHE || []);
  const [loadingRestaurants, setLoadingRestaurants] = useState(!HOME_RESTAURANTS_CACHE || (Array.isArray(HOME_RESTAURANTS_CACHE) && HOME_RESTAURANTS_CACHE.length === 0));
  const [realCategories, setRealCategories] = useState(HOME_CATEGORIES_CACHE || []);
  const [loadingRealCategories, setLoadingRealCategories] = useState(!HOME_CATEGORIES_CACHE);
  const [menuCategories, setMenuCategories] = useState([]);
  const [loadingMenuCategories, setLoadingMenuCategories] = useState(false);
  const [restaurantDietMeta, setRestaurantDietMeta] = useState({});
  const [showAllCategoriesModal, setShowAllCategoriesModal] = useState(false);
  const [availabilityTick, setAvailabilityTick] = useState(Date.now());
  const RESTAURANTS_BATCH_SIZE = 9;
  const [visibleRestaurantCount, setVisibleRestaurantCount] = useState(() => {
    if (typeof window === "undefined") return RESTAURANTS_BATCH_SIZE;
    const pending = peekBrowseScroll(window.location.pathname);
    const n = Number(pending?.visibleCount);
    if (Number.isFinite(n) && n > RESTAURANTS_BATCH_SIZE) {
      return Math.floor(n);
    }
    return RESTAURANTS_BATCH_SIZE;
  });
  const restaurantLoadMoreRef = useRef(null);
  const publicCategoriesCacheRef = useRef(new Map());
  const publicCategoriesInFlightRef = useRef(new Map());
  const isHandlingSwitchOff = useRef(false);
  const heroShellRef = useRef(null);
  const stickyHeaderRef = useRef(null);
  const slugifyCategory = useCallback(
    (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, ""),
    [],
  );
  const isSettingsLoading = festBannerImageUrl === null;

  // Stable list of restaurant ids for menu-category union so we don't refetch menus
  // when `restaurantsData` changes for reasons like distance recalculation or outletTimings enrichment.
  const menuUnionRestaurantIdsKey = useMemo(() => {
    if (!Array.isArray(restaurantsData) || restaurantsData.length === 0) return "";
    return restaurantsData
      .map((r) => String(r?.restaurantId || r?.id || "").trim())
      .filter(Boolean)
      .sort()
      .join(",");
  }, [restaurantsData]);

  const normalizeImageUrl = useCallback(
    (imageUrl) => normalizeServerImageUrl(imageUrl, BACKEND_ORIGIN),
    [BACKEND_ORIGIN],
  );

  const extractImageFromValue = useCallback(
    (value) => {
      if (!value) return "";

      if (typeof value === "string") {
        return normalizeImageUrl(value);
      }

      if (typeof value === "object") {
        const candidate =
          value.url ||
          value.secure_url ||
          value.imageUrl ||
          value.imageURL ||
          value.image ||
          value.src ||
          value.path ||
          value.location ||
          value.link ||
          value.href ||
          "";
        return typeof candidate === "string"
          ? normalizeImageUrl(candidate)
          : "";
      }

      return "";
    },
    [normalizeImageUrl],
  );

  const buildRestaurantImageCandidates = useCallback(
    (value) => {
      const normalized = extractImageFromValue(value);
      if (!normalized) return [];
      return [normalized];
    },
    [extractImageFromValue],
  );

  const extractImages = useCallback(
    (source) => {
      if (!source) return [];

      const normalizedImages = (Array.isArray(source)
        ? source.flatMap((entry) => buildRestaurantImageCandidates(entry))
        : buildRestaurantImageCandidates(source)
      )
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter(Boolean);

      // De-duplicate image urls while preserving order.
      return normalizedImages.filter(
        (value, index) => normalizedImages.indexOf(value) === index,
      );

    },
    [buildRestaurantImageCandidates],
  );

  useEffect(() => {
    const intervalId = setInterval(() => {
      setAvailabilityTick(Date.now());
    }, 60000);

    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const heroShell = heroShellRef.current;
      const stickyHeader = stickyHeaderRef.current;

      if (!heroShell) {
        setHasScrolledPastBanner(false);
        return;
      }

      const heroRect = heroShell.getBoundingClientRect();
      const stickyHeight = stickyHeader?.getBoundingClientRect().height || 0;
      setHasScrolledPastBanner(heroRect.bottom <= stickyHeight);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, []);

  // Merge API explore items with fallback to ensure all 4 cards are shown
  const finalExploreItems = useMemo(() => {
    const fallback = [
      {
        id: "under-250",
        label: "Under 250",
        // Local asset always used for first paint; remote admin icon swaps in when ready
        image: exploreOffers,
        fallbackImage: exploreOffers,
        href: "/food/user/under-250",
      },
      {
        id: "offers",
        label: "Offers",
        image: exploreOffers,
        fallbackImage: exploreOffers,
        href: "/food/user/offers",
      },
      {
        id: "gourmet",
        label: "Gourmet",
        image: exploreGourmet,
        fallbackImage: exploreGourmet,
        href: "/food/user/gourmet",
      },
      {
        id: "collection",
        label: "Collections",
        image: exploreCollection,
        fallbackImage: exploreCollection,
        href: "/food/user/profile/favorites",
      },
    ];

    if (!landingExploreMore || landingExploreMore.length === 0) return fallback;

    return fallback.map((item) => {
      const itemLabel = item.label.toLowerCase();
      const apiItem = landingExploreMore.find((ai) => {
        const label = String(ai.label || ai.name || "").toLowerCase().trim();
        const linkType = String(ai.linkType || "").toLowerCase().trim();
        const link = String(ai.link || ai.targetPath || "").toLowerCase();
        return (
          label === itemLabel ||
          linkType === item.id ||
          link.includes(item.id) ||
          (item.id === "under-250" &&
            (label.includes("under 250") ||
              label.includes("under-250") ||
              label.includes("under ₹250") ||
              label.includes("under rs")))
        );
      });
      if (apiItem) {
        const href = apiItem.link
          ? apiItem.link.startsWith("/")
            ? apiItem.link
            : `/${apiItem.link}`
          : item.href;
        const remote =
          toExploreIconThumbUrl(
            normalizeImageUrl(apiItem.imageUrl || apiItem.iconUrl || apiItem.image || "") ||
              "",
          ) || "";
        return {
          ...item,
          // Keep bundled PNG as fallbackImage forever; remote only via image when different
          image: remote || item.image,
          fallbackImage: item.fallbackImage,
          href,
        };
      }
      return item;
    });
  }, [landingExploreMore, normalizeImageUrl]);

  // Warm Explore thumbs as soon as URLs are known
  useEffect(() => {
    preloadImageUrls(finalExploreItems.map((item) => item.image).filter(Boolean));
  }, [finalExploreItems]);

  const normalizedLandingCategories = useMemo(() => {
    return (landingCategories || []).map((category, index) => ({
      id: category.id || category._id || `landing-category-${index}`,
      name: category.label || category.name || "Category",
      image:
        normalizeImageUrl(category.imageUrl || category.image) ||
        foodImages[index % foodImages.length] ||
        foodImages[0],
      slug:
        category.slug || slugifyCategory(category.label || category.name || ""),
      label: category.label || category.name || "Category",
    }));
  }, [landingCategories, normalizeImageUrl, slugifyCategory]);

  const displayCategories = useMemo(() => {
    const filterByVeg = (cats) => {
      if (!vegMode) return cats;
      return cats.filter((cat) => !isNonVegCategoryScope(cat));
    };
    if (realCategories.length > 0) return filterByVeg(realCategories);
    if (menuCategories.length > 0) return filterByVeg(menuCategories);
    return filterByVeg(normalizedLandingCategories);
  }, [menuCategories, realCategories, normalizedLandingCategories, vegMode]);

  useEffect(() => {
    preloadImageUrls(
      (displayCategories || [])
        .slice(0, 12)
        .map((cat) => cat.image)
        .filter(Boolean),
    );
  }, [displayCategories]);

  // Swipe functionality for hero banner carousel
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchEndX = useRef(0);
  const touchEndY = useRef(0);
  const isSwiping = useRef(false);
  const autoSlideIntervalRef = useRef(null);

  // Sync prevVegMode when vegMode changes from context
  useEffect(() => {
    if (vegMode !== prevVegMode && !isHandlingSwitchOff.current) {
      setPrevVegMode(vegMode);
    }
  }, [vegMode]);

  // Keep persisted Veg Mode preference; only reset popup UI state on mount.
  useEffect(() => {
    setPrevVegMode(vegMode);
    setShowVegModePopup(false);
    setShowSwitchOffPopup(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle vegMode toggle - show popup when turned ON or OFF
  const handleVegModeChange = (newValue) => {
    // Skip if we're handling switch off confirmation
    if (isHandlingSwitchOff.current) {
      return;
    }

    if (newValue && !prevVegMode) {
      // Veg mode was just turned ON
      // Calculate popup position relative to toggle (right-aligned to button)
      if (vegModeToggleRef.current) {
        const rect = vegModeToggleRef.current.getBoundingClientRect();
        const screenWidth = window.innerWidth;
        const popupWidth = Math.min(screenWidth - 32, 320);

        // Right-align popup to the button's right edge
        let left = rect.right - popupWidth;
        left = Math.max(16, Math.min(left, screenWidth - popupWidth - 16));

        const triangleLeft = rect.left + rect.width / 2 - left;

        setPopupPosition({
          top: rect.bottom + 10,
          left: left,
          triangleLeft: triangleLeft
        });
      }
      setShowVegModePopup(true);
      // Don't update context yet - wait for user to apply or cancel
    } else if (!newValue && prevVegMode) {
      // Veg mode was just turned OFF - show switch off confirmation popup
      isHandlingSwitchOff.current = true;
      setShowSwitchOffPopup(true);
      // Don't update context yet - wait for user to confirm
    } else {
      // Normal state change - update context directly
      setVegModeContext(newValue);
      setPrevVegMode(newValue);
    }
  };

  // Lock body scroll when veg mode popup is open
  useEffect(() => {
    if (showVegModePopup) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [showVegModePopup])

  // Update popup position on scroll/resize
  useEffect(() => {
    if (!showVegModePopup) return;

    const updatePosition = () => {
      if (vegModeToggleRef.current) {
        const rect = vegModeToggleRef.current.getBoundingClientRect();
        const screenWidth = window.innerWidth;
        const popupWidth = Math.min(screenWidth - 32, 320);

        let left = rect.right - popupWidth;
        left = Math.max(16, Math.min(left, screenWidth - popupWidth - 16));

        const triangleLeft = rect.left + rect.width / 2 - left;

        setPopupPosition({
          top: rect.bottom + 10,
          left: left,
          triangleLeft: triangleLeft
        });
      }
    };

    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [showVegModePopup]);


  // Keep index within current banner bounds after admin updates/reloads.
  useEffect(() => {
    setCurrentBannerIndex((prev) => {
      if (heroBannerImages.length === 0) return 0;
      return Math.min(prev, heroBannerImages.length - 1);
    });
  }, [heroBannerImages.length]);

  // Preload hero images to avoid white blink during slide transition.
  useEffect(() => {
    heroBannerImages.forEach((src) => {
      if (!src) return;
      const img = new window.Image();
      img.src = src;
    });
  }, [heroBannerImages]);

  const startHeroBannerAutoSlide = useCallback(() => {
    if (autoSlideIntervalRef.current) {
      clearInterval(autoSlideIntervalRef.current);
    }

    if (heroBannerImages.length <= 1) return;

    autoSlideIntervalRef.current = setInterval(() => {
      if (!isSwiping.current) {
        setIsTransitionEnabled(true);
        setCurrentBannerIndex((prev) => {
          if (prev >= heroBannerImages.length) return prev;
          return prev + 1;
        });
      }
    }, HERO_BANNER_AUTO_SLIDE_MS);
  }, [heroBannerImages.length, HERO_BANNER_AUTO_SLIDE_MS]);

  // Handle snap-back when reaching the cloned slide at the end
  useEffect(() => {
    if (currentBannerIndex === heroBannerImages.length && heroBannerImages.length > 1) {
      const timer = setTimeout(() => {
        setIsTransitionEnabled(false);
        setCurrentBannerIndex(0);
      }, 500); // match transition duration
      return () => clearTimeout(timer);
    }
  }, [currentBannerIndex, heroBannerImages.length]);

  // Re-enable transition after snap-back
  useEffect(() => {
    if (!isTransitionEnabled && currentBannerIndex === 0) {
      const timer = setTimeout(() => {
        setIsTransitionEnabled(true);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isTransitionEnabled, currentBannerIndex]);

  // Auto-cycle hero banner images
  useEffect(() => {
    startHeroBannerAutoSlide();

    return () => {
      if (autoSlideIntervalRef.current) {
        clearInterval(autoSlideIntervalRef.current);
      }
    };
  }, [startHeroBannerAutoSlide]);

  // Helper function to reset auto-slide timer
  const resetAutoSlide = useCallback(() => {
    startHeroBannerAutoSlide();
  }, [startHeroBannerAutoSlide]);

  // Swipe handlers for hero banner carousel
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isSwiping.current = true;
  };

  const handleTouchMove = (e) => {
    touchEndX.current = e.touches[0].clientX;
    touchEndY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = () => {
    if (!isSwiping.current || heroBannerImages.length === 0) return;

    const deltaX = touchEndX.current - touchStartX.current;
    const deltaY = Math.abs(touchEndY.current - touchStartY.current);
    const minSwipeDistance = 50; // Minimum distance for a swipe

    // Check if it's a horizontal swipe (not vertical scroll)
    if (Math.abs(deltaX) > minSwipeDistance && Math.abs(deltaX) > deltaY) {
      if (deltaX > 0) {
        // Swipe right - go to previous image
        if (currentBannerIndex === 0) {
          setIsTransitionEnabled(false);
          setCurrentBannerIndex(heroBannerImages.length);
          setTimeout(() => {
            setIsTransitionEnabled(true);
            setCurrentBannerIndex(heroBannerImages.length - 1);
          }, 50);
        } else {
          setIsTransitionEnabled(true);
          setCurrentBannerIndex((prev) => prev - 1);
        }
      } else {
        // Swipe left - go to next image
        setIsTransitionEnabled(true);
        setCurrentBannerIndex((prev) => {
          if (prev >= heroBannerImages.length) return prev;
          return prev + 1;
        });
      }
      // Reset auto-slide timer after manual swipe
      resetAutoSlide();
    }

    // Reset swipe state after a short delay
    setTimeout(() => {
      isSwiping.current = false;
    }, 300);

    // Reset touch positions
    touchStartX.current = 0;
    touchStartY.current = 0;
    touchEndX.current = 0;
    touchEndY.current = 0;
  };

  // Mouse handlers for desktop drag support
  const handleMouseDown = (e) => {
    touchStartX.current = e.clientX;
    touchStartY.current = e.clientY;
    isSwiping.current = true;
  };

  const handleMouseMove = (e) => {
    if (!isSwiping.current) return;
    touchEndX.current = e.clientX;
    touchEndY.current = e.clientY;
  };

  const handleMouseUp = () => {
    if (!isSwiping.current || heroBannerImages.length === 0) return;

    const deltaX = touchEndX.current - touchStartX.current;
    const deltaY = Math.abs(touchEndY.current - touchStartY.current);
    const minSwipeDistance = 50;

    if (Math.abs(deltaX) > minSwipeDistance && Math.abs(deltaX) > deltaY) {
      if (deltaX > 0) {
        if (currentBannerIndex === 0) {
          setIsTransitionEnabled(false);
          setCurrentBannerIndex(heroBannerImages.length);
          setTimeout(() => {
            setIsTransitionEnabled(true);
            setCurrentBannerIndex(heroBannerImages.length - 1);
          }, 50);
        } else {
          setIsTransitionEnabled(true);
          setCurrentBannerIndex((prev) => prev - 1);
        }
      } else {
        setIsTransitionEnabled(true);
        setCurrentBannerIndex((prev) => {
          if (prev >= heroBannerImages.length) return prev;
          return prev + 1;
        });
      }
      // Reset auto-slide timer after manual swipe
      resetAutoSlide();
    }

    setTimeout(() => {
      isSwiping.current = false;
    }, 300);

    touchStartX.current = 0;
    touchStartY.current = 0;
    touchEndX.current = 0;
    touchEndY.current = 0;
  };
  const [activeFilters, setActiveFilters] = useState(new Set());
  const [sortBy, setSortBy] = useState(null); // null, 'price-low', 'price-high', 'rating-high', 'rating-low'
  const [selectedCuisine, setSelectedCuisine] = useState(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isVoiceOverlayOpen, setIsVoiceOverlayOpen] = useState(false);
  const voiceSearch = useVoiceSearch((transcript) => {
    navigate(`/food/user/search?q=${encodeURIComponent(transcript)}&mode=delivery`);
    setIsVoiceOverlayOpen(false);
  });
  const [appliedFilters, setAppliedFilters] = useState({
    activeFilters: new Set(),
    sortBy: null,
    selectedCuisine: null,
  });
  const [isLoadingFilterResults, setIsLoadingFilterResults] = useState(false);
  const [activeFilterTab, setActiveFilterTab] = useState("sort");
  const categoryScrollRef = useRef(null);
  const gsapAnimationsRef = useRef([]);
  // Show skeletons immediately while loading — delayed toggles caused visible layout swap (CLS).
  const showBannerSkeleton = loadingBanners;
  // Safely get profile context - handle case when ProfileProvider is not available
  let profileContext = null;
  try {
    profileContext = useProfile();
  } catch (error) {
    debugWarn("ProfileProvider not available, using fallback:", error.message);
    // Fallback values when ProfileProvider is not available
    profileContext = {
      addFavorite: () => debugWarn("ProfileProvider not available"),
      removeFavorite: () => debugWarn("ProfileProvider not available"),
      isFavorite: () => false,
      getFavorites: () => [],
      getDefaultAddress: () => null,
    };
  }

  const {
    addFavorite,
    removeFavorite,
    isFavorite,
    getFavorites,
    getDefaultAddress,
  } = profileContext;
  const { addToCart, cart } = useCart();
  const { location, loading, requestLocation } = useLocation();
  const {
    zoneId,
    zoneStatus,
    isInService,
    isOutOfService,
    loading: zoneLoading,
    error: zoneError,
  } = useZone(location);
  const [showToast, setShowToast] = useState(false);
  const [showManageCollections, setShowManageCollections] = useState(false);
  const [selectedRestaurantSlug, setSelectedRestaurantSlug] = useState(null);

  // Fetch hero banners from public API (no auth required)
  useEffect(() => {
    if (zoneLoading) return;
    let cancelled = false;
    setLoadingBanners(true);
    publicGetOnce("/food/hero-banners/public", zoneId ? { params: { zoneId } } : {})
      .then((response) => {
        if (cancelled) return;
        const data = response?.data?.data;
        const list = Array.isArray(data?.banners)
          ? data.banners
          : Array.isArray(data)
            ? data
            : [];
        const images = list
          .map((b) => (b && typeof b.imageUrl === "string" ? b.imageUrl : ""))
          .filter(Boolean);
        setHeroBannerImages(images);
        setHeroBannersData(list);
        setCurrentBannerIndex(0);
      })
      .catch((err) => {
        if (cancelled) return;
        debugError("Failed to fetch hero banners", err);
        setHeroBannerImages([]);
        setHeroBannersData([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingBanners(false);
      });
    return () => {
      cancelled = true;
    };
  }, [zoneId, zoneLoading]);

  // Old backend endpoint removed: keep UI stable with empty categories.
  useEffect(() => {
    setLoadingRealCategories(true);
    setRealCategories([]);
    setLoadingRealCategories(false);
  }, []);

  // Fetch explore icons and landing settings from public APIs
  useEffect(() => {
    if (zoneLoading) return;
    let cancelled = false;
    const reqConfig = zoneId ? { params: { zoneId } } : {};
    Promise.all([
      publicGetOnce("/food/explore-icons/public", reqConfig)
        .catch(() => ({ data: { data: {} } })),
      publicGetOnce("/food/landing/settings/public", reqConfig)
        .catch(() => ({ data: { data: {} } })),
    ])
      .then(([exploreRes, settingsRes]) => {
        if (cancelled) return;
        const exploreData = exploreRes?.data?.data;
        const items = Array.isArray(exploreData?.items)
          ? exploreData.items
          : Array.isArray(exploreData)
            ? exploreData
            : [];
        const mappedItems = items.map((it) => ({
          ...it,
          imageUrl: it.imageUrl || it.iconUrl,
          label: it.label || it.name,
        }));
        setLandingExploreMore(mappedItems);
        const settings = settingsRes?.data?.data || {};
        const heading = settings.exploreMoreHeading || "Explore More";
        setExploreMoreHeading(heading);
        setRecommendedRestaurantIds(settings.recommendedRestaurantIds || []);
        setUnder250PriceLimit(Number(settings.under250PriceLimit) || 250);
        setRecommendedRestaurantsFromSettings(
          settings.recommendedRestaurants || [],
        );
        const newBannerUrl = typeof settings.festBannerImageUrl === "string" ? settings.festBannerImageUrl : "";
        const newTopColor = typeof settings.festBannerTopColor === "string" && settings.festBannerTopColor ? settings.festBannerTopColor : '';
        setFestBannerImageUrl(newBannerUrl);
        setFestBannerTopColor(newTopColor);
        if (typeof window !== "undefined") {
          try { localStorage.setItem("CACHED_FEST_BANNER", newBannerUrl); } catch (e) {}
          try { localStorage.setItem("CACHED_FEST_BANNER_COLOR", newTopColor); } catch (e) {}
        }
        // Update status bar color immediately from saved color
        if (newBannerUrl && newTopColor) {
          try {
            let meta = document.querySelector('meta[name="theme-color"]');
            if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
            meta.setAttribute('content', newTopColor);
          } catch (e) {}
        } else {
          try {
            const meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute('content', '#D91F3A');
          } catch (e) {}
        }
        setCachedExploreIcons({ items: mappedItems, heading });
        preloadImageUrls(
          mappedItems
            .map((it) => toExploreIconThumbUrl(it.imageUrl || it.image))
            .filter(Boolean),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setLandingExploreMore([]);
          setExploreMoreHeading("Explore More");
          setRecommendedRestaurantsFromSettings([]);
          setFestBannerImageUrl("");
          if (typeof window !== "undefined") {
            try { localStorage.setItem("CACHED_FEST_BANNER", ""); } catch (e) {}
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [zoneId, zoneLoading]);

  // Memoize cartCount to prevent recalculation on every render - use cart directly
  const cartCount = useMemo(
    () => cart.reduce((total, item) => total + (item.quantity || 0), 0),
    [cart],
  );

  const cityName = location?.city || "Select";
  const stateName = location?.state || "Location";
  const hasLiveLocation = useMemo(() => {
    if (!location) return false;

    const isPlaceholder = (value) => {
      if (!value) return true;
      const normalized = String(value).trim().toLowerCase();
      return (
        !normalized ||
        normalized === "select location" ||
        normalized === "current location"
      );
    };

    const hasAddressText =
      !isPlaceholder(location.formattedAddress) ||
      !isPlaceholder(location.address);
    const hasCityState =
      !isPlaceholder(location.city) || !isPlaceholder(location.state);

    return hasAddressText || hasCityState;
  }, [location]);

  const formatSavedAddress = useCallback((address) => {
    if (!address) return "";

    if (
      address.formattedAddress &&
      address.formattedAddress !== "Select location"
    ) {
      return address.formattedAddress;
    }

    const parts = [];
    if (address.additionalDetails) parts.push(address.additionalDetails);
    if (address.street) parts.push(address.street);
    if (address.city) parts.push(address.city);
    if (address.state) parts.push(address.state);
    if (address.zipCode) parts.push(address.zipCode);

    if (parts.length > 0) return parts.join(", ");
    if (address.address && address.address !== "Select location")
      return address.address;

    return "";
  }, []);

  const savedAddressText = useMemo(() => {
    const defaultAddress = getDefaultAddress?.();
    return formatSavedAddress(defaultAddress);
  }, [getDefaultAddress, formatSavedAddress]);

  const defaultSavedAddress = useMemo(
    () => getDefaultAddress?.() || null,
    [getDefaultAddress],
  );

  const defaultSavedAddressLocation = useMemo(() => {
    const coords = defaultSavedAddress?.location?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      const lng = parseFloat(coords[0]);
      const lat = parseFloat(coords[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { latitude: lat, longitude: lng };
      }
    }

    const lat = parseFloat(
      defaultSavedAddress?.latitude || defaultSavedAddress?.lat,
    );
    const lng = parseFloat(
      defaultSavedAddress?.longitude || defaultSavedAddress?.lng,
    );
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng };
    }

    return null;
  }, [defaultSavedAddress]);

  const effectiveLocation = location;
  // Prefer selected/saved delivery address for distance so home cards match cart bill.
  const distanceOrigin = useMemo(() => {
    if (
      Number.isFinite(defaultSavedAddressLocation?.latitude) &&
      Number.isFinite(defaultSavedAddressLocation?.longitude)
    ) {
      return defaultSavedAddressLocation;
    }
    if (
      Number.isFinite(effectiveLocation?.latitude) &&
      Number.isFinite(effectiveLocation?.longitude)
    ) {
      return {
        latitude: Number(effectiveLocation.latitude),
        longitude: Number(effectiveLocation.longitude),
      };
    }
    return null;
  }, [defaultSavedAddressLocation, effectiveLocation]);
  // Single zone hook — duplicate useZone(location) caused double detect + loading flicker.
  const effectiveZoneId = zoneId;
  const effectiveZoneLoading = zoneLoading;

  const showCategorySkeleton = loadingRealCategories || loadingMenuCategories || zoneLoading;
  const showRestaurantSkeleton = isLoadingFilterResults || loadingRestaurants || zoneLoading;
  // While zone/restaurants are settling, never surface a real "0 restaurants" count.
  const isRestaurantsResolving =
    loadingRestaurants ||
    isLoadingFilterResults ||
    zoneLoading;

  // Only flip restaurant loading when the zone actually changes (not every detect flicker).
  const prevResolvedZoneIdRef = useRef(zoneId);
  useEffect(() => {
    if (zoneLoading) return;
    if (prevResolvedZoneIdRef.current === zoneId) return;
    prevResolvedZoneIdRef.current = zoneId;
    setLoadingRealCategories(true);
    setLoadingRestaurants(true);
  }, [zoneId, zoneLoading]);

  // Fetch categories (zone-aware) for the homepage category rail.
  useEffect(() => {
    if (zoneLoading) return;

    let cancelled = false;
    const run = async () => {
      const zoneKey = String(zoneId || "global");
      try {
        // Dedupe repeated calls (StrictMode + zone settling). Cache per zoneKey and share in-flight request.
        const cached = publicCategoriesCacheRef.current.get(zoneKey);
        if (cached) {
          if (!cancelled) {
            setRealCategories(cached);
            setLoadingRealCategories(false);
          }
          return;
        }

        const inFlight = publicCategoriesInFlightRef.current.get(zoneKey);
        if (inFlight) {
          const categories = await inFlight;
          if (!cancelled) {
            setRealCategories(categories);
            setLoadingRealCategories(false);
          }
          return;
        }

        setLoadingRealCategories(true);
        const promise = (async () => {
          const res = await adminAPI.getPublicCategories(zoneId ? { zoneId } : {});
          const list =
            res?.data?.data?.categories ||
            res?.data?.categories ||
            [];
          const categories = Array.isArray(list)
            ? list.map((cat, idx) => ({
              id: String(cat?.id || cat?._id || cat?.slug || idx),
              name: cat?.name || "",
              slug: cat?.slug || String(cat?.name || "").toLowerCase().replace(/\s+/g, "-"),
              image:
                normalizeImageUrl(cat?.image || cat?.imageUrl) ||
                foodImages[idx % foodImages.length] ||
                foodImages[0],
              type: cat?.type || "",
              foodTypeScope: cat?.foodTypeScope || "",
            }))
            : [];

          publicCategoriesCacheRef.current.set(zoneKey, categories);
          return categories;
        })();

        publicCategoriesInFlightRef.current.set(zoneKey, promise);
        const categories = await promise;
        publicCategoriesInFlightRef.current.delete(zoneKey);

        if (!cancelled) {
          setRealCategories(categories);
          HOME_CATEGORIES_CACHE = categories;
          setSessionCache(HOME_CATEGORIES_CACHE_KEY, categories);
        }
      } catch (err) {
        debugWarn("Failed to fetch categories:", err);
        if (!cancelled) setRealCategories(HOME_CATEGORIES_CACHE || []);
      } finally {
        if (!cancelled) setLoadingRealCategories(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [zoneId, zoneLoading, normalizeImageUrl]);



  // Mock points value - replace with actual points from context/store
  const userPoints = 99;

  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [activeTab, setActiveTab] = useState("food");


  // Simple filter toggle function
  const toggleFilter = (filterId) => {
    setActiveFilters((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(filterId)) {
        newSet.delete(filterId);
      } else {
        newSet.add(filterId);
      }
      return newSet;
    });
  };

  // Refs for scroll tracking
  const filterSectionRefs = useRef({});
  const [activeScrollSection, setActiveScrollSection] = useState("sort");
  const rightContentRef = useRef(null);
  const restaurantsRequestSeqRef = useRef(0);
  const menuUnionRequestSeqRef = useRef(0);
  const menuUnionCacheRef = useRef(new Map());

  // Scroll tracking effect
  useEffect(() => {
    if (!isFilterOpen || !rightContentRef.current) return;

    const observerOptions = {
      root: rightContentRef.current,
      rootMargin: "-20% 0px -70% 0px",
      threshold: 0,
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const sectionId = entry.target.getAttribute("data-section-id");
          if (sectionId) {
            setActiveScrollSection(sectionId);
            setActiveFilterTab(sectionId);
          }
        }
      });
    }, observerOptions);

    // Observe all filter sections
    Object.values(filterSectionRefs.current).forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, [isFilterOpen]);

  // Fetch restaurants from API with filters
  const fetchRestaurants = useCallback(
    async (filters = {}) => {
        if (!effectiveZoneId) {
          setRestaurantsData([]);
          setLoadingRestaurants(false);
          return;
        }

        const requestSeq = ++restaurantsRequestSeqRef.current;
      try {
        // Soft refresh: keep cached list visible — don't flash full-page skeleton
        if (!(Array.isArray(HOME_RESTAURANTS_CACHE) && HOME_RESTAURANTS_CACHE.length > 0)) {
          setLoadingRestaurants(true);
        }

        // Backend disconnected - new backend in progress. Skip health check.

        // Build query parameters from filters
        const params = {};

        // Use saved/selected delivery address coords (same origin as cart bill).
        if (
          Number.isFinite(distanceOrigin?.latitude) &&
          Number.isFinite(distanceOrigin?.longitude)
        ) {
          params.lat = Number(distanceOrigin.latitude);
          params.lng = Number(distanceOrigin.longitude);
        }

        // Limit results for performance
        params.limit = 40;

        // Sort by
        if (filters.sortBy || sortBy) {
          params.sortBy = filters.sortBy || sortBy;
        }

        // Order Type (Takeaway/Delivery)
        if (effectiveOrderType) {
          params.orderType = effectiveOrderType;
        }

        // Cuisine
        if (filters.selectedCuisine) {
          params.cuisine = filters.selectedCuisine;
        }

        // Rating filters
        if (filters.activeFilters?.has("rating-45-plus")) {
          params.minRating = 4.5;
        } else if (filters.activeFilters?.has("rating-4-plus")) {
          params.minRating = 4.0;
        } else if (filters.activeFilters?.has("rating-35-plus")) {
          params.minRating = 3.5;
        }

        // Delivery time filters
        if (filters.activeFilters?.has("delivery-under-30")) {
          params.maxDeliveryTime = 30;
        } else if (filters.activeFilters?.has("delivery-under-45")) {
          params.maxDeliveryTime = 45;
        }

        // Distance filters
        if (filters.activeFilters?.has("distance-under-1km")) {
          params.radiusKm = 1.0;
        } else if (filters.activeFilters?.has("distance-under-2km")) {
          params.radiusKm = 2.0;
        }

        // Price filters
        if (filters.activeFilters?.has("price-under-200")) {
          params.maxPrice = 200;
        } else if (filters.activeFilters?.has("price-under-500")) {
          params.maxPrice = 500;
        }

        // Offers filter
        if (filters.activeFilters?.has("has-offers")) {
          params.hasOffers = "true";
        }

        // Trust filters
        if (filters.activeFilters?.has("top-rated")) {
          params.topRated = "true";
        } else if (filters.activeFilters?.has("trusted")) {
          params.trusted = "true";
        }

        if (effectiveZoneId) {
          params.zoneId = effectiveZoneId;
        } else {
          // Zone id vanished mid-request — keep resolving state, don't flash 0.
          setLoadingRestaurants(true);
          return;
        }

        // Zone-based delivery: do NOT filter by city name.
        // Villages like "Dugal Kalan" / "Dogal" sit inside a zone whose restaurants
        // are typically registered under the main town (e.g. "Patran"). City matching
        // incorrectly returns 0 restaurants even when the pin is inside the zone.
        const resolvedCity = resolveServiceCity({
          locality: effectiveLocation?.city || "",
          formattedAddress:
            effectiveLocation?.formattedAddress ||
            effectiveLocation?.address ||
            "",
          fallback: "",
        });
        const normalizedUserCity = String(resolvedCity || effectiveLocation?.city || "")
          .trim()
          .toLowerCase();
        const hasUsableUserCity =
          normalizedUserCity &&
          normalizedUserCity !== "current location" &&
          normalizedUserCity !== "unknown city" &&
          normalizedUserCity !== "select location";
        if (!effectiveZoneId && hasUsableUserCity) {
          params.city = resolvedCity || String(effectiveLocation.city).trim();
        }

        debugLog("Fetching restaurants with params:", params);
        const response = await restaurantAPI.getRestaurants(params);
        debugLog("Restaurants API response:", response.data);

        // If a newer request started, ignore this response to avoid races/flicker.
        if (requestSeq !== restaurantsRequestSeqRef.current) return;

        if (
          response.data &&
          response.data.success &&
          response.data.data &&
          response.data.data.restaurants
        ) {
          const restaurantsArray = response.data.data.restaurants;
          debugLog(`Fetched ${restaurantsArray.length} restaurants from API`);

          if (restaurantsArray.length === 0) {
            debugWarn("No restaurants found in API response");
            setRestaurantsData([]);
            if (requestSeq === restaurantsRequestSeqRef.current) {
              setLoadingRestaurants(false);
            }
            return;
          }

          const userLat = effectiveLocation?.latitude;
          const userLng = effectiveLocation?.longitude;

          const transformedRestaurants = restaurantsArray
            .filter((restaurant) => {
              if (effectiveOrderType === "takeaway" || isTakeawayPage) {
                if (!restaurant.takeawaySettings?.isEnabled && !restaurant.takeawayAvailable) {
                  return false;
                }
              }
              return true
            })
            .map((restaurant, index) => {
              // Use restaurant data if available, otherwise use defaults
              const deliveryTime =
                restaurant.estimatedDeliveryTime || "25-30 mins";

              // Use pre-calculated distance from backend
              const distance = restaurant.distance || null;
              const distanceInKm = Number.isFinite(Number(restaurant.distanceInKm))
                ? Number(restaurant.distanceInKm)
                : null;
              const topOrder = Number.isFinite(Number(restaurant.__topOrder ?? restaurant.topOrder))
                ? Number(restaurant.__topOrder ?? restaurant.topOrder)
                : 1000000;

              // Get first cuisine or default
              const cuisine =
                restaurant.cuisines && restaurant.cuisines.length > 0
                  ? restaurant.cuisines[0]
                  : "Multi-cuisine";

              // Legacy-safe image extraction (supports old schema variants).
              const coverImages = extractImages([
                ...(Array.isArray(restaurant.coverImages) ? restaurant.coverImages : [restaurant.coverImages]).filter(Boolean),
                restaurant.coverImage,
              ]);

              const profileImageCandidates = extractImages([
                ...buildRestaurantImageCandidates(restaurant.profileImage),
                ...buildRestaurantImageCandidates(
                  restaurant.onboarding?.step2?.profileImageUrl,
                ),
                ...buildRestaurantImageCandidates(restaurant.image),
                ...buildRestaurantImageCandidates(restaurant.imageUrl),
              ]);
              const profileImageUrl = profileImageCandidates[0] || "";

              const allImages = Array.from(
                new Set(
                  [
                    ...coverImages,
                    ...profileImageCandidates,
                  ].filter(Boolean),
                ),
              );

              // Keep single image for backward compatibility
              const image = allImages[0] || profileImageUrl || "";
              const offerText = restaurant.offer || null;

              return {
                id: restaurant.restaurantId || restaurant._id,
                mongoId: restaurant._id || null,
                name: getRestaurantDisplayName(restaurant),
                cuisine: cuisine,
                cuisines: Array.isArray(restaurant.cuisines)
                  ? restaurant.cuisines
                  : [],
                rating: Number(restaurant.rating) || 0,
                totalRatings: Number(restaurant.totalRatings) || 0,
                deliveryTime:
                  (effectiveOrderType === "takeaway" || isTakeawayPage)
                    ? (restaurant.preparationTime || "20-25 mins")
                    : (restaurant.deliveryTime ||
                      restaurant.estimatedDeliveryTime ||
                      (restaurant.estimatedDeliveryTimeMinutes
                        ? `${restaurant.estimatedDeliveryTimeMinutes} mins`
                        : deliveryTime)),
                takeawaySettings: restaurant.takeawaySettings || null,
                distance: distance,
                distanceInKm: distanceInKm, // Store numeric distance for sorting
                topOrder,
                __topOrder: topOrder,
                image: image,
                images: allImages, // Array of cover images for carousel (separate from menu images)
                priceRange: restaurant.priceRange || "$$", // Use from API or default
                featuredDish:
                  restaurant.featuredDish ||
                  (Array.isArray(restaurant.recommendedDishes) && restaurant.recommendedDishes.length > 0
                    ? restaurant.recommendedDishes[0].name
                    : (restaurant.cuisines && restaurant.cuisines.length > 0
                      ? `${restaurant.cuisines[0]} Special`
                      : "Special Dish")),
                featuredPrice: restaurant.featuredPrice ||
                  (Array.isArray(restaurant.recommendedDishes) && restaurant.recommendedDishes.length > 0
                    ? restaurant.recommendedDishes[0].price
                    : 249),
                offer: offerText,
                slug: restaurant.slug,
                restaurantId: restaurant.restaurantId,
                pureVegRestaurant: restaurant.pureVegRestaurant === true,
                location: restaurant.location, // Store location for distance recalculation
                isActive: restaurant.isActive !== false, // Default to true if not specified
                isAcceptingOrders: restaurant.isAcceptingOrders !== false, // Default to true if not specified
                openDays: Array.isArray(restaurant.openDays)
                  ? restaurant.openDays
                  : [],
                deliveryTimings: restaurant.deliveryTimings || null,
                outletTimings: restaurant.outletTimings || null,
                openingTime: restaurant.openingTime || restaurant?.deliveryTimings?.openingTime || null,
                closingTime: restaurant.closingTime || restaurant?.deliveryTimings?.closingTime || null,
                recommendedDishes: Array.isArray(restaurant.recommendedDishes) ? restaurant.recommendedDishes : [],
                hasDishes: restaurant.hasDishes === true || (restaurant.totalMenuItems > 0),
                totalMenuItems: restaurant.totalMenuItems || 0,
              };
            });

          // Commit list + end loading in the same turn so UI never paints "0" in between.
          setRestaurantsData(transformedRestaurants);
          HOME_RESTAURANTS_CACHE = transformedRestaurants;
          setSessionCache('food_home_restaurants', transformedRestaurants);
          if (requestSeq === restaurantsRequestSeqRef.current) {
            setLoadingRestaurants(false);
          }
        } else {
          debugWarn("Invalid API response structure:", response.data);
          setRestaurantsData([]);
          if (requestSeq === restaurantsRequestSeqRef.current) {
            setLoadingRestaurants(false);
          }
        }
      } catch (error) {
        debugError("Error fetching restaurants:", error);
        debugError("Error details:", error.response?.data || error.message);
        // Don't set hardcoded data here - let the useMemo fallback handle it
        // This way, if API succeeds later, it will show the real data
        setRestaurantsData([]);
        if (requestSeq === restaurantsRequestSeqRef.current) {
          setLoadingRestaurants(false);
        }
      }
    },
    [
      extractImages,
      buildRestaurantImageCandidates,
      distanceOrigin?.latitude,
      distanceOrigin?.longitude,
      effectiveLocation?.latitude,
      effectiveLocation?.longitude,
      effectiveZoneId,
      effectiveOrderType,
      isTakeawayPage,
    ],
  );

  const applyFiltersAndRefetch = useCallback(
    async (
      nextActiveFilters = activeFilters,
      nextSortBy = sortBy,
      nextSelectedCuisine = selectedCuisine,
    ) => {
      const nextFilterState = {
        activeFilters: new Set(nextActiveFilters),
        sortBy: nextSortBy,
        selectedCuisine: nextSelectedCuisine,
      };

      setAppliedFilters(nextFilterState);
      setIsLoadingFilterResults(true);

      try {
        await fetchRestaurants(nextFilterState);
      } catch (error) {
        debugError("Error applying filters:", error);
      } finally {
        setIsLoadingFilterResults(false);
      }
    },
    [activeFilters, sortBy, selectedCuisine, fetchRestaurants],
  );

  // Fetch when filters/orderType/zone settle. Wait for zoneLoading so we never
  // skip a fetch and get stuck on "Finding Restaurants For You".
  useEffect(() => {
    if (zoneLoading) return;
    if (!effectiveZoneId) {
      setRestaurantsData([]);
      setLoadingRestaurants(false);
      return;
    }
    const timer = setTimeout(() => {
      fetchRestaurants(appliedFilters);
    }, 50);
    return () => clearTimeout(timer);
  }, [appliedFilters, fetchRestaurants, effectiveOrderType, zoneLoading, effectiveZoneId]);



  // IMPORTANT:
  // Homepage must NOT eagerly hit /menu for every restaurant (N+1 storm).
  // Menu meta is only needed for Veg Mode diet filtering. Category rail uses
  // admin/public categories, then landing fallbacks — never per-restaurant menus.
  useEffect(() => {
    const restaurantIds = menuUnionRestaurantIdsKey
      ? menuUnionRestaurantIdsKey.split(",").filter(Boolean)
      : [];
    const shouldFetchMenuMeta = Boolean(vegMode);

    const fetchMenuCategories = async () => {
      const requestSeq = ++menuUnionRequestSeqRef.current;

      if (!menuUnionRestaurantIdsKey || !shouldFetchMenuMeta) {
        setMenuCategories([]);
        if (!vegMode) setRestaurantDietMeta({});
        setLoadingMenuCategories(false);
        return;
      }

      setLoadingMenuCategories(true);
      try {
        const categoryMap = new Map();
        const menuCache = menuUnionCacheRef.current;
        const menuResponses = [];

        for (let index = 0; index < restaurantIds.length; index += 4) {
          const batchIds = restaurantIds.slice(index, index + 4);
          const batchResponses = await Promise.all(
            batchIds.map(async (id) => {
              if (!id) return { id: null, menu: null };

              if (menuCache.has(id)) {
                return { id, menu: menuCache.get(id) };
              }

              try {
                const response = await restaurantAPI.getMenuByRestaurantId(id);
                const menu = response?.data?.data?.menu || null;
                menuCache.set(id, menu);
                return { id, menu };
              } catch {
                menuCache.set(id, null);
                return { id, menu: null };
              }
            }),
          );

          if (requestSeq !== menuUnionRequestSeqRef.current) return;
          menuResponses.push(...batchResponses);
        }

        if (requestSeq !== menuUnionRequestSeqRef.current) return;

        const nextDietMeta = {};

        menuResponses.forEach(({ id, menu }) => {
          let hasVeg = false;
          let hasNonVeg = false;
          const markItemDiet = (item) => {
            const foodType = String(item?.foodType || "")
              .trim()
              .toLowerCase();
            if (foodType === "veg" || item?.isVeg === true) {
              hasVeg = true;
              return "veg";
            }
            if (
              foodType === "non-veg" ||
              foodType === "non veg" ||
              foodType === "nonveg" ||
              foodType.includes("non") ||
              item?.isVeg === false
            ) {
              hasNonVeg = true;
              return "non-veg";
            }
            return "unknown";
          };
          const sections = Array.isArray(menu?.sections) ? menu.sections : [];
          sections.forEach((section) => {
            const sectionItems = Array.isArray(section?.items)
              ? section.items
              : [];
            let sectionHasVeg = false;
            sectionItems.forEach((item) => {
              if (markItemDiet(item) === "veg") sectionHasVeg = true;
            });

            const subsections = Array.isArray(section?.subsections)
              ? section.subsections
              : [];
            subsections.forEach((subsection) => {
              const subsectionItems = Array.isArray(subsection?.items)
                ? subsection.items
                : [];
              subsectionItems.forEach((item) => {
                if (markItemDiet(item) === "veg") sectionHasVeg = true;
              });
            });

            const categoryName = String(section?.name || "").trim();
            if (!categoryName) return;

            const slug = slugifyCategory(categoryName);
            if (!slug) return;

            // Skip non-veg-only sections when veg mode is on
            if (vegMode && !sectionHasVeg) return;

            let image = "";
            if (Array.isArray(section?.items) && section.items.length > 0) {
              image = normalizeImageUrl(section.items[0]?.image);
            }
            if (!image && Array.isArray(section?.subsections)) {
              for (const subsection of section.subsections) {
                if (
                  Array.isArray(subsection?.items) &&
                  subsection.items.length > 0
                ) {
                  image = normalizeImageUrl(subsection.items[0]?.image);
                  if (image) break;
                }
              }
            }

            if (!categoryMap.has(slug)) {
              categoryMap.set(slug, {
                id: slug,
                name: categoryName,
                slug,
                label: categoryName,
                image: image || "",
              });
            } else if (image && !categoryMap.get(slug).image) {
              categoryMap.get(slug).image = image;
            }
          });

          if (id) {
            nextDietMeta[id] = {
              hasVeg,
              hasNonVeg,
              isPureVeg: hasVeg && !hasNonVeg,
            };
          }
        });

        const categories = Array.from(categoryMap.values())
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((category, index) => ({
            ...category,
            image:
              category.image ||
              foodImages[index % foodImages.length] ||
              foodImages[0],
          }));

        setMenuCategories(categories);
        setRestaurantDietMeta(nextDietMeta);
      } finally {
        if (requestSeq === menuUnionRequestSeqRef.current) {
          setLoadingMenuCategories(false);
        }
      }
    };

    fetchMenuCategories();
  }, [
    menuUnionRestaurantIdsKey,
    normalizeImageUrl,
    slugifyCategory,
    vegMode,
  ]);

  const matchesVegMode = useCallback(
    (restaurant) => {
      if (!vegMode) return true;
      if (vegModeOption !== "pure-veg") return true; // "all": show all restaurants; dishes filtered elsewhere

      const id = String(
        restaurant?.id || restaurant?.restaurantId || restaurant?.mongoId || "",
      );
      const meta = id ? restaurantDietMeta?.[id] : null;

      // Menu scan available — evidence wins over the restaurant flag
      if (meta) {
        if (meta.hasNonVeg === true) return false;
        if (meta.isPureVeg === true) return true;
        if (meta.hasVeg === true && meta.hasNonVeg === false) return true;
        return false;
      }

      // Meta not loaded yet — provisional trust of admin pure-veg flag
      return restaurant?.pureVegRestaurant === true;
    },
    [vegMode, vegModeOption, restaurantDietMeta],
  );

  const matchesTakeawayName = useCallback((restaurant, q) => {
    const name = String(restaurant?.name || restaurant?.restaurantName || "")
      .trim()
      .toLowerCase();
    const slug = String(restaurant?.slug || "")
      .trim()
      .toLowerCase()
      .replace(/-/g, " ");
    return name.includes(q) || slug.includes(q);
  }, []);

  // Filter restaurants and foods based on active filters
  const filteredRestaurants = useMemo(() => {
    let result = (restaurantsData || []).filter(matchesVegMode);

    if (effectiveOrderType === "takeaway" || isTakeawayPage) {
      result = result.filter(
        (restaurant) =>
          restaurant?.takeawaySettings?.isEnabled === true ||
          restaurant?.takeawayAvailable === true,
      );

      if (heroSearch.trim()) {
        const q = heroSearch.trim().toLowerCase();
        result = result.filter((restaurant) => matchesTakeawayName(restaurant, q));
      }
    }

    // Online first → pinned top order → nearest distance (same when all offline)
    const sortedResult = result
      .map((restaurant, index) => ({ restaurant, index }))
      .sort((a, b) => {
        const byBrowse = compareRestaurantsByAvailabilityAndDistance(
          a.restaurant,
          b.restaurant,
          { now: new Date(availabilityTick) },
        );
        if (byBrowse !== 0) return byBrowse;
        return a.index - b.index;
      })
      .map((item) => item.restaurant);

    return sortedResult;
  }, [restaurantsData, matchesVegMode, effectiveOrderType, isTakeawayPage, heroSearch, matchesTakeawayName, availabilityTick]);

  // Stable browse path — don't use restaurant URL while Home stays mounted underneath
  const homeBrowsePath =
    homeMode === "takeaway" || isTakeawayPage
      ? "/user/takeaway"
      : homeMode === "delivery"
        ? "/user"
        : routerLocation.pathname || "/user";

  const rememberHomeBrowsePosition = useCallback((focusId) => {
    saveBrowseScroll({
      path: homeBrowsePath,
      scrollY: typeof window !== "undefined" ? window.scrollY : 0,
      focusId,
      visibleCount: visibleRestaurantCount,
    });
  }, [visibleRestaurantCount, homeBrowsePath]);

  // Category open from Home: lock current scroll (often top) so back lands here — not mid-page.
  const rememberLeaveForCategory = useCallback(() => {
    const y =
      typeof window !== "undefined" ? Math.max(0, window.scrollY || 0) : 0;
    const tabKey =
      homeMode === "takeaway" || isTakeawayPage ? "takeaway" : "delivery";
    try {
      sessionStorage.setItem(`main_tab_scroll_${tabKey}`, String(y));
    } catch {
      // ignore
    }
    saveBrowseScroll({
      path: homeBrowsePath,
      scrollY: y,
      focusId: null,
      visibleCount: visibleRestaurantCount,
    });
  }, [homeBrowsePath, homeMode, isTakeawayPage, visibleRestaurantCount]);

  // Allow restore again after leaving for restaurant (tabs stay mounted now)
  useEffect(() => {
    if (!isTabActive) {
      hasRestoredBrowseScrollRef.current = false;
    }
  }, [isTabActive]);

  // After back from restaurant details: restore exact scrollY before paint (list already in memory)
  useLayoutEffect(() => {
    if (!isTabActive) return;
    if (hasRestoredBrowseScrollRef.current) return;

    const browsePath = homeBrowsePath;
    const pending = peekBrowseScroll(browsePath);
    if (!pending) return;

    const targetY = Math.max(0, Number(pending.scrollY) || 0);
    window.scrollTo({ top: targetY, left: 0, behavior: "instant" });

    if (loadingRestaurants) return;
    if (!Array.isArray(filteredRestaurants) || filteredRestaurants.length === 0) return;

    let needed = Math.min(
      Math.max(Number(pending.visibleCount) || 0, RESTAURANTS_BATCH_SIZE),
      filteredRestaurants.length,
    );

    if (pending.focusId) {
      const focusKey = String(pending.focusId);
      const focusIndex = filteredRestaurants.findIndex((r) => {
        const slug = String(r.slug || r.name || "")
          .toLowerCase()
          .replace(/[\s/]+/g, "-");
        return (
          String(r.mongoId || "") === focusKey ||
          String(r.id || "") === focusKey ||
          slug === focusKey
        );
      });
      if (focusIndex >= 0) {
        needed = Math.min(
          Math.max(needed, focusIndex + 1, RESTAURANTS_BATCH_SIZE),
          filteredRestaurants.length,
        );
      }
    }

    if (needed > visibleRestaurantCount) {
      setVisibleRestaurantCount(needed);
      return;
    }

    if (pending.focusId) {
      const safeId = String(pending.focusId).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const el = document.querySelector(`[data-browse-focus="${safeId}"]`);
      if (!el && needed < filteredRestaurants.length) {
        setVisibleRestaurantCount((prev) =>
          Math.min(prev + RESTAURANTS_BATCH_SIZE, filteredRestaurants.length),
        );
        return;
      }
    }

    const saved = consumeBrowseScroll(browsePath);
    if (!saved) return;
    hasRestoredBrowseScrollRef.current = true;
    return restoreBrowseScroll(saved);
  }, [
    isTabActive,
    loadingRestaurants,
    filteredRestaurants,
    visibleRestaurantCount,
    RESTAURANTS_BATCH_SIZE,
    homeBrowsePath,
  ]);

  const restaurantLazyLoadResetKey = useMemo(() => {
    const activeFilterKey = Array.from(activeFilters).sort().join("|");
    return `${restaurantsData.length}:${activeFilterKey}:${selectedCuisine || ""}:${sortBy || ""}:${vegMode ? "1" : "0"}:${vegModeOption}:${heroSearch || ""}`;
  }, [activeFilters, restaurantsData.length, selectedCuisine, sortBy, vegMode, vegModeOption, heroSearch]);

  const isTakeawayActive = effectiveOrderType === "takeaway" || isTakeawayPage;
  const takeawaySearchQuery = isTakeawayActive ? heroSearch.trim() : "";
  const isTakeawaySearching = takeawaySearchQuery.length > 0;
  const showTakeawaySearchEmpty =
    isTakeawayActive &&
    isTakeawaySearching &&
    !loadingRestaurants &&
    !showRestaurantSkeleton &&
    filteredRestaurants.length === 0;

  const takeawaySectionSubtitle = useMemo(() => {
    if (isRestaurantsResolving) return "Finding Restaurants For You";
    if (!isTakeawayActive) {
      return `${filteredRestaurants.length} Restaurants Delivering to You`;
    }
    if (isTakeawaySearching) {
      if (filteredRestaurants.length === 0) return null;
      return filteredRestaurants.length === 1
        ? `1 result for "${takeawaySearchQuery}"`
        : `${filteredRestaurants.length} results for "${takeawaySearchQuery}"`;
    }
    return `${filteredRestaurants.length} Restaurant${filteredRestaurants.length === 1 ? "" : "s"} near you`;
  }, [
    isRestaurantsResolving,
    isTakeawayActive,
    isTakeawaySearching,
    filteredRestaurants.length,
    takeawaySearchQuery,
  ]);

  const takeawaySectionTitle = useMemo(() => {
    if (!isTakeawayActive) return "Featured Restaurants";
    if (isTakeawaySearching) return "Search Results";
    return "Takeaway Restaurants";
  }, [isTakeawayActive, isTakeawaySearching]);

  const visibleRestaurants = useMemo(
    () => filteredRestaurants.slice(0, visibleRestaurantCount),
    [filteredRestaurants, visibleRestaurantCount],
  );

  const hasMoreRestaurants =
    visibleRestaurantCount < filteredRestaurants.length;

  const loadMoreRestaurants = useCallback(() => {
    setVisibleRestaurantCount((previous) =>
      Math.min(previous + RESTAURANTS_BATCH_SIZE, filteredRestaurants.length),
    );
  }, [filteredRestaurants.length, RESTAURANTS_BATCH_SIZE]);

  useEffect(() => {
    // Don't collapse the list while Home is hidden under restaurant/category
    if (!isTabActive) return;

    // Keep expanded list when returning from a restaurant (browse scroll pending)
    const pending = peekBrowseScroll(homeBrowsePath);
    if (pending?.visibleCount) {
      const needed = Math.min(
        Math.max(Number(pending.visibleCount) || 0, RESTAURANTS_BATCH_SIZE),
        Math.max(filteredRestaurants.length, Number(pending.visibleCount) || 0),
      );
      setVisibleRestaurantCount(needed);
      return;
    }
    if (hasRestoredBrowseScrollRef.current) return;

    setVisibleRestaurantCount(
      Math.min(RESTAURANTS_BATCH_SIZE, filteredRestaurants.length),
    );
  }, [
    restaurantLazyLoadResetKey,
    filteredRestaurants.length,
    RESTAURANTS_BATCH_SIZE,
    homeBrowsePath,
    isTabActive,
  ]);

  useEffect(() => {
    if (visibleRestaurantCount <= filteredRestaurants.length) return;
    setVisibleRestaurantCount(filteredRestaurants.length);
  }, [filteredRestaurants.length, visibleRestaurantCount]);

  useEffect(() => {
    if (!hasMoreRestaurants) return;
    if (!isTabActive) return;
    if (showRestaurantSkeleton || loadingRestaurants || isLoadingFilterResults) return;
    const target = restaurantLoadMoreRef.current;
    if (!target || typeof window === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) return;
        startTransition(() => {
          loadMoreRestaurants();
        });
      },
      {
        root: null,
        rootMargin: "240px 0px",
        threshold: 0.01,
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [
    hasMoreRestaurants,
    isTabActive,
    showRestaurantSkeleton,
    loadingRestaurants,
    isLoadingFilterResults,
    loadMoreRestaurants,
  ]);

  const recommendedForYouRestaurants = useMemo(() => {
    const idsInOrder = (recommendedRestaurantIds || []).map((id) => String(id));
    const hasIds = idsInOrder.length > 0;
    const fromSettings = Array.isArray(recommendedRestaurantsFromSettings)
      ? recommendedRestaurantsFromSettings.filter(r => !r.zoneId || !zoneId || String(r.zoneId) === String(zoneId))
      : [];

    // Primary source: restaurants returned by landing settings API (already admin-selected).
    const fromSettingsMapped = fromSettings.map((restaurant) => {
      const restaurantId = restaurant?._id ? String(restaurant._id) : "";
      const cuisine =
        Array.isArray(restaurant?.cuisines) && restaurant.cuisines.length > 0
          ? restaurant.cuisines[0]
          : "Multi-cuisine";
      const imageCandidates = extractImages([
        ...(Array.isArray(restaurant?.coverImages)
          ? restaurant.coverImages
          : [restaurant?.coverImages]
        ).filter(Boolean),
        restaurant?.profileImage,
      ]);
      const image = imageCandidates[0] || foodImages[0];

      return {
        id: restaurant?.restaurantId || restaurantId,
        mongoId: restaurantId,
        name: getRestaurantDisplayName(restaurant),
        cuisine,
        rating: Number(restaurant?.rating) || 0,
        distance: "",
        deliveryTime: "",
        image: normalizeImageUrl(image) || foodImages[0],
        images: imageCandidates.length > 0 ? imageCandidates : [foodImages[0]],
        slug: restaurant?.slug || restaurant?.restaurantId || restaurantId,
        offer: null,
        pureVegRestaurant: restaurant?.pureVegRestaurant === true,
        isActive: restaurant?.isActive !== false,
        isAcceptingOrders: restaurant?.isAcceptingOrders !== false,
        openingTime: restaurant?.openingTime || null,
        closingTime: restaurant?.closingTime || null,
        openDays: Array.isArray(restaurant?.openDays) ? restaurant.openDays : [],
      };
    });

    // Keep admin-selected order when IDs exist.
    const orderedFromSettings = hasIds
      ? idsInOrder
        .map((id) =>
          fromSettingsMapped.find(
            (restaurant) => String(restaurant.mongoId) === id,
          ),
        )
        .filter(Boolean)
      : fromSettingsMapped;

    // Fallback: if settings payload misses some entries, recover them from fetched restaurant list by ID.
    const existingIds = new Set(
      orderedFromSettings.map((restaurant) =>
        String(restaurant.mongoId || restaurant.id),
      ),
    );
    const fromFetchedMissing = (restaurantsData || []).filter((restaurant) => {
      const mongoId = String(restaurant.mongoId || "");
      return (
        hasIds && idsInOrder.includes(mongoId) && !existingIds.has(mongoId)
      );
    });

    return [...orderedFromSettings, ...fromFetchedMissing]
      .filter(matchesVegMode)
      .slice(0, 12);
  }, [
    recommendedRestaurantIds,
    recommendedRestaurantsFromSettings,
    restaurantsData,
    extractImages,
    normalizeImageUrl,
    matchesVegMode,
  ]);

  // Featured foods removed - will be handled by restaurants data from API
  const filteredFeaturedFoods = useMemo(() => {
    // Return empty array - featured foods will come from API if needed
    return [];
  }, [activeFilters, sortBy]);

  // Memoize callbacks to prevent unnecessary re-renders
  const handleLocationClick = useCallback(() => {
    openLocationSelector();
  }, [openLocationSelector]);

  const handleSearchFocus = useCallback(() => {
    if (effectiveOrderType === "takeaway" || isTakeawayPage) {
      setTakeawaySearchOpen(true);
      return;
    }
    navigate("/food/user/search?mode=delivery");
  }, [navigate, orderType, isTakeawayPage]);

  const handleSearchClose = useCallback(() => {
    closeSearch();
    setHeroSearch("");
  }, [closeSearch]);

  // Removed GSAP animations - using CSS and ScrollReveal components instead for better performance
  // Auto-scroll removed - manual scroll only

  // Animated placeholder cycling - same as RestaurantDetails highlight offer animation
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % placeholders.length);
    }, 2000); // Change placeholder every 2 seconds (same as RestaurantDetails)

    return () => clearInterval(interval);
  }, []); // placeholders is a constant, no need for dependency

  // Memoized Hero Banner Component for better perf
  const HeroBannerSection = useMemo(() => {
    if (showBannerSkeleton) {
      return (
        <div className="px-4 py-2">
          <HeroBannerSkeleton className="h-36 sm:h-44 lg:h-56 rounded-2xl" />
        </div>
      );
    }

    if (heroBannerImages.length === 0) return null;

    // Create the slides array with the first banner duplicated at the end
    const slides = heroBannerImages.length > 1
      ? [...heroBannerImages, heroBannerImages[0]]
      : heroBannerImages;

    const transitionStyle = isTransitionEnabled
      ? "transform 500ms cubic-bezier(0.25, 1, 0.5, 1)"
      : "none";

    const activeDotIndex = currentBannerIndex === heroBannerImages.length
      ? 0
      : currentBannerIndex;

    return (
      <div className="px-4 py-2">
        <div
          ref={heroShellRef}
          data-home-hero-shell="true"
          className="relative w-full overflow-hidden aspect-[1.7/1] sm:aspect-[1.9/1] lg:aspect-[2.1/1] min-h-[180px] sm:min-h-[220px] lg:min-h-[260px] rounded-2xl shadow-sm group cursor-pointer bg-white"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Sliding Track for Banners */}
          <div
            className="flex w-full h-full"
            style={{
              transform: `translateX(-${currentBannerIndex * 100}%)`,
              transition: transitionStyle
            }}
          >
            {slides.map((image, index) => (
              <div
                key={`${index}-${image}`}
                className="w-full h-full flex-shrink-0 relative"
              >
                <img
                  src={image}
                  alt={`Hero Banner ${index + 1}`}
                  className="h-full w-full object-cover select-none"
                  draggable={false}
                />
              </div>
            ))}
          </div>

          {/* Shining Glint Effect */}
          <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
            <motion.div
              animate={{
                x: ['-200%', '200%'],
              }}
              transition={{
                duration: 2.5,
                repeat: Infinity,
                repeatDelay: 5,
                ease: "easeInOut"
              }}
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-[-20deg] w-[150%] h-full"
            />
          </div>

          {/* Clickable Overlay to Navigate */}
          <button
            type="button"
            className="absolute inset-0 z-20 h-full w-full border-0 p-0 bg-transparent text-left"
            onClick={() => {
              const actualIndex = currentBannerIndex === heroBannerImages.length ? 0 : currentBannerIndex;
              const bannerData = heroBannersData[actualIndex];
              const allLinked = bannerData?.linkedRestaurants || [];
              const linkedRestaurants = zoneId ? allLinked.filter(r => !r.zoneId || String(r.zoneId) === String(zoneId)) : allLinked;
              if (linkedRestaurants.length > 0) {
                const firstRestaurant = linkedRestaurants[0];
                const restaurantId =
                  getRestaurantRouteId(firstRestaurant) ||
                  firstRestaurant.restaurantId ||
                  firstRestaurant._id;
                if (restaurantId) {
                  navigate(toFoodUserPath(`/user/restaurants/${restaurantId}`));
                }
              }
            }}
            aria-label={`Open hero banner ${currentBannerIndex + 1}`}
          />

          {/* Bottom Right Carousel Pagination Dots */}
          {heroBannerImages.length > 1 && (
            <div className="absolute bottom-3 right-3 z-30 flex items-center gap-1.5 pointer-events-auto">
              {heroBannerImages.map((_, dotIndex) => (
                <button
                  key={dotIndex}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsTransitionEnabled(true);
                    setCurrentBannerIndex(dotIndex);
                    resetAutoSlide();
                  }}
                  className={`transition-all duration-300 rounded-full ${
                    activeDotIndex === dotIndex
                      ? "w-4 h-1.5 bg-white shadow-sm"
                      : "w-1.5 h-1.5 bg-white/50 hover:bg-white/80"
                  }`}
                  aria-label={`Go to banner ${dotIndex + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }, [heroBannerImages, currentBannerIndex, isTransitionEnabled, showBannerSkeleton, heroBannersData, navigate, resetAutoSlide]);

  // Memoized Category Rail Component
  const CategoryRailSection = useMemo(() => {
    return (
      <section className="space-y-1 sm:space-y-1.5 lg:space-y-2 min-h-[108px] sm:min-h-[120px]">
        <div
          ref={categoryScrollRef}
          className="flex gap-3 sm:gap-4 lg:gap-5 overflow-x-auto overflow-y-visible scrollbar-hide scroll-smooth px-2 sm:px-3 py-2 sm:py-3"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          {/* Meals Under 200 Card */}
          <div
            className="flex-shrink-0 flex flex-col items-center gap-2 cursor-pointer transition-transform hover:scale-105 active:scale-95"
            onClick={() => navigate(toFoodUserPath("/user/under-250"))}
          >
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-[#DC2626] rounded-b-full rounded-t-sm shadow-md border-t-4 border-orange-200 flex flex-col items-center justify-center p-1">
              <span className="text-[10px] sm:text-xs font-bold text-white text-center leading-tight">UNDER</span>
              <span className="text-sm sm:text-base font-extrabold text-white">₹200</span>
              <div className="w-10 h-3.5 bg-white rounded-full mt-1 flex items-center justify-center">
                <span className="text-[8px] font-bold text-[#DC2626]">Explore</span>
              </div>
            </div>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Offers</span>
          </div>

          {showCategorySkeleton ? (
            <CategoryChipRowSkeleton className="py-1" />
          ) : (
            displayCategories.slice(0, 12).map((category, index) => (
              <Link
                key={category.id || index}
                to={`/food/user/category/${category.slug || category.name.toLowerCase().replace(/\s+/g, "-")}`}
                onClick={rememberLeaveForCategory}
                className="flex-shrink-0 flex flex-col items-center gap-2 group transition-all duration-300 hover:-translate-y-1"
              >
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full overflow-hidden shadow-sm border border-gray-100 dark:border-gray-800 group-hover:border-[#DC2626] transition-colors">
                  <OptimizedImage
                    src={category.image}
                    alt={category.name}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    sizes="80px"
                    priority={index < 6}
                    responsive={false}
                    placeholder="empty"
                  />
                </div>
                <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 text-center truncate max-w-[72px]">
                  {category.name}
                </span>
              </Link>
            ))
          )}

          {displayCategories.length > 0 && !showCategorySkeleton && (
            <div
              className="flex-shrink-0 flex flex-col items-center gap-2 cursor-pointer group"
              onClick={() => navigate("/food/user/categories")}
            >
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-orange-50 dark:bg-orange-950 flex items-center justify-center border border-orange-100 group-hover:border-[#DC2626] transition-all">
                <Plus className="w-6 h-6 text-[#DC2626]" />
              </div>
              <span className="text-xs font-medium text-gray-700">See All</span>
            </div>
          )}
        </div>
      </section>
    );
  }, [displayCategories, showCategorySkeleton, navigate]);

  return (
    
    <div
      className="relative min-h-screen bg-white dark:bg-[#0a0a0a] pb-16 md:pb-6 overflow-x-clip"
    >
      <div className="transition-all duration-300">
        {/* Unified Background for Entire Page - Vibrant Food Theme */}
        <div className="absolute top-0 left-0 right-0 bottom-0 pointer-events-none overflow-hidden z-0">
          {/* Main Background */}
          <div className="absolute inset-0 bg-white dark:bg-[#0a0a0a]"></div>
          {/* Background Elements - Reduced to 2 blobs with CSS animations for better performance */}
          <div className="absolute inset-0 overflow-hidden opacity-20">
            {/* Top right blob - CSS animation */}
            <div
              style={{
                animation: "blob 8s ease-in-out infinite",
                willChange: "transform",
              }}
            />
            {/* Bottom left blob - CSS animation */}
            <div
              style={{
                animation: "blob-reverse 10s ease-in-out infinite",
                willChange: "transform",
              }}
            />
          </div>
          {/* CSS keyframes for animations */}
          <style>{`
          @keyframes blob {
            0%, 100% {
              transform: translate(0, 0) scale(1);
            }
            50% {
              transform: translate(50px, -30px) scale(1.2);
            }
          }
          @keyframes blob-reverse {
            0%, 100% {
              transform: translate(0, 0) scale(1);
            }
            50% {
              transform: translate(-40px, 40px) scale(1.3);
            }
          }
          @keyframes fade-in {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes gradient {
            0%, 100% {
              background-position: 0% 50%;
            }
            50% {
              background-position: 100% 50%;
            }
          }
          @keyframes fade-in-up {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes wiggle {
            0%, 100% {
              transform: rotate(0deg);
            }
            25% {
              transform: rotate(10deg);
            }
            75% {
              transform: rotate(-10deg);
            }
          }
          @keyframes placeholderFade {
            0% {
              opacity: 0;
              transform: translateY(20px);
            }
            100% {
              opacity: 0.6;
              transform: translateY(0);
            }
          }
          @keyframes gradientShift {
            0%, 100% {
              background-position: 0% 50%;
            }
            50% {
              background-position: 100% 50%;
            }
          }
          @keyframes slideUp {
            0% {
              opacity: 0;
              transform: translateY(15px);
            }
            100% {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .home-red-banner-bg {
            background-color: #D91F3A;
          }
        `}</style>
        </div>

        <div className="md:hidden relative overflow-x-clip bg-white dark:bg-[#0a0a0a]">
          {/* Brand Top Section (Red Theme) */}
          <div 
            className={`relative overflow-hidden rounded-b-[2rem] shadow-lg mb-2 ${!(festBannerImageUrl && effectiveOrderType !== "takeaway" && !isTakeawayPage && festBannerTopColor) ? 'home-red-banner-bg' : ''}`}
            style={{
              backgroundColor: (festBannerImageUrl && effectiveOrderType !== "takeaway" && !isTakeawayPage && festBannerTopColor) ? festBannerTopColor : undefined
            }}
          >
            {festBannerImageUrl && (
              <div 
                className="absolute inset-0 z-0 transition-opacity duration-200"
                style={{
                  opacity: (effectiveOrderType !== "takeaway" && !isTakeawayPage) ? 1 : 0,
                  pointerEvents: (effectiveOrderType !== "takeaway" && !isTakeawayPage) ? 'auto' : 'none'
                }}
              >
                <img
                  src={festBannerImageUrl}
                  alt="Fest Banner"
                  className="w-full h-full object-cover"
                  onError={() => {
                    setFestBannerImageUrl("");
                    setFestBannerTopColor("");
                    if (typeof window !== "undefined") {
                      try { localStorage.setItem("CACHED_FEST_BANNER", ""); } catch(e) {}
                      try { localStorage.setItem("CACHED_FEST_BANNER_COLOR", ""); } catch(e) {}
                    }
                    try {
                      const meta = document.querySelector('meta[name="theme-color"]');
                      if (meta) meta.setAttribute('content', '#D91F3A');
                    } catch(e) {}
                  }}
                />
              </div>
            )}
            <div className="relative z-10">
              {effectiveOrderType !== "takeaway" && !isTakeawayPage ? (
                <HomeHeader
                  activeTab={activeTab}
                  setActiveTab={setActiveTab}
                  location={effectiveLocation}
                  handleSearchFocus={handleSearchFocus}
                  placeholderIndex={placeholderIndex}
                  placeholders={placeholders}
                  vegMode={vegMode}
                  handleVegModeChange={handleVegModeChange}
                  vegModeToggleRef={vegModeToggleRef}
                  // Pass Banner Props to Unified Component
                  showBanner={activeTab === "food" && effectiveOrderType !== "takeaway" && !isTakeawayPage}
                  videoUrl={""}
                  hideFoodImages={!!festBannerImageUrl}
                />
              ) : (
                <div className="bg-white/0 dark:bg-black/0 px-4 pt-2 pb-4 border-b-0 dark:border-gray-800 backdrop-blur-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold text-gray-200 uppercase tracking-[0.2em] mb-0.5 drop-shadow-md">Self-Pickup</span>
                      <h1 className="text-xl font-bold text-white flex items-center gap-2 drop-shadow-md">
                        Takeaway
                      </h1>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          setTakeawaySearchOpen(true);
                        }}
                        className={`p-2.5 backdrop-blur-md rounded-full active:scale-95 transition-all duration-200 ${takeawaySearchOpen ? "bg-white text-[#DC2626]" : "bg-white/20 dark:bg-black/20"}`}
                        aria-label="Search takeaway restaurants"
                      >
                        <Search className={`h-5 w-5 ${takeawaySearchOpen ? "text-[#DC2626]" : "text-white"}`} strokeWidth={2.5} />
                      </button>
                      <Link
                        to="/food/user/cart"
                        state={{ from: routerLocation.pathname }}
                        className="p-2.5 bg-white/20 dark:bg-black/20 backdrop-blur-md rounded-full active:scale-95 transition-all relative flex items-center justify-center"
                        title="Cart"
                      >
                        <ShoppingCart className="h-5 w-5 text-white" strokeWidth={2.5} />
                        {cartCount > 0 && (
                          <span className="absolute -top-1 -right-1 bg-[#DC2626] text-white text-[9px] font-bold h-4.5 w-4.5 rounded-full flex items-center justify-center border-2 border-white dark:border-[#1a1a1a]">
                            {cartCount > 99 ? "99+" : cartCount}
                          </span>
                        )}
                      </Link>
                      <Link
                        to="/food/user/profile"
                        state={{ from: routerLocation.pathname }}
                        onClick={(e) => {
                          if (!isModuleAuthenticated('user')) {
                            e.preventDefault();
                            window.dispatchEvent(new CustomEvent('show-login-required'));
                          }
                        }}
                        className="h-10 w-10 relative flex items-center justify-center rounded-full border-[1.5px] border-white shadow-none cursor-pointer active:scale-95 transition-all overflow-hidden ring-1 ring-red-500/80"
                      >
                        <Avatar className="h-full w-full bg-[#FFF5E6]">
                          <AvatarImage
                            src={userProfile?.profileImage || "/assets/images/profile_avatar.webp"}
                            alt="Profile"
                            className="object-cover"
                          />
                          <AvatarFallback className="bg-[#FFF5E6] text-[20px] font-black text-[#DC2626] leading-none tracking-tighter antialiased">
                            <img src="/assets/images/profile_avatar.webp" alt="Profile" className="object-cover w-full h-full" />
                          </AvatarFallback>
                        </Avatar>
                      </Link>
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {takeawaySearchOpen && (
                      <motion.section
                        key="takeaway-search-bar"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{
                          height: { type: "spring", stiffness: 380, damping: 32, mass: 0.82 },
                          opacity: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
                        }}
                        className="overflow-hidden origin-top"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <motion.div
                          initial={{ y: -8, opacity: 0, scale: 0.97 }}
                          animate={{ y: 0, opacity: 1, scale: 1 }}
                          exit={{ y: -6, opacity: 0, scale: 0.98 }}
                          transition={{
                            type: "spring",
                            stiffness: 460,
                            damping: 30,
                            mass: 0.72,
                          }}
                          className="relative bg-gray-50 dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-gray-800 p-2 flex items-center shadow-inner group mt-3"
                        >
                          <Search className="h-4 w-4 text-[#DC2626] ml-2 shrink-0" strokeWidth={2.5} />
                          <div className="flex-1 px-3">
                            <Input
                              autoFocus
                              value={heroSearch}
                              onChange={(e) => setHeroSearch(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  setHeroSearch("");
                                  setTakeawaySearchOpen(false);
                                }
                              }}
                              className="h-6 w-full bg-transparent border-0 text-[13px] font-bold text-gray-700 dark:text-white focus-visible:ring-0 focus-visible:ring-offset-0 p-0 leading-none placeholder:text-gray-400"
                              placeholder="Search takeaway restaurants..."
                            />
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {heroSearch && (
                              <button
                                type="button"
                                onClick={() => setHeroSearch("")}
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-200/90 text-gray-500 hover:bg-gray-300 hover:text-gray-700 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors"
                                aria-label="Clear search"
                              >
                                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setHeroSearch("");
                                setTakeawaySearchOpen(false);
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-full bg-[#DC2626]/10 text-[#DC2626] hover:bg-[#DC2626]/20 transition-colors"
                              aria-label="Close search"
                            >
                              <X className="h-4 w-4" strokeWidth={2.5} />
                            </button>
                          </div>
                        </motion.div>
                      </motion.section>
                    )}
                  </AnimatePresence>
                </div>
              )}

            </div>
          </div>

          <AnimatePresence mode="wait">
            {activeTab === "food" ? (
              <motion.div
                key="food-content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="bg-transparent dark:bg-transparent"
              >
                {(effectiveOrderType === "takeaway" || isTakeawayPage) && (
                  <div className="px-4 pt-3 pb-1 bg-white dark:bg-[#0a0a0a]">
                    <div className="flex flex-col gap-1">
                      <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <span className="p-2 bg-green-100 dark:bg-green-900/30 rounded-xl">
                          <ShoppingBag className="h-6 w-6 text-green-600" />
                        </span>
                        Pickup Restaurants
                      </h1>
                      <p className="text-[13px] text-gray-500 font-medium flex items-center gap-1.5 ml-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                        Order online, skip the queue & pickup yourself
                      </p>
                    </div>
                    <div className="h-[1px] bg-gradient-to-r from-gray-100 via-gray-200 to-transparent dark:from-gray-800 dark:via-gray-700 dark:to-transparent mt-3 mb-1"></div>
                  </div>
                )}
                {/* "What's on your mind today?" Section */}
                {effectiveOrderType !== "takeaway" && !isTakeawayPage && (
                  <div
                    id="categories-section"
                    className="px-4 py-2.5 space-y-3 bg-white dark:bg-[#0a0a0a]"
                  >


                    {/* Categories Horizontal Slider */}
                    <div className="flex overflow-x-auto gap-1.5 pb-2 scrollbar-hide -mx-4 px-4 mask-edge-fade">
                      {displayCategories.slice(0, 12).map((category, index) => (
                        <Link
                          key={category.id || index}
                          to={`/food/user/category/${category.slug}`}
                          state={{ from: '/food/user' }}
                          onClick={rememberLeaveForCategory}
                          className="flex-shrink-0 flex flex-col items-center gap-2.5 group w-[92px]"
                        >
                          <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden shadow-md border-2 border-gray-100 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] group-active:scale-95 transition-all duration-300">
                            {/* Shining Glint Effect */}
                            <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
                              <motion.div
                                animate={{
                                  x: ['-200%', '200%'],
                                }}
                                transition={{
                                  duration: 2,
                                  repeat: Infinity,
                                  repeatDelay: 3 + index * 0.5,
                                  ease: "easeInOut"
                                }}
                                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-[-20deg] w-[150%] h-full"
                              />
                            </div>

                            <OptimizedImage
                              src={category.image}
                              alt={category.name}
                              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                              sizes="96px"
                              priority={index < 6}
                              responsive={false}
                              placeholder="empty"
                            />
                          </div>
                          <span className="text-[10px] font-bold text-gray-600 dark:text-gray-300 text-center leading-tight line-clamp-1 w-full px-0.5">
                            {category.name}
                          </span>
                        </Link>
                      ))}

                      {/* See All Card */}
                      {displayCategories.length > 0 && (
                        <Link
                          to="/food/user/categories"
                          state={{ from: '/food/user' }}
                          className="flex-shrink-0 flex flex-col items-center gap-2.5 group w-[92px]"
                        >
                          <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden shadow-md border-2 border-red-100 dark:border-red-950/30 bg-red-50 dark:bg-red-950/20 flex items-center justify-center group-active:scale-95 transition-all duration-300">
                            <UtensilsCrossed className="w-8 h-8 sm:w-10 sm:h-10 text-red-500" />
                          </div>
                          <span className="text-[10px] font-bold text-gray-600 dark:text-gray-300 text-center leading-tight flex items-center justify-center gap-1 w-full px-0.5 group-hover:text-red-500 transition-colors">
                            See all <span className="text-[7px] text-red-500">▼</span>
                          </span>
                        </Link>
                      )}
                    </div>
                  </div>
                )}

                {/* Dynamic Sticky Header (Search + Slider + Filters) */}
                <AnimatePresence initial={false}>
                  {isStickyHeaderVisible && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="fixed top-0 left-0 right-0 z-[100] bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur-md shadow-lg border-b border-white/10 dark:border-white/5 safe-top md:hidden"
                    >
                      {/* Search Bar + Veg Mode Row (Always visible when sticky) */}
                      <AnimatePresence>
                        {showStickySearch && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="px-4 pt-3 pb-2 flex items-center gap-3"
                          >
                            <div
                              className="bg-white dark:bg-[#1a1a1a] flex-1 rounded-2xl flex items-center px-4 py-3 cursor-pointer border-2 border-[#DC2626]/30 dark:border-[#DC2626]/50 shadow-md"
                              onClick={handleSearchFocus}
                            >
                              <Search className="h-5 w-5 text-[#DC2626] dark:text-[#a14b84] mr-3" strokeWidth={2.5} />
                              <div className="flex-1 relative h-5 overflow-hidden">
                                <span className="absolute inset-0 text-base text-gray-400 font-medium">Search "biryani"</span>
                              </div>
                              <div className="h-5 w-[1px] bg-gray-200 dark:bg-white/10 mx-2" />
                              <Mic
                                className="h-5 w-5 text-[#DC2626] dark:text-[#a14b84]"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  voiceSearch.clearError();
                                  void voiceSearch.startListening();
                                  setIsVoiceOverlayOpen(true);
                                }}
                              />
                            </div>

                            {/* Veg Mode Toggle in Sticky Header */}
                            <div
                              ref={vegModeToggleRef}
                              className="flex flex-col items-center gap-1 shrink-0 antialiased"
                            >
                              <span className="text-[8px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-[0.1em] leading-none">Veg Mode</span>
                              <div
                                className={`w-10 h-4.5 rounded-full relative transition-all duration-500 cursor-pointer border border-gray-200 dark:border-white/10 shadow-sm ${vegMode ? 'bg-[#48c479]' : 'bg-gray-300 dark:bg-gray-700'}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleVegModeChange(!vegMode);
                                }}
                              >
                                <motion.div
                                  animate={{ x: vegMode ? 22 : 2 }}
                                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                  className="absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow-sm"
                                />
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Categories Slider (Increased Icon Size) */}
                      <div className="flex overflow-x-auto gap-5 py-3 pb-2 scrollbar-hide px-4 mask-edge-fade">
                        {displayCategories.slice(0, 12).map((category, index) => (
                          <Link
                            key={`sticky-${category.id || index}`}
                            to={`/food/user/category/${category.slug}`}
                            onClick={rememberLeaveForCategory}
                            className="flex-shrink-0 flex flex-col items-center gap-1.5 group w-[74px]"
                          >
                            <div className="w-18 h-18 rounded-full overflow-hidden border-2 border-gray-100 dark:border-white/10 shadow-md bg-white dark:bg-white/5 transition-transform group-active:scale-95">
                              <OptimizedImage
                                src={category.image}
                                alt={category.name}
                                className="w-full h-full object-cover"
                                sizes="72px"
                                priority={index < 6}
                                responsive={false}
                                placeholder="empty"
                              />
                            </div>
                            <span className="text-[9px] font-bold text-gray-700 dark:text-gray-300 text-center truncate w-full uppercase tracking-tighter">
                              {category.name}
                            </span>
                          </Link>
                        ))}

                        {/* See All Sticky Card */}
                        {displayCategories.length > 0 && (
                          <Link
                            to="/food/user/categories"
                            state={{ from: '/food/user' }}
                            className="flex-shrink-0 flex flex-col items-center gap-1.5 group w-[74px]"
                          >
                            <div className="w-18 h-18 rounded-full overflow-hidden border-2 border-red-100 dark:border-red-950/30 bg-red-50 dark:bg-red-950/20 flex items-center justify-center transition-transform group-active:scale-95">
                              <UtensilsCrossed className="w-7 h-7 text-red-500" />
                            </div>
                            <span className="text-[9px] font-bold text-gray-700 dark:text-gray-300 text-center truncate w-full uppercase tracking-tighter flex items-center justify-center gap-0.5 group-hover:text-red-500 transition-colors">
                              See all <span className="text-[7px] text-red-500">▼</span>
                            </span>
                          </Link>
                        )}
                      </div>


                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Admin Hero Banners Section - Now below categories */}
                {HeroBannerSection}

                {/* Filters Sticky Sidebar Header - Hidden for takeaway as per request */}
                {effectiveOrderType !== "takeaway" && !isTakeawayPage && (
                  <section className="py-2.5 px-4 bg-white/95 dark:bg-[#0a0a0a]/95 backdrop-blur-md sticky top-0 md:top-[140px] z-[40] -mx-4 w-[calc(100%+2rem)] border-b border-gray-100 dark:border-white/5 shadow-sm transition-colors duration-300">
                    <div
                      className="flex items-center gap-2 overflow-x-auto scrollbar-hide px-4"
                      style={{
                        scrollbarWidth: "none",
                        msOverflowStyle: "none",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setIsFilterOpen(true)}
                        className="h-9 px-4 rounded-full flex items-center gap-1.5 whitespace-nowrap flex-shrink-0 font-bold transition-all bg-white dark:bg-[#1a1a1a] border border-gray-200 shadow-sm active:scale-95"
                      >
                        <SlidersHorizontal className="h-4 w-4 text-black dark:text-white" />
                        <span className="text-xs font-bold text-black dark:text-white uppercase tracking-tight">
                          Filters
                        </span>
                      </button>

                      {[
                        { id: "delivery-under-30", label: "Under 30 mins" },
                        { id: "delivery-under-45", label: "Under 45 mins" },
                        { id: "distance-under-1km", label: "Under 1km", icon: MapPin },
                        { id: "distance-under-2km", label: "Under 2km", icon: MapPin },
                      ].map((filter) => {
                        const Icon = filter.icon;
                        const isActive = activeFilters.has(filter.id);
                        return (
                          <button
                            key={filter.id}
                            type="button"
                            onClick={() => {
                              const nextFilters = new Set(activeFilters);
                              if (nextFilters.has(filter.id)) {
                                nextFilters.delete(filter.id);
                              } else {
                                nextFilters.add(filter.id);
                              }
                              setActiveFilters(nextFilters);
                              void applyFiltersAndRefetch(
                                nextFilters,
                                sortBy,
                                selectedCuisine,
                              );
                            }}
                            className={`h-9 px-4 rounded-full flex items-center gap-2 whitespace-nowrap flex-shrink-0 transition-all font-bold shadow-sm active:scale-95 ${isActive
                              ? "bg-[#DC2626] text-white border border-[#DC2626] hover:bg-orange-700"
                              : "bg-white dark:bg-[#1a1a1a] border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                              }`}
                          >
                            {Icon && (
                              <Icon
                                className={`h-3.5 w-3.5 ${isActive ? "fill-white" : ""}`}
                              />
                            )}
                            <span className="text-xs font-bold tracking-tight">
                              {filter.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

              </motion.div>
            ) : (
              <motion.div
                key="quick-content"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
              >
                <QuickSection />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {effectiveOrderType !== "takeaway" && !isTakeawayPage && recommendedForYouRestaurants.length > 0 && (
          <motion.section
            className="content-auto pt-1 sm:pt-2"
            initial={false}
            animate={{ opacity: 1, y: 0 }}>
            <h2 className="text-xs sm:text-sm lg:text-base font-semibold text-gray-400 dark:text-gray-500 tracking-widest uppercase mb-2 sm:mb-3 px-4">
              Recommended For You
            </h2>

            <div className="flex overflow-x-auto gap-3.5 pb-4 scrollbar-hide px-4 mask-edge-fade">
              {recommendedForYouRestaurants.map((restaurant, index) => {
                const restaurantRouteId = getRestaurantRouteId(restaurant);
                const rawSlug = restaurant.slug || restaurant.name;
                const restaurantSlug = String(rawSlug || "")
                  .toLowerCase()
                  .replace(/[\s/]+/g, "-");
                const linkId = restaurantRouteId || restaurantSlug;
                return (
                  <motion.div
                    key={`recommended-${restaurant.mongoId || restaurant.id || linkId}`}
                    initial={{ opacity: 0, y: 12 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.35, delay: index * 0.05 }}
                    className="flex-shrink-0 w-[150px] sm:w-[170px] md:w-[190px]">
                    <Link
                      to={toFoodUserPath(`/user/restaurants/${linkId}`)}
                      state={{ from: homeBrowsePath, restaurantData: restaurant }}
                      data-browse-focus={restaurant.mongoId || restaurant.id || linkId}
                      onClick={() =>
                        rememberHomeBrowsePosition(
                          restaurant.mongoId || restaurant.id || linkId,
                        )
                      }
                      className="block rounded-[20px] overflow-hidden border border-gray-200/70 dark:border-gray-800 bg-white dark:bg-[#1a1a1a] shadow-md hover:shadow-lg transition-all duration-300">
                      <div className="relative h-24 sm:h-28 md:h-32 bg-gray-50">
                        <RestaurantImageCarousel
                          restaurant={restaurant}
                          backendOrigin={BACKEND_ORIGIN}
                          className="h-24 sm:h-28 md:h-32"
                          roundedClass="rounded-t-[20px]"
                          backFrom={homeBrowsePath}
                          focusId={restaurant.mongoId || restaurant.id || linkId}
                          visibleCount={visibleRestaurantCount}
                        />
                        <div className={`absolute bottom-2 left-2 px-2 py-0.5 rounded-lg ${Number(restaurant.rating) > 0 ? "bg-black/80 backdrop-blur-md text-white font-medium" : "bg-gray-200/90 text-gray-600 font-medium"} text-[10px] shadow-lg border border-white/10`}>
                          {Number(restaurant.rating) > 0 ? Number(restaurant.rating).toFixed(1) : "NEW"}
                        </div>
                      </div>
                      <div className="p-2.5">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate tracking-tight">
                          {restaurant.name}
                        </p>
                        <p className="text-[10px] text-[#DC2626] font-bold mt-1 flex items-center gap-1 uppercase tracking-wider">
                          <Flame className="w-3.5 h-3.5 fill-[#DC2626]" />
                          Near & Fast
                        </p>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </motion.section>
        )}

        {/* Explore More Section */}
        {effectiveOrderType !== "takeaway" && !isTakeawayPage && (
          <motion.section
            className="content-auto pt-2 sm:pt-3 lg:pt-4"
            initial={false}
            animate={{ opacity: 1, y: 0 }}>
            <div className="px-4 mb-3 flex items-center gap-2">
              <h2 className="text-[11px] font-black text-gray-400 uppercase tracking-widest leading-tight">
                {exploreMoreHeading}
              </h2>
              <div className="h-[1px] bg-gray-100 dark:bg-gray-800 flex-1"></div>
            </div>
            <div className="px-4.5 pb-4 lg:pb-6">
              <div className="grid grid-cols-4 gap-1.5 sm:gap-4">
                  {finalExploreItems.slice(0, 4).map((item, index) => (
                    <motion.div
                      key={item.id}
                      initial={false}
                      animate={{ opacity: 1, y: 0 }}
                      whileTap={{ scale: 0.95 }}
                      className="w-full">
                      <Link
                        to={item.href}
                        state={{ from: '/food/user' }}
                        aria-label={item.label}
                        className="block">
                        <div className="flex flex-col items-center gap-1.5 group">
                          <div className="relative aspect-square w-full rounded-2xl sm:rounded-[24px] bg-white dark:bg-[#1a1a1a] flex items-center justify-center shadow-sm hover:shadow-md transition-all duration-500 overflow-hidden border border-gray-100 dark:border-gray-800 p-1 group-hover:border-[#DC2626]/40">
                            {/* Colorful Glow Background */}
                            <div className={`absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-500 bg-gradient-to-br ${index % 3 === 0 ? 'from-[#DC2626] to-rose-500' : index % 3 === 1 ? 'from-indigo-500 to-purple-500' : 'from-teal-500 to-emerald-500'} z-20 pointer-events-none`} />

                            <ExploreIconImage
                              src={item.image}
                              fallbackSrc={item.fallbackImage || exploreOffers}
                              className="relative z-10 transition-transform duration-500 group-hover:scale-110 drop-shadow-sm rounded-xl"
                            />
                          </div>
                          <span className="text-[9px] sm:text-[10px] font-bold text-gray-500 dark:text-gray-400 group-hover:text-[#DC2626] transition-colors text-center tracking-tighter leading-tight uppercase truncate w-full px-0.5">
                            {item.label}
                          </span>
                        </div>
                      </Link>
                    </motion.div>
                  ))}
              </div>
            </div>
          </motion.section>
        )}

        {/* Featured Foods - Horizontal Scroll */}

        {/* Restaurants - Enhanced with Animations */}
        <motion.section
          className={`content-auto space-y-0 pb-8 md:pb-10 ${(effectiveOrderType === "takeaway" || isTakeawayPage) ? "pt-1 sm:pt-2 lg:pt-3" : "pt-3 sm:pt-4 lg:pt-6"}`}
          initial={false}
          animate={{ opacity: 1 }}>
          <div className="px-4 mb-3 lg:mb-4">
            {!showTakeawaySearchEmpty && (
              <div className="flex flex-col gap-1 antialiased">
                {takeawaySectionSubtitle && (
                  <h2 className="text-[11px] sm:text-xs font-semibold text-[#5d80a3] tracking-[0.15em] uppercase">
                    {takeawaySectionSubtitle}
                  </h2>
                )}
                <h3 className="text-lg sm:text-xl font-bold text-[#364d66] dark:text-gray-200 tracking-tight">
                  {takeawaySectionTitle}
                </h3>
              </div>
            )}
          </div>
          <div
            className={`relative ${showRestaurantSkeleton ? "min-h-[360px] sm:min-h-[420px]" : ""}`}>
            {/* Loading Overlay */}
            <AnimatePresence>
              {showRestaurantSkeleton && (
                <motion.div
                  className="absolute inset-0 z-10 rounded-lg bg-white/94 dark:bg-[#1a1a1a]/94"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}>
                  <LoadingSkeletonRegion label="Loading restaurants" className="h-full p-1 sm:p-2">
                    <RestaurantGridSkeleton
                      count={3}
                      className="grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3"
                      compact
                    />
                  </LoadingSkeletonRegion>
                </motion.div>
              )}
            </AnimatePresence>
            <div
              className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-4 lg:gap-5 xl:gap-6 px-4 pt-1 sm:pt-1.5 lg:pt-2 items-stretch ${isLoadingFilterResults || loadingRestaurants ? "opacity-50" : "opacity-100"} transition-opacity duration-300`}>
              {visibleRestaurants.map((restaurant, index) => {
                const nameStr =
                  typeof restaurant?.name === "string"
                    ? restaurant.name.trim()
                    : "";
                const fallbackSlugSource =
                  nameStr ||
                  (typeof restaurant?.restaurantName === "string"
                    ? restaurant.restaurantName.trim()
                    : "") ||
                  String(
                    restaurant?.slug ||
                    restaurant?.id ||
                    restaurant?._id ||
                    `restaurant-${index}`,
                  );
                const rawSlug = (typeof restaurant?.slug === "string" && restaurant.slug.trim()) ? restaurant.slug.trim() : fallbackSlugSource;
                const restaurantSlug = rawSlug.toLowerCase().replace(/[\s\/]+/g, "-");
                const restaurantRouteId = getRestaurantRouteId(restaurant) || restaurantSlug;
                const availability = getRestaurantAvailabilityStatus(
                  restaurant,
                  new Date(availabilityTick),
                );
                // Direct favorite check - isFavorite is already memoized in context
                const favorite = isFavorite(restaurantSlug);

                const restaurantCoupons = restaurant.hasDishes === false ? [] : publicOffers.filter((o) => {
                  // 1. Restaurant Scope check
                  if (String(o?.restaurantScope) === "selected") {
                    const couponRestId = String(o.restaurantId || "").trim();
                    const rId = String(restaurant.restaurantId || "").trim();
                    const id = String(restaurant.id || "").trim();
                    const mongoId = String(restaurant.mongoId || "").trim();
                    if (!(couponRestId === rId || couponRestId === id || couponRestId === mongoId)) {
                      return false;
                    }
                  }

                  // 2. Order/Tab Type check (couponType: 'delivery', 'takeaway', 'all')
                  const isTakeawayActive = effectiveOrderType === "takeaway" || isTakeawayPage;
                  const cType = String(o.couponType || "all").trim().toLowerCase();

                  if (isTakeawayActive) {
                    return cType === "takeaway" || cType === "all";
                  } else {
                    return cType === "delivery" || cType === "all";
                  }
                });

                const handleToggleFavorite = (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (favorite) {
                    // If already bookmarked, show Manage Collections modal
                    setSelectedRestaurantSlug(restaurantSlug);
                    setShowManageCollections(true);
                  } else {
                    // Add to favorites and show toast
                    addFavorite({
                      slug: restaurantSlug,
                      name: restaurant.name,
                      cuisine: restaurant.cuisine,
                      rating: restaurant.rating,
                      deliveryTime: restaurant.deliveryTime,
                      distance: restaurant.distance,
                      priceRange: restaurant.priceRange,
                      image: restaurant.image,
                    });
                    setShowToast(true);
                    setTimeout(() => {
                      setShowToast(false);
                    }, 3000);
                  }
                };

                return (
                  <div
                    key={
                      restaurant?.id ||
                      restaurant?._id ||
                      restaurantSlug ||
                      index
                    }
                    className="h-full transform transition-all duration-300 hover:-translate-y-3 hover:scale-[1.02]"
                    style={{
                      perspective: 1000,
                      animation:
                        index < 10
                          ? `fade-in-up 0.5s ease-out ${index * 0.05}s backwards`
                          : "none",
                    }}>
                    <div className="h-full group" data-browse-focus={restaurant.mongoId || restaurant.id || restaurantRouteId}>
                      <Link
                        to={toFoodUserPath(`/user/restaurants/${restaurantRouteId}`)}
                        state={{ from: homeBrowsePath, restaurantData: restaurant }}
                        onClick={() =>
                          rememberHomeBrowsePosition(
                            restaurant.mongoId || restaurant.id || restaurantRouteId,
                          )
                        }
                        className="h-full flex">
                        <Card
                          className={`overflow-hidden gap-0 cursor-pointer border border-gray-200/70 dark:border-gray-800/80 group bg-white dark:bg-[#1a1a1a] transition-all duration-500 py-0 rounded-[28px] flex flex-col h-full w-full relative shadow-md hover:shadow-2xl ${isOutOfService || !availability.isOpen
                            ? "grayscale opacity-75"
                            : ""
                            }`}>
                          {/* Image Section with Carousel */}
                          <div className="relative">
                            <RestaurantImageCarousel
                              restaurant={restaurant}
                              priority={index < 2}
                              backendOrigin={BACKEND_ORIGIN}
                              backFrom={homeBrowsePath}
                              focusId={restaurant.mongoId || restaurant.id || restaurantRouteId}
                              visibleCount={visibleRestaurantCount}
                            />



                            {/* Bookmark Icon - Top Right */}
                            <div className="absolute top-4 right-4 z-10 transform transition-transform duration-300 group-hover:scale-110">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleToggleFavorite}
                                aria-label={
                                  favorite
                                    ? "Remove from favorites"
                                    : "Add to favorites"
                                }
                                className={`h-11 w-11 rounded-[20px] shadow-xl flex items-center justify-center transition-all duration-300 ${favorite
                                  ? "bg-red-500 text-white"
                                  : "bg-white/90 backdrop-blur-sm text-gray-800 hover:bg-white"
                                  }`}>
                                <Bookmark
                                  className={`h-5 w-5 transition-all duration-300 ${favorite ? "fill-white" : ""
                                    }`}
                                />
                              </Button>
                            </div>
                          </div>

                          {/* Content Section */}
                          <div className="transform transition-transform duration-300 group-hover:-translate-y-1">
                            <CardContent className="p-3 sm:p-4 lg:p-5 pt-3 sm:pt-4 lg:pt-5 flex flex-col flex-grow">
                              {/* Restaurant Name & Rating */}
                              <div className="flex items-start justify-between gap-2 mb-2 lg:mb-3">
                                <div className="flex-1 min-w-0">
                                  <h3 className="text-2xl lg:text-3xl font-bold text-[#1c1c1c] dark:text-white line-clamp-2 leading-tight tracking-tight transition-colors duration-300 group-hover:text-[#257d3c]">
                                    {restaurant.name}
                                  </h3>
                                  <div className="flex flex-wrap items-center gap-2 mt-2">
                                    {/* Delivery Time & Distance moved here - Green Theme with Zap icon */}
                                    <div className="flex items-center gap-1.5 text-sm font-semibold text-[#257d3c] transition-all duration-300">
                                      <Zap
                                        className="h-4 w-4 fill-[#257d3c]"
                                        strokeWidth={2.5}
                                      />
                                      <span>
                                        {restaurant.deliveryTime}
                                      </span>
                                      <span className="text-[#257d3c] mx-1 font-bold">|</span>
                                      <span>
                                        {restaurant.distance}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Offer Badge - Animated Carousel */}
                                  <RestaurantCardOfferCarousel coupons={restaurantCoupons} />
                                </div>
                                <div className="flex flex-col items-end gap-0.5">
                                  <div className="flex-shrink-0 bg-[#257d3c] text-white px-2 py-1 rounded-lg flex items-center gap-1">
                                    <Star className="h-3.5 w-3.5 fill-white text-white" strokeWidth={0} />
                                    <span className="text-sm font-bold tracking-tight">
                                      {Number(restaurant.rating) > 0 ? Number(restaurant.rating).toFixed(1) : "NEW"}
                                    </span>
                                  </div>
                                  {Number(restaurant.rating) > 0 && (
                                    <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mt-0.5 whitespace-nowrap">
                                      {(() => {
                                        const count = Number(restaurant.totalRatings) || 0;
                                        if (count === 1) return "1 rating";
                                        if (count < 100) return `${count} ratings`;
                                        if (count < 1000) return `${Math.floor(count / 100) * 100}+ ratings`;
                                        return `${(count / 1000).toFixed(1)}K+ ratings`;
                                      })()}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Closes in / Opening time badge moved here */}
                              <div className="flex items-center gap-1 text-sm lg:text-base text-gray-500 mt-2">
                                {!availability.isOpen && (
                                  <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all duration-300 ${availability.reason === "inactive" || availability.reason === "not-accepting-orders"
                                    ? "bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30"
                                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700"
                                    }`}>
                                    {availability.reason === "inactive" || availability.reason === "not-accepting-orders" ? (
                                      <>
                                        <AlertCircle className="h-3 w-3 flex-shrink-0 text-red-500 dark:text-red-400" strokeWidth={2.5} />
                                        <span>Offline</span>
                                      </>
                                    ) : availability.openingTime ? (
                                      <>
                                        <Clock className="h-3 w-3 flex-shrink-0 text-gray-500 dark:text-gray-400" strokeWidth={2.5} />
                                        <span>Opens at {availability.openingTime}</span>
                                      </>
                                    ) : (
                                      <>
                                        <AlertCircle className="h-3 w-3 flex-shrink-0 text-gray-500 dark:text-gray-400" strokeWidth={2.5} />
                                        <span>Closed</span>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </div>

                          {/* Border Glow Effect */}
                          <div className="absolute inset-0 rounded-md pointer-events-none z-0 transition-all duration-300 border border-transparent group-hover:border-[#DC2626]/30 group-hover:shadow-[inset_0_0_0_1px_rgba(235,89,14,0.2)]" />
                        </Card>
                      </Link>
                    </div>
                  </div>
                );
              })}
              {!showRestaurantSkeleton &&
                showTakeawaySearchEmpty &&
                visibleRestaurants.length === 0 && (
                  <div className="col-span-full flex flex-col items-center justify-center py-14 px-6 text-center">
                    <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                      <Search className="h-7 w-7 text-gray-300 dark:text-gray-500" />
                    </div>
                    <p className="text-base font-bold text-gray-800 dark:text-gray-200">
                      No takeaway restaurants found for &quot;{takeawaySearchQuery}&quot;
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5 max-w-xs">
                      Search by restaurant name only
                    </p>
                  </div>
                )}
            </div>
          </div>
          <div className="flex flex-col items-center pt-2 sm:pt-3 gap-2 px-4">
            {hasMoreRestaurants && (
              <Button
                variant="outline"
                onClick={loadMoreRestaurants}
                className="text-sm font-medium border-gray-300 hover:border-gray-400">
                Load more restaurants
              </Button>
            )}
            <div
              ref={restaurantLoadMoreRef}
              className="h-1 w-full"
              aria-hidden="true"
            />
          </div>
        </motion.section>
      </div>

      <VoiceSearchOverlay
        isOpen={isVoiceOverlayOpen}
        onClose={() => {
          voiceSearch.stopListening();
          setIsVoiceOverlayOpen(false);
        }}
        onSearchResult={(transcript) => {
          navigate(`/food/user/search?q=${encodeURIComponent(transcript)}&mode=delivery`);
        }}
        voiceSearch={voiceSearch}
        autoStart={false}
      />

      {/* Filter Modal - Bottom Sheet */}
      <AnimatePresence>
        {isFilterOpen && (
          <div className="fixed inset-0 z-[100]">
            {/* Backdrop */}
            <motion.div
              className="absolute inset-0 bg-black/50"
              onClick={() => setIsFilterOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            />

            {/* Modal Content */}
            <motion.div
              className="absolute bottom-0 left-0 right-0 bg-white dark:bg-[#1a1a1a] rounded-t-3xl max-h-[85vh] flex flex-col"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{
                type: "spring",
                damping: 30,
                stiffness: 400,
                duration: 0.3,
              }}>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-4 border-b dark:border-gray-800">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                  Filters and sorting
                </h2>
                <button
                  onClick={() => {
                    setActiveFilters(new Set());
                    setSortBy(null);
                    setSelectedCuisine(null);
                  }}
                  className="text-[#DC2626] font-medium text-sm">
                  Clear all
                </button>
              </div>

              {/* Body */}
              <div className="flex flex-1 overflow-hidden">
                {/* Left Sidebar - Tabs */}
                <div className="w-24 sm:w-28 bg-gray-50 dark:bg-[#0a0a0a] border-r dark:border-gray-800 flex flex-col">
                  {[
                    { id: "sort", label: "Sort By", icon: ArrowDownUp },
                    { id: "time", label: "Time", icon: Timer },
                    { id: "rating", label: "Rating", icon: Star },
                    { id: "distance", label: "Distance", icon: MapPin },
                    { id: "price", label: "Dish Price", icon: IndianRupee },
                    { id: "offers", label: "Offers", icon: BadgePercent },
                    { id: "trust", label: "Trust", icon: ShieldCheck },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const isActive =
                      activeScrollSection === tab.id ||
                      activeFilterTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveFilterTab(tab.id);
                          const section = filterSectionRefs.current[tab.id];
                          if (section) {
                            section.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                          }
                        }}
                        className={`flex flex-col items-center gap-1 py-4 px-2 text-center relative transition-colors ${isActive
                          ? "bg-white dark:bg-[#1a1a1a] text-[#DC2626]"
                          : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                          }`}>
                        {isActive && (
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#DC2626] rounded-r" />
                        )}
                        <Icon className="h-5 w-5" strokeWidth={1.5} />
                        <span className="text-xs font-medium leading-tight">
                          {tab.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Right Content Area - Scrollable */}
                <div
                  ref={rightContentRef}
                  className="flex-1 overflow-y-auto p-4">
                  {/* Sort By Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["sort"] = el)}
                    data-section-id="sort"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Sort by
                    </h3>
                    <div className="flex flex-col gap-3">
                      {[
                        { id: null, label: "Relevance" },
                        { id: "price-low", label: "Price: Low to High" },
                        { id: "price-high", label: "Price: High to Low" },
                        { id: "rating-high", label: "Rating: High to Low" },
                        { id: "rating-low", label: "Rating: Low to High" },
                      ].map((option) => (
                        <button
                          key={option.id || "relevance"}
                          onClick={() => setSortBy(option.id)}
                          className={`px-4 py-3 rounded-xl border text-left transition-colors ${sortBy === option.id
                            ? "border-[#DC2626] bg-[#F9F9FB] dark:bg-green-900/20"
                            : "border-gray-200 dark:border-gray-800 hover:border-[#DC2626]"
                            }`}>
                          <span
                            className={`text-sm font-medium ${sortBy === option.id ? "text-[#DC2626]" : "text-gray-700 dark:text-gray-300"}`}>
                            {option.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Time Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["time"] = el)}
                    data-section-id="time"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      {(effectiveOrderType === "takeaway" || isTakeawayPage) ? "Estimated Readiness" : "Estimated Time"}
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => toggleFilter("delivery-under-30")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("delivery-under-30")
                          ? "border-[#DC2626] bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#DC2626]"
                          }`}>
                        <Timer
                          className={`h-6 w-6 ${activeFilters.has("delivery-under-30") ? "text-[#DC2626]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("delivery-under-30") ? "text-[#DC2626]" : "text-gray-700 dark:text-gray-300"}`}>
                          {(effectiveOrderType === "takeaway" || isTakeawayPage) ? "Within 30 mins" : "Under 30 mins"}
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("delivery-under-45")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("delivery-under-45")
                          ? "border-[#DC2626] bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#DC2626]"
                          }`}>
                        <Timer
                          className={`h-6 w-6 ${activeFilters.has("delivery-under-45") ? "text-[#DC2626]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("delivery-under-45") ? "text-[#DC2626]" : "text-gray-700 dark:text-gray-300"}`}>
                          {(effectiveOrderType === "takeaway" || isTakeawayPage) ? "Within 45 mins" : "Under 45 mins"}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Rating Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["rating"] = el)}
                    data-section-id="rating"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900  dark:text-white mb-4">
                      Restaurant Rating
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => toggleFilter("rating-35-plus")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("rating-35-plus")
                          ? "border-[#DC2626] bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#DC2626]"
                          }`}>
                        <Star
                          className={`h-6 w-6 ${activeFilters.has("rating-35-plus") ? "text-[#DC2626] fill-[#DC2626]" : "text-gray-400 dark:text-gray-500"}`}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("rating-35-plus") ? "text-[#DC2626]" : "text-gray-700 dark:text-gray-300"}`}>
                          Rated 3.5+
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("rating-4-plus")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("rating-4-plus")
                          ? "border-[#DC2626] bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#DC2626]"
                          }`}>
                        <Star
                          className={`h-6 w-6 ${activeFilters.has("rating-4-plus") ? "text-[#DC2626] fill-[#DC2626]" : "text-gray-400 dark:text-gray-500"}`}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("rating-4-plus") ? "text-[#DC2626]" : "text-gray-700 dark:text-gray-300"}`}>
                          Rated 4.0+
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("rating-45-plus")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("rating-45-plus")
                          ? "border-[#DC2626] bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#DC2626]"
                          }`}>
                        <Star
                          className={`h-6 w-6 ${activeFilters.has("rating-45-plus") ? "text-[#DC2626] fill-[#DC2626]" : "text-gray-400 dark:text-gray-500"}`}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("rating-45-plus") ? "text-[#DC2626]" : "text-gray-700 dark:text-gray-300"}`}>
                          Rated 4.5+
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Distance Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["distance"] = el)}
                    data-section-id="distance"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Distance
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => toggleFilter("distance-under-1km")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("distance-under-1km")
                          ? "border-[#DC2626] bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#DC2626]"
                          }`}>
                        <MapPin
                          className={`h-6 w-6 ${activeFilters.has("distance-under-1km") ? "text-[#DC2626]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("distance-under-1km") ? "text-[#DC2626]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under 1 km
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("distance-under-2km")}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${activeFilters.has("distance-under-2km")
                          ? "border-[#DC2626] bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#DC2626]"
                          }`}>
                        <MapPin
                          className={`h-6 w-6 ${activeFilters.has("distance-under-2km") ? "text-[#DC2626]" : "text-gray-600 dark:text-gray-400"}`}
                          strokeWidth={1.5}
                        />
                        <span
                          className={`text-sm font-medium ${activeFilters.has("distance-under-2km") ? "text-[#DC2626]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under 2 km
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Price Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["price"] = el)}
                    data-section-id="price"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Dish Price
                    </h3>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => toggleFilter("price-under-200")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("price-under-200")
                          ? "border-[#DC2626] bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#DC2626]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("price-under-200") ? "text-[#DC2626]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under ₹200
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("price-under-500")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("price-under-500")
                          ? "border-[#DC2626] bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#DC2626]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("price-under-500") ? "text-[#DC2626]" : "text-gray-700 dark:text-gray-300"}`}>
                          Under ₹500
                        </span>
                      </button>
                    </div>
                  </div>



                  {/* Trust Markers Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["trust"] = el)}
                    data-section-id="trust"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Trust Markers
                    </h3>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => toggleFilter("top-rated")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("top-rated")
                          ? "border-[#DC2626] bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#DC2626]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("top-rated") ? "text-[#DC2626]" : "text-gray-700 dark:text-gray-300"}`}>
                          Top Rated
                        </span>
                      </button>
                      <button
                        onClick={() => toggleFilter("trusted")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("trusted")
                          ? "border-[#DC2626] bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#DC2626]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("trusted") ? "text-[#DC2626]" : "text-gray-700 dark:text-gray-300"}`}>
                          Trusted by 1000+ users
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Offers Tab */}
                  <div
                    ref={(el) => (filterSectionRefs.current["offers"] = el)}
                    data-section-id="offers"
                    className="space-y-4 mb-8">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Offers
                    </h3>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => toggleFilter("has-offers")}
                        className={`px-4 py-3 rounded-xl border text-left transition-colors ${activeFilters.has("has-offers")
                          ? "border-[#DC2626] bg-[#F9F9FB] dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-800 hover:border-[#DC2626]"
                          }`}>
                        <span
                          className={`text-sm font-medium ${activeFilters.has("has-offers") ? "text-[#DC2626]" : "text-gray-700 dark:text-gray-300"}`}>
                          Restaurants with offers
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center gap-4 px-4 py-4 border-t dark:border-gray-800 bg-white dark:bg-[#1a1a1a]">
                <button
                  onClick={() => setIsFilterOpen(false)}
                  className="flex-1 py-3 text-center font-semibold text-gray-700 dark:text-gray-300">
                  Close
                </button>
                <button
                  onClick={async () => {
                    setIsFilterOpen(false);
                    await applyFiltersAndRefetch(
                      activeFilters,
                      sortBy,
                      selectedCuisine,
                    );
                  }}
                  className={`flex-1 py-3 font-semibold rounded-xl transition-colors ${activeFilters.size > 0 || sortBy || selectedCuisine
                    ? "bg-[#DC2626] text-white hover:bg-[#991B1B]"
                    : "bg-gray-200 text-gray-500"
                    }`}
                  disabled={isLoadingFilterResults}>
                  {isLoadingFilterResults
                    ? "Loading..."
                    : activeFilters.size > 0 || sortBy || selectedCuisine
                      ? `Show results`
                      : "Show results"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Veg Mode Popup */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showVegModePopup && (
              <>
                {/* Backdrop */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => {
                    setShowVegModePopup(false);
                    // Revert veg mode to OFF if popup is closed without applying
                    setVegModeContext(false);
                    setPrevVegMode(false);
                  }}
                  className="fixed inset-0 bg-black/30 z-[9998] backdrop-blur-sm"
                />

                {/* Popup */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, y: -8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: -8 }}
                  transition={{
                    type: "spring",
                    damping: 22,
                    stiffness: 380,
                    mass: 0.7,
                  }}
                  className="fixed z-[9999] bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl p-4 w-[calc(100%-2rem)] max-w-xs"
                  style={{
                    top: `${popupPosition.top}px`,
                    left: `${popupPosition.left}px`,
                    transformOrigin: `${popupPosition.triangleLeft}px -10px`
                  }}
                  onClick={(e) => e.stopPropagation()}>
                  {/* Pointer Triangle */}
                  <div
                    className="absolute -top-2 w-3 h-3 bg-white dark:bg-[#1a1a1a] transform rotate-45"
                    style={{
                      left: `${popupPosition.triangleLeft - 6}px`,
                      boxShadow: "-2px -2px 4px rgba(0,0,0,0.1)",
                    }}
                  />

                  {/* Title */}
                  <h3 className="text-base font-bold text-gray-900 dark:text-white mb-3">
                    See veg dishes from
                  </h3>

                  {/* Radio Options */}
                  <div className="space-y-2 mb-4">
                    {/* All restaurants */}
                    <label
                      className="flex items-center gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      onClick={() => setVegModeOption("all")}>
                      <div className="relative flex items-center justify-center">
                        <input
                          type="radio"
                          name="vegModeOption"
                          value="all"
                          checked={vegModeOption === "all"}
                          onChange={() => setVegModeOption("all")}
                          className="sr-only"
                        />
                        <div
                          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${vegModeOption === "all"
                            ? "border-green-600 dark:border-green-500 bg-green-600 dark:bg-green-500"
                            : "border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2a2a2a]"
                            }`}>
                          {vegModeOption === "all" && (
                            <div className="w-1.5 h-1.5 rounded-full bg-white dark:bg-white" />
                          )}
                        </div>
                      </div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        All restaurants
                      </span>
                    </label>

                    {/* Pure Veg restaurants only */}
                    <label
                      className="flex items-center gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      onClick={() => setVegModeOption("pure-veg")}>
                      <div className="relative flex items-center justify-center">
                        <input
                          type="radio"
                          name="vegModeOption"
                          value="pure-veg"
                          checked={vegModeOption === "pure-veg"}
                          onChange={() => setVegModeOption("pure-veg")}
                          className="sr-only"
                        />
                        <div
                          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${vegModeOption === "pure-veg"
                            ? "border-green-600 dark:border-green-500 bg-green-600 dark:bg-green-500"
                            : "border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2a2a2a]"
                            }`}>
                          {vegModeOption === "pure-veg" && (
                            <div className="w-1.5 h-1.5 rounded-full bg-white dark:bg-white" />
                          )}
                        </div>
                      </div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        Pure Veg restaurants only
                      </span>
                    </label>
                  </div>

                  {/* Apply Button */}
                  <button
                    onClick={() => {
                      setShowVegModePopup(false);
                      setIsApplyingVegMode(true);
                      // Confirm veg mode is ON by updating context and prevVegMode
                      setVegModeContext(true);
                      setPrevVegMode(true);
                      // Simulate applying veg mode settings
                      setTimeout(() => {
                        setIsApplyingVegMode(false);
                      }, 2000);
                    }}
                    className="w-full bg-[#DC2626] text-white font-semibold py-2.5 rounded-xl hover:bg-[#991B1B] transition-colors mb-2 text-sm">
                    Apply
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Switch Off Veg Mode Popup */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showSwitchOffPopup && (
              <>
                {/* Backdrop */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => {
                    setShowSwitchOffPopup(false);
                    isHandlingSwitchOff.current = false;
                    setVegModeContext(true);
                    // prevVegMode stays true (from before), which is correct
                  }}
                  className="fixed inset-0 bg-black/50 z-[9998] backdrop-blur-sm"
                />

                {/* Popup */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{
                    type: "spring",
                    damping: 25,
                    stiffness: 300,
                    mass: 0.8,
                  }}
                  className="fixed inset-0 z-[9999] flex dark:bg-[#lalala] dark:text-white items-center justify-center p-4"
                  onClick={(e) => e.stopPropagation()}>
                  <div className="bg-white dark:bg-[#lalala] dark:text-white rounded-2xl shadow-2xl w-[85%] max-w-sm p-6">
                    {/* Warning Icon */}
                    <div className="flex justify-center mb-4">
                      <div className="w-20 h-20 rounded-full bg-pink-100 flex items-center justify-center">
                        <AlertCircle
                          className="w-20 h-20 text-white bg-red-500/90 rounded-full p-2"
                          strokeWidth={2.5}
                        />
                      </div>
                    </div>

                    {/* Title */}
                    <h2 className="text-2xl font-bold text-gray-900  text-center mb-2">
                      Switch off Veg Mode?
                    </h2>

                    {/* Description */}
                    <p className="text-gray-600 text-center mb-6 text-sm">
                      You'll see all restaurants, including those serving non-veg
                      dishes
                    </p>

                    {/* Buttons */}
                    <div className="space-y-3">
                      <button
                        onClick={() => {
                          setShowSwitchOffPopup(false);
                          setIsSwitchingOffVegMode(true);
                          // Simulate switching off veg mode
                          setTimeout(() => {
                            setIsSwitchingOffVegMode(false);
                            isHandlingSwitchOff.current = false;
                            setVegModeContext(false);
                            setPrevVegMode(false); // Set to false to match current state (veg mode is OFF)
                          }, 2000);
                        }}
                        className="w-full bg-transparent text-red-600 font-normal py-1 text-normal rounded-xl hover:bg-red-50 transition-colors text-base">
                        Switch off
                      </button>

                      <button
                        onClick={() => {
                          setShowSwitchOffPopup(false);
                          isHandlingSwitchOff.current = false;
                          setVegModeContext(true);
                          // prevVegMode stays true (from before), which is correct
                        }}
                        className="w-full text-gray-900 font-normal py-1 text-center rounded-xl hover:bg-gray-200 transition-colors text-base">
                        Keep using this mode
                      </button>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* All Categories Modal */}
      <AnimatePresence>
        {showAllCategoriesModal && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setShowAllCategoriesModal(false)}
              className="fixed inset-0 bg-black/40 z-[9998] backdrop-blur-sm"
            />

            {/* Modal - Full screen with rounded corners */}
            <motion.div
              initial={{ opacity: 0, y: "100%" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "100%" }}
              transition={{
                type: "spring",
                damping: 30,
                stiffness: 300,
              }}
              className="fixed inset-x-0 bottom-0 top-12 sm:top-16 md:top-20 z-[9999] bg-white dark:bg-[#1a1a1a] rounded-t-3xl shadow-2xl overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 sm:px-6 sm:py-5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
                  All Categories
                </h2>
                <button
                  onClick={() => setShowAllCategoriesModal(false)}
                  className="p-1.5 sm:p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  aria-label="Close">
                  <X className="w-5 h-5 sm:w-6 sm:h-6 text-gray-600 dark:text-gray-400" />
                </button>
              </div>

              {/* Categories Grid - Scrollable */}
              <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 sm:py-5">
                <div className="grid grid-cols-3 gap-4 sm:gap-5 md:gap-6">
                  {displayCategories.map((category, index) => {
                    const categoryData = {
                      name: category.name || category.label,
                      image: category.image || category.imageUrl,
                      slug: category.slug,
                    };
                    return (
                      <motion.div
                        key={category.id || index}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{
                          duration: 0.3,
                          delay: index * 0.02,
                          type: "spring",
                          stiffness: 100,
                        }}
                        whileTap={{ scale: 0.95 }}>
                        <Link
                          to={toFoodUserPath(`/user/category/${categoryData.slug || categoryData.name.toLowerCase().replace(/\s+/g, "-")}`)}
                          onClick={() => {
                            rememberLeaveForCategory();
                            setShowAllCategoriesModal(false);
                          }}
                          className="block">
                          <div className="flex flex-col items-center gap-2 sm:gap-2.5 cursor-pointer w-full">
                            <div className="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-full overflow-hidden shadow-md transition-all hover:shadow-lg flex-shrink-0">
                              <OptimizedImage
                                src={categoryData.image}
                                alt={categoryData.name}
                                className="w-full h-full bg-white rounded-full"
                                sizes="(max-width: 640px) 80px, (max-width: 768px) 96px, 112px"
                                objectFit="cover"
                                responsive={false}
                                placeholder="empty"
                                priority={index < 8}
                                onError={() => { }}
                              />
                            </div>
                            <span className="text-xs sm:text-sm font-medium text-gray-800 dark:text-gray-200 text-center leading-tight px-1 break-words w-full min-w-0">
                              {categoryData.name}
                            </span>
                          </div>
                        </Link>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isApplyingVegMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[10000] bg-white dark:bg-[#0a0a0a] flex items-center justify-center">
            <div className="relative w-32 h-32 flex items-center justify-center w-full">
              {/* Animated circles - positioned absolutely at the center */}
              {[...Array(8)].map((_, i) => {
                const baseSize = 112;
                const maxSize = 600;
                return (
                  <motion.div
                    key={i}
                    initial={{
                      scale: 1,
                      opacity: 0,
                    }}
                    animate={{
                      scale: maxSize / baseSize,
                      opacity: [0, 0.4, 0.2, 0],
                    }}
                    transition={{
                      duration: 2.5,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: "easeOut",
                      delay: i * 0.15,
                    }}
                    className="absolute rounded-full border border-green-300 dark:border-green-600"
                    style={{
                      width: baseSize,
                      height: baseSize,
                    }}
                  />
                );
              })}

              {/* 100% VEG badge - absolute positioning at exact center */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 15,
                  delay: 0.1,
                }}
                className="absolute z-10 w-28 h-28 rounded-full border-2 border-green-600 dark:border-green-500 bg-white dark:bg-[#1a1a1a] flex flex-col items-center justify-center shadow-sm"
              >
                <motion.div
                  className="flex flex-col items-center"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}>
                  <span className="text-green-600 dark:text-green-400 font-extrabold text-3xl leading-none">
                    100%
                  </span>
                  <span className="text-green-600 dark:text-green-400 font-extrabold text-3xl leading-none mt-0.5">
                    VEG
                  </span>
                </motion.div>
              </motion.div>

              {/* Text below badge */}
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-xl font-normal text-gray-800 dark:text-gray-200 text-center relative z-10 mt-56 w-full">
                Explore veg dishes from all restaurants
              </motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading Screen - Switching Off Veg Mode */}
      <AnimatePresence>
        {isSwitchingOffVegMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[10000] bg-white dark:bg-[#0a0a0a] flex items-center justify-center">
            <div className="flex flex-col items-center gap-6">
              {/* Two Circles Spinning in Opposite Directions */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 15,
                  delay: 0.1,
                }}
                className="relative w-16 h-16 flex items-center justify-center">
                {/* Outer Circle - Spins Clockwise */}
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{
                    rotate: {
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "linear",
                    },
                  }}
                  className="absolute w-16 h-16 border-[4px] border-transparent border-t-pink-500 dark:border-t-pink-400 border-r-pink-500 dark:border-r-pink-400 rounded-full"
                />

                {/* Inner Circle - Spins Counter-clockwise */}
                <motion.div
                  animate={{ rotate: -360 }}
                  transition={{
                    rotate: {
                      duration: 1,
                      repeat: Infinity,
                      ease: "linear",
                    },
                  }}
                  className="absolute w-12 h-12 border-[4px] border-transparent border-r-pink-500 dark:border-r-pink-400 rounded-full"
                />
              </motion.div>

              {/* Loading Text */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-center">
                <motion.h2
                  className="text-xl font-normal text-gray-800 dark:text-gray-200 mb-1"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}>
                  Switching off
                </motion.h2>
                <motion.p
                  className="text-xl font-normal text-gray-800 dark:text-gray-200"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}>
                  Veg Mode for you
                </motion.p>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast Notification - Fixed to viewport bottom */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showToast && (
              <motion.div
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 100, opacity: 0 }}
                transition={{ duration: 0.3, type: "spring", damping: 25 }}
                className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[10001] bg-black text-white px-6 py-3 rounded-lg shadow-2xl">
                <p className="text-sm font-medium">Added to bookmark</p>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}

      {/* Manage Collections Modal */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showManageCollections && (
              <>
                {/* Backdrop */}
                <motion.div
                  className="fixed inset-0 bg-black/40 z-[9999]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setShowManageCollections(false)}
                />

                {/* Manage Collections Bottom Sheet */}
                <motion.div
                  className="fixed left-0 right-0 bottom-0 z-[10000] bg-white rounded-t-3xl shadow-2xl"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{
                    duration: 0.2,
                    type: "spring",
                    damping: 30,
                    stiffness: 400,
                  }}>
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-gray-200">
                    <h2 className="text-lg font-bold text-gray-900">
                      Manage Collections
                    </h2>
                    <button
                      onClick={() => setShowManageCollections(false)}
                      className="h-8 w-8 rounded-full bg-gray-700 flex items-center justify-center hover:bg-gray-800 transition-colors">
                      <X className="h-4 w-4 text-white" />
                    </button>
                  </div>

                  {/* Collections List */}
                  <div className="px-4 py-4 space-y-2 max-h-[60vh] overflow-y-auto">
                    {/* Bookmarks Collection */}
                    <div
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Don't close modal on click, let checkbox handle it
                      }}>
                      <div className="h-12 w-12 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0">
                        <Bookmark className="h-6 w-6 text-red-500 fill-red-500" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="flex items-center justify-between">
                          <span className="text-base font-medium text-gray-900">
                            Bookmarks
                          </span>
                          {selectedRestaurantSlug && (
                            <div onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={isFavorite(selectedRestaurantSlug)}
                                onCheckedChange={(checked) => {
                                  if (!checked) {
                                    removeFavorite(selectedRestaurantSlug);
                                    setSelectedRestaurantSlug(null);
                                    setShowManageCollections(false);
                                  }
                                }}
                                className="h-5 w-5 rounded border-2 border-green-500 data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500"
                              />
                            </div>
                          )}
                          {!selectedRestaurantSlug && (
                            <div className="h-5 w-5 rounded border-2 border-red-500 bg-red-500 flex items-center justify-center">
                              <Check className="h-3 w-3 text-white" />
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          {getFavorites().length} restaurant
                          {getFavorites().length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>

                    {/* Create new Collection */}
                    <button
                      className="w-full flex items-start gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors"
                      onClick={() => setShowManageCollections(false)}>
                      <div className="h-12 w-12 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0">
                        <Plus className="h-6 w-6 text-red-500" />
                      </div>
                      <div className="flex-1 text-left">
                        <span className="text-base font-medium text-gray-900">
                          Create new Collection
                        </span>
                      </div>
                    </button>
                  </div>

                  {/* Done Button */}
                  <div className="border-t border-gray-200 px-4 py-4">
                    <Button
                      className="w-full bg-gray-300 hover:bg-gray-400 text-gray-700 py-3 rounded-lg font-medium"
                      onClick={() => {
                        setSelectedRestaurantSlug(null);
                        setShowManageCollections(false);
                      }}>
                      Done
                    </Button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}

      <Footer />
      <StickyCartCard />
      {/* Live order strip: only on homepage (not in UserLayout) */}
      <OrderTrackingCard hasBottomNav />
    </div>
  );
}

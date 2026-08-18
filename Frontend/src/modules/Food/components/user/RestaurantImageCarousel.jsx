import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import OptimizedImage from "@food/components/OptimizedImage";
import { useProfile } from "@food/context/ProfileContext";
import { isVegMenuItem } from "@food/utils/vegMode";
import { saveBrowseScroll, saveCategoryBrowseClick } from "@food/utils/browseScrollMemory";
import dishFallbackImage from "@food/assets/dish_fallback.webp";
import { toFoodUserPath, getRestaurantRouteId } from "@food/utils/mainTabRoutes";

const WEBVIEW_SESSION_CACHE_BUSTER = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Home / category restaurant card image carousel (auto-swipe + dish overlay). */
const RestaurantImageCarousel = React.memo(
  ({
    restaurant,
    priority = false,
    backendOrigin = "",
    className = "h-56 sm:h-60 md:h-64 lg:h-[280px] xl:h-[320px]",
    roundedClass = "rounded-t-md",
    backFrom = "",
    focusId = "",
    visibleCount,
    categoryFallbackImage = null,
  }) => {
    const webviewSessionKeyRef = useRef(WEBVIEW_SESSION_CACHE_BUSTER);
    const navigate = useNavigate();
    const { vegMode } = useProfile();

    const withCacheBuster = useCallback(
      (url) => {
        if (typeof url !== "string" || !url) return "";
        if (/^data:/i.test(url) || /^blob:/i.test(url)) return url;

        const isRelative = !/^(https?:|\/\/|data:|blob:)/i.test(url.trim());
        const resolvedUrl =
          backendOrigin && isRelative
            ? `${backendOrigin.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`
            : url;

        const hasSignedParams =
          /[?&](X-Amz-|Signature=|Expires=|AWSAccessKeyId=|GoogleAccessId=|token=|sig=|se=|sp=|sv=)/i.test(
            resolvedUrl,
          );
        if (hasSignedParams) return resolvedUrl;

        try {
          const parsed = new URL(resolvedUrl, window.location.origin);
          const currentHost =
            typeof window !== "undefined" ? window.location.hostname : "";
          const isLocalHost = /^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname);
          const isSameHost = currentHost && parsed.hostname === currentHost;

          if (isLocalHost || isSameHost) {
            parsed.searchParams.set("_wv", webviewSessionKeyRef.current);
          }
          return parsed.toString();
        } catch {
          return resolvedUrl;
        }
      },
      [backendOrigin],
    );

    const slideItems = useMemo(() => {
      let items = [];
        if (Array.isArray(restaurant.recommendedDishes) && restaurant.recommendedDishes.length > 0) {
          restaurant.recommendedDishes.forEach((dish, idx) => {
            if (vegMode && !isVegMenuItem(dish)) return;
            const dishImg = dish.image || categoryFallbackImage;
            if (dishImg) {
              const finalSrc = dishImg === dishFallbackImage ? dishImg : withCacheBuster(dishImg);
              items.push({ id: dish.id || idx, src: finalSrc, dish });
            }
          });
        }

        if (items.length === 0) {
          const sourceImages =
            Array.isArray(restaurant.images) && restaurant.images.length > 0
              ? restaurant.images
              : [restaurant.image];
          const validImages = sourceImages
            .filter((img) => typeof img === "string")
            .map((img) => img.trim())
            .filter(Boolean);
          if (validImages.length > 0) {
            items.push({ id: "fallback", src: withCacheBuster(validImages[0]), dish: null });
          } else if (categoryFallbackImage) {
            const finalSrc = categoryFallbackImage === dishFallbackImage ? dishFallbackImage : withCacheBuster(categoryFallbackImage);
            items.push({ id: "fallback", src: finalSrc, dish: null });
          } else {
            items.push({ id: "fallback", src: dishFallbackImage, dish: null });
          }
        }
      return items;
    }, [restaurant.recommendedDishes, restaurant.images, restaurant.image, withCacheBuster, vegMode, categoryFallbackImage]);

    const carouselRef = useRef(null);
    const [isCentered, setIsCentered] = useState(false);

    useEffect(() => {
      if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
        setIsCentered(true);
        return undefined;
      }

      const observer = new IntersectionObserver(
        ([entry]) => {
          setIsCentered(entry.isIntersecting);
        },
        {
          rootMargin: "-20% 0px -20% 0px",
          threshold: 0,
        }
      );

      const currentRef = carouselRef.current;
      if (currentRef) {
        observer.observe(currentRef);
      }

      return () => {
        if (currentRef) {
          observer.unobserve(currentRef);
        }
      };
    }, []);

    const [currentIndex, setCurrentIndex] = useState(0);
    const [isImageUnavailable, setIsImageUnavailable] = useState(false);
    const [loadedIndices, setLoadedIndices] = useState(new Set([0]));
    const touchStartX = useRef(0);
    const touchEndX = useRef(0);
    const isSwiping = useRef(false);
    const preloadedSrcsRef = useRef(new Set());

    const [isTransitioning, setIsTransitioning] = useState(true);
    const [displayIndex, setDisplayIndex] = useState(0);

    const infiniteSlides = useMemo(() => {
      if (slideItems.length <= 1) return slideItems;
      return [...slideItems, { ...slideItems[0], id: "clone-first" }];
    }, [slideItems]);

    const handleNext = useCallback(() => {
      if (slideItems.length <= 1) return;
      setIsTransitioning(true);
      setCurrentIndex((prev) => prev + 1);
    }, [slideItems.length]);

    const handlePrev = useCallback(() => {
      if (slideItems.length <= 1) return;
      setIsTransitioning(true);
      setCurrentIndex((prev) => (prev - 1 + infiniteSlides.length) % infiniteSlides.length);
    }, [slideItems.length, infiniteSlides.length]);

    useEffect(() => {
      if (slideItems.length <= 1 || !isCentered) return undefined;
      const timer = setInterval(() => {
        handleNext();
      }, 3000);
      return () => clearInterval(timer);
    }, [slideItems.length, handleNext, isCentered]);

    useEffect(() => {
      if (currentIndex === infiniteSlides.length - 1 && slideItems.length > 1) {
        const timer = setTimeout(() => {
          setIsTransitioning(false);
          setCurrentIndex(0);
        }, 500);
        return () => clearTimeout(timer);
      }
    }, [currentIndex, infiniteSlides.length, slideItems.length]);

    useEffect(() => {
      if (slideItems.length > 0) {
        setDisplayIndex(currentIndex % slideItems.length);
      }
    }, [currentIndex, slideItems.length]);

    useEffect(() => {
      if (slideItems.length === 0) {
        setIsImageUnavailable(true);
        return;
      }

      setCurrentIndex(0);
      setIsTransitioning(true);
      setIsImageUnavailable(false);

      const uniqueSrcs = [...new Set(slideItems.map((item) => item.src).filter(Boolean))];

      uniqueSrcs.forEach((src) => {
        if (preloadedSrcsRef.current.has(src)) return;
        preloadedSrcsRef.current.add(src);
        const img = new Image();
        img.decoding = "async";
        img.src = src;
      });

      setLoadedIndices(
        new Set(
          Array.from(
            { length: Math.max(slideItems.length + (slideItems.length > 1 ? 1 : 0), 1) },
            (_, i) => i,
          ),
        ),
      );
    }, [restaurant?.id, restaurant?.slug, restaurant?.updatedAt, slideItems]);

    const handleTouchStart = (e) => {
      touchStartX.current = e.touches[0].clientX;
      isSwiping.current = false;
    };

    const handleTouchMove = (e) => {
      const currentX = e.touches[0].clientX;
      const diff = touchStartX.current - currentX;
      if (Math.abs(diff) > 10) isSwiping.current = true;
    };

    const handleTouchEnd = (e) => {
      if (!isSwiping.current) return;
      touchEndX.current = e.changedTouches[0].clientX;
      const diff = touchStartX.current - touchEndX.current;
      const minSwipeDistance = 50;

      if (Math.abs(diff) > minSwipeDistance) {
        if (diff > 0) handleNext();
        else handlePrev();
      }
      isSwiping.current = false;
    };

    const handleDishClick = (e, dish) => {
      if (!dish) return;
      e.preventDefault();
      e.stopPropagation();
      const targetId = getRestaurantRouteId(restaurant);
      if (!targetId) return;
      const fromPath =
        backFrom ||
        (typeof window !== "undefined" ? window.location.pathname : "");
      const browseFocusId =
        focusId || restaurant?.id || restaurant?.restaurantId || restaurant?.mongoId || "";

      const payload = {
        path: fromPath,
        scrollY: Math.max(
          typeof window !== "undefined" ? window.scrollY || 0 : 0,
          0,
        ),
        focusId: browseFocusId,
        visibleCount,
      };
      // Category pages need durable in-memory click (survives 2nd back)
      if (String(fromPath || "").includes("/category/")) {
        saveCategoryBrowseClick(payload);
      } else {
        saveBrowseScroll(payload);
      }

      navigate(toFoodUserPath(`/user/restaurants/${targetId}?dish=${dish.id}`), {
        state: {
          from: fromPath || undefined,
          restaurantData: restaurant,
        },
      });
    };

    const showMultipleImages = slideItems.length > 1;
    const currentSlide = infiniteSlides[currentIndex] || null;
    const isDishVeg = currentSlide?.dish ? isVegMenuItem(currentSlide.dish) : false;

    return (
      <div
        ref={carouselRef}
        className={`relative ${className} w-full overflow-hidden ${roundedClass} flex-shrink-0 group`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={(e) => (currentSlide?.dish ? handleDishClick(e, currentSlide.dish) : null)}
      >
        <div
          className={`absolute inset-0 flex h-full group-hover:scale-105 ${
            isTransitioning ? "transition-transform duration-500 ease-in-out" : "transition-none"
          }`}
          style={{ transform: `translateX(-${currentIndex * 100}%)` }}
        >
          {infiniteSlides.map((item, idx) => {
            const shouldLoad = loadedIndices.has(idx);

            return (
              <div key={`${item.id}-${idx}`} className="w-full h-full flex-shrink-0 relative">
                {shouldLoad ? (
                  <OptimizedImage
                    src={item.src}
                    alt={`${restaurant.name} - Image ${idx + 1}`}
                    className="w-full h-full"
                    objectFit="cover"
                    responsive={false}
                    priority={priority && idx === 0}
                    placeholder="empty"
                    onError={() => {
                      if (idx === currentIndex && slideItems.length === 1) setIsImageUnavailable(true);
                    }}
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700 animate-pulse" />
                )}
              </div>
            );
          })}
        </div>

        {/* Soft top scrim so dish badge stays readable on bright images */}
        {currentSlide?.dish && (
          <div className="absolute inset-x-0 top-0 h-16 z-[1] bg-gradient-to-b from-black/45 to-transparent pointer-events-none" />
        )}

        {currentSlide?.dish && (
          <div className="absolute top-3 left-3 z-[2] max-w-[calc(100%-4.5rem)] pointer-events-none drop-shadow-lg">
            <div className="bg-black/92 px-3 py-1.5 rounded-full flex items-center gap-2 shadow-[0_4px_14px_rgba(0,0,0,0.45)] border border-white/20">
              {!vegMode &&
                (isDishVeg || currentSlide.dish.foodType === "Veg" ? (
                  <div className="flex-shrink-0 w-3.5 h-3.5 border-[1.5px] border-green-600 bg-white rounded-[2px] flex items-center justify-center p-[1.5px]">
                    <div className="w-full h-full bg-green-600 rounded-full" />
                  </div>
                ) : (
                  <div className="flex-shrink-0 w-3.5 h-3.5 border-[1.5px] border-red-600 bg-white rounded-[2px] flex items-center justify-center p-[1.5px]">
                    <div className="w-full h-full bg-red-600 rounded-full" />
                  </div>
                ))}
              <div className="flex items-center gap-1.5 whitespace-nowrap overflow-hidden min-w-0">
                <span className="text-white font-bold text-xs tracking-tight truncate">
                  {currentSlide.dish.name}
                </span>
                <span className="text-white/70 font-bold text-xs flex-shrink-0">•</span>
                <span className="text-white font-black text-xs flex-shrink-0">₹{currentSlide.dish.price}</span>
              </div>
            </div>
          </div>
        )}

        {isImageUnavailable && (
          <div className="absolute inset-0 z-[1] flex items-center justify-center bg-gray-100">
            <span className="text-xs text-gray-500">Image unavailable</span>
          </div>
        )}

        {showMultipleImages && (
          <div className="absolute bottom-3 right-3 z-[2] flex items-center gap-1.5 pointer-events-auto">
            {slideItems.map((_, index) => (
              <button
                key={index}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCurrentIndex(index);
                }}
                className="focus:outline-none flex items-center py-0.5 group/btn"
                aria-label={`Go to slide ${index + 1}`}
              >
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 shadow-sm ${
                    index === displayIndex
                      ? "w-4 bg-white opacity-100"
                      : "w-1.5 bg-white/50 group-hover/btn:opacity-90 group-hover/btn:bg-white"
                  }`}
                />
              </button>
            ))}
          </div>
        )}

        <div className="absolute inset-0 z-[1] bg-gradient-to-t from-black/60 via-transparent to-black/20 opacity-0 transition-opacity duration-300 group-hover:opacity-100 pointer-events-none" />
      </div>
    );
  },
);

RestaurantImageCarousel.displayName = "RestaurantImageCarousel";

export default RestaurantImageCarousel;


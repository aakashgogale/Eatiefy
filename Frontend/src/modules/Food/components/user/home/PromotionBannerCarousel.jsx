import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePublicAppConfig } from "@food/context/PublicAppConfigContext";

const PromotionBannerCarousel = ({ zoneId: propZoneId }) => {
  const { promoBanners } = usePublicAppConfig() || {};
  const [banners, setBanners] = useState(() => (Array.isArray(promoBanners) ? promoBanners : []));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(!Array.isArray(promoBanners));
  const autoSlideIntervalRef = useRef(null);

  useEffect(() => {
    if (Array.isArray(promoBanners)) {
      setBanners(promoBanners);
      setLoading(false);
    }
  }, [promoBanners]);

  const startAutoSlide = useCallback(() => {
    if (autoSlideIntervalRef.current) clearInterval(autoSlideIntervalRef.current);
    if (banners.length <= 1) return;

    autoSlideIntervalRef.current = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      setCurrentIndex((prev) => (prev + 1) % banners.length);
    }, 5000);
  }, [banners.length]);

  useEffect(() => {
    startAutoSlide();
    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        startAutoSlide();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (autoSlideIntervalRef.current) clearInterval(autoSlideIntervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [startAutoSlide]);

  const handleNext = (e) => {
    e?.stopPropagation();
    setCurrentIndex((prev) => (prev + 1) % banners.length);
    startAutoSlide();
  };

  const handlePrev = (e) => {
    e?.stopPropagation();
    setCurrentIndex((prev) => (prev - 1 + banners.length) % banners.length);
    startAutoSlide();
  };

  // If loading and zoneId exists, show skeleton briefly. Otherwise if no banners, return null cleanly.
  if (loading && zoneId) {
    return (
      <div className="px-4 py-2 max-w-7xl mx-auto w-full">
        <div className="w-full h-36 sm:h-40 md:h-48 rounded-[24px] bg-gray-100 dark:bg-gray-800 animate-pulse" />
      </div>
    );
  }

  if (!banners.length) return null;

  return (
    <div className="px-4 py-4 relative group max-w-md sm:max-w-xl md:max-w-6xl lg:max-w-7xl mx-auto w-full">
      <div className="relative overflow-hidden rounded-[24px] shadow-lg aspect-[18/8] sm:aspect-[24/9] md:aspect-[24/8] lg:aspect-[24/7] max-h-[160px] sm:max-h-[165px] md:max-h-[280px] lg:max-h-[360px]">
        {banners.map((banner, index) => (
          <div
            key={banner._id?.$oid || banner._id || index}
            className="absolute inset-0 transition-opacity duration-700 ease-in-out"
            style={{
              opacity: currentIndex === index ? 1 : 0,
              zIndex: currentIndex === index ? 2 : 1,
              pointerEvents: currentIndex === index ? "auto" : "none",
            }}
          >
            <a 
              href={banner.ctaLink || "#"} 
              className="block w-full h-full"
              onClick={(e) => {
                if (!banner.ctaLink) e.preventDefault();
              }}
            >
              <img 
                src={banner.imageUrl} 
                alt={banner.title || "Promotion"} 
                className="w-full h-full object-cover"
               loading="lazy" decoding="async" />
            </a>
          </div>
        ))}

        {/* Navigation Arrows - Visible on Hover */}
        {banners.length > 1 && (
          <>
            <button
              onClick={handlePrev}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/30 backdrop-blur-md text-white opacity-0 group-hover:opacity-100 transition-opacity z-30"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={handleNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/30 backdrop-blur-md text-white opacity-0 group-hover:opacity-100 transition-opacity z-30"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}

        {/* Indicators */}
        {banners.length > 1 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-30">
            {banners.map((_, idx) => (
              <div
                key={idx}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  idx === currentIndex ? "w-6 bg-white" : "w-1.5 bg-white/50"
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PromotionBannerCarousel;

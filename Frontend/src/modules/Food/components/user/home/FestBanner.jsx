import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Utensils, Soup } from 'lucide-react';

// Images for different modes - Extended pool for rotation
const images = {
  nonVeg: [
    "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=500&h=500&fit=crop", // Taco
    "https://images.unsplash.com/photo-1544025162-d76694265947?w=500&h=500&fit=crop", // Platter
    "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500&h=500&fit=crop", // Burger
    "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=500&h=500&fit=crop", // Grilled Chicken
    "https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=500&h=500&fit=crop", // Kebabs
  ],
  veg: [
    "https://images.unsplash.com/photo-1585238341267-1cfec2046a55?w=500&h=500&fit=crop", // Veg Taco
    "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=500&h=500&fit=crop", // Salad/Platter
    "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=500&h=500&fit=crop", // Paneer/Veg
    "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&h=500&fit=crop", // Healthy Bowl
    "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=500&h=500&fit=crop", // Veg Pizza
  ]
};

const preloadedFestPools = new Set();
function preloadFestPool(pool, poolKey) {
  if (!pool?.length || preloadedFestPools.has(poolKey)) return;
  preloadedFestPools.add(poolKey);
  pool.forEach((src) => {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  });
}

export default function FestBanner({ isVegMode, videoUrl = "", hideFoodImages = false }) {
  const [imgIndex, setImgIndex] = useState(0);
  const currentPool = isVegMode ? images.veg : images.nonVeg;
  const poolKey = isVegMode ? "veg" : "nonVeg";
  const hasVideo = typeof videoUrl === "string" && videoUrl.trim().length > 0;

  useEffect(() => {
    preloadFestPool(currentPool, poolKey);
  }, [currentPool, poolKey]);
  
  // Dynamic rotation
  useEffect(() => {
    const timer = setInterval(() => {
      setImgIndex(prev => (prev + 1) % currentPool.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [currentPool.length]);

  // Reset index when mode changes
  useEffect(() => {
    setImgIndex(0);
  }, [isVegMode]);

  // Get 3 images starting from current index
  const displayImages = [
    currentPool[(imgIndex) % currentPool.length],
    currentPool[(imgIndex + 1) % currentPool.length],
    currentPool[(imgIndex + 2) % currentPool.length]
  ];

  return (
      <motion.div 
      initial={false}
      className={`relative px-4 pt-2 pb-4 overflow-hidden min-h-[140px] sm:min-h-[180px] transition-all duration-700 ${hasVideo ? 'bg-transparent' : 'bg-transparent'} rounded-b-[2rem]`}
    >
      {hasVideo && (
        <div className="absolute inset-0 z-0">
          <video
            src={videoUrl}
            className="w-full h-full object-cover"
            autoPlay
            muted
            loop
            playsInline
          />
          <div className="absolute inset-0 bg-black/35" />
        </div>
      )}

      <div className="relative z-10 flex flex-col items-center text-center space-y-4">


        <motion.div
          key={isVegMode ? 'veg-title' : 'nonveg-title'}
          className="mt-4"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 10, stiffness: 100 }}
        >
          <h2 
            className="text-4xl sm:text-5xl font-black text-[#fff200] italic uppercase leading-none drop-shadow-md"
            style={{ WebkitTextStroke: '1px #5a0000' }}
          >
            {isVegMode ? 'VEGGIE DELIGHT' : 'FLAVOUR FEST'}
          </h2>
        </motion.div>
        
        <div 
          className="relative flex items-center gap-3 px-6 py-1.5 bg-white/10 backdrop-blur-md rounded-full border border-white/20 shadow-xl group"
        >
          {/* Left Icon with Sparks */}
          <div className="relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex gap-0.5">
              <div className="w-0.5 h-2 bg-[#fff200] rotate-[-20deg] rounded-full" />
              <div className="w-0.5 h-2.5 bg-[#fff200] rounded-full" />
              <div className="w-0.5 h-2 bg-[#fff200] rotate-[20deg] rounded-full" />
            </div>
            <Utensils className="h-6 w-6 text-[#fff200]" />
          </div>

          {/* Text with Wavy Lines */}
          <div className="relative px-2">
            {/* Top Wavy Line */}
            <svg className="absolute -top-1.5 left-0 w-full h-1.5" viewBox="0 0 100 10" preserveAspectRatio="none">
              <path d="M0 5 Q 25 0, 50 5 T 100 5" fill="none" stroke="#fff200" strokeWidth="2" opacity="0.6" />
            </svg>
            
            <span className="text-base sm:text-lg font-bold italic text-white leading-none whitespace-nowrap drop-shadow-md">
              {isVegMode ? 'Pure Veg Magic!' : 'Good Food, Great Mood!'}
            </span>

            {/* Bottom Wavy Line */}
            <svg className="absolute -bottom-1.5 left-0 w-full h-1.5" viewBox="0 0 100 10" preserveAspectRatio="none">
              <path d="M0 5 Q 25 10, 50 5 T 100 5" fill="none" stroke="#fff200" strokeWidth="2" opacity="0.6" />
            </svg>
          </div>

          {/* Right Icon with Sparks */}
          <div className="relative">
             <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex gap-0.5">
              <div className="w-0.5 h-2 bg-[#fff200] rotate-[-20deg] rounded-full" />
              <div className="w-0.5 h-2.5 bg-[#fff200] rounded-full" />
              <div className="w-0.5 h-2 bg-white rotate-[20deg] rounded-full" />
            </div>
            <Soup className="h-7 w-7 text-[#fff200]" />
          </div>
        </div>

        {hideFoodImages ? (
          <div className="h-28 sm:h-36" />
        ) : (
          <div className="flex items-end justify-center gap-5 sm:gap-8 pt-10 relative w-full mb-2">
            <div
              aria-hidden
              className="pointer-events-none absolute w-px h-px overflow-hidden opacity-0"
            >
              {currentPool.map((src) => (
                <img key={src} src={src} alt="" decoding="async" />
              ))}
            </div>

            <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 w-56 h-12 blur-[45px] rounded-full transition-colors duration-700 ${isVegMode ? 'bg-emerald-500/40' : 'bg-yellow-400/40'}`} />
            
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div 
                key={`img-left-${isVegMode}-${imgIndex}`}
                className="w-16 h-16 sm:w-20 sm:h-20 z-10"
                initial={{ x: -100, opacity: 0, rotate: -45, scale: 0.5 }}
                animate={{ 
                  x: 0, 
                  opacity: 1, 
                  rotate: -15,
                  scale: 1,
                  y: [0, -12, 0]
                }}
                exit={{ x: -100, opacity: 0, rotate: -45, scale: 0.5 }}
                transition={{ 
                  y: { duration: 3.5, repeat: Infinity, ease: "easeInOut" },
                  default: { duration: 0.8, type: "spring", damping: 15 }
                }}
                style={{ willChange: 'transform, opacity', backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
              >
                <img src={displayImages[0]} alt="food" decoding="async" loading="eager" className="w-full h-full object-cover rounded-2xl border-[3px] border-white shadow-2xl rotate-12" />
              </motion.div>

              <motion.div 
                key={`img-center-${isVegMode}-${imgIndex}`}
                className="w-24 h-24 sm:w-32 sm:h-32 z-30 -mb-2"
                initial={{ y: 100, opacity: 0, scale: 0.5 }}
                animate={{ 
                  y: 0, 
                  opacity: 1,
                  scale: 1,
                  rotate: [0, 5, -5, 0]
                }}
                exit={{ y: 50, opacity: 0, scale: 0.5 }}
                transition={{ 
                  rotate: { duration: 6, repeat: Infinity, ease: "easeInOut" },
                  default: { duration: 0.8, type: "spring", damping: 12, stiffness: 100 }
                }}
                style={{ willChange: 'transform, opacity', backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
              >
                <div className="relative h-full w-full">
                  <div className={`absolute -inset-2.5 blur-3xl rounded-full animate-pulse transition-colors duration-700 ${isVegMode ? 'bg-white/40' : 'bg-yellow-400/40'}`} />
                  <img src={displayImages[1]} alt="food" decoding="async" loading="eager" className="relative w-full h-full object-cover rounded-[2.5rem] border-[4px] border-white shadow-[0_22px_55px_rgba(0,0,0,0.4)]" />
                </div>
              </motion.div>

              <motion.div 
                key={`img-right-${isVegMode}-${imgIndex}`}
                className="w-16 h-16 sm:w-20 sm:h-20 z-10"
                initial={{ x: 100, opacity: 0, rotate: 45, scale: 0.5 }}
                animate={{ 
                  x: 0, 
                  opacity: 1, 
                  rotate: 15,
                  scale: 1,
                  y: [0, -12, 0]
                }}
                exit={{ x: 100, opacity: 0, rotate: 45, scale: 0.5 }}
                transition={{ 
                  y: { duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.4 },
                  default: { duration: 0.8, type: "spring", damping: 15 }
                }}
                style={{ willChange: 'transform, opacity', backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
              >
                <img src={displayImages[2]} alt="food" decoding="async" loading="eager" className="w-full h-full object-cover rounded-2xl border-[3px] border-white shadow-2xl -rotate-12 bg-white" />
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  );
}

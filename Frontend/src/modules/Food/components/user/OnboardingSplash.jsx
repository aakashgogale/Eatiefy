import React from 'react';
import { motion } from 'framer-motion';
import burgerScreenImg from '../../assets/burgerScreenImg.png';

export default function OnboardingSplash({ onComplete, onSignInClick }) {
  const handleGetStarted = () => {
    localStorage.setItem('eatiefy_onboarding_completed', 'true');
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-white font-sans select-none flex justify-center">
      
      {/* Main Content Container */}
      <div className="relative w-full h-full max-w-md bg-white flex flex-col justify-between overflow-hidden">
        
        {/* Soft Background Blobs for premium look */}
        <svg className="absolute -top-10 -right-10 pointer-events-none z-0" width="260" height="280" viewBox="0 0 260 280" fill="none">
          <path d="M190 10 C220 -5 265 10 270 50 C275 90 252 135 228 158 C204 181 170 178 155 155 C140 132 145 95 158 68 C171 41 160 25 190 10 Z" fill="#EAF6D8" opacity="0.72"/>
        </svg>
        <svg className="absolute -bottom-8 -left-8 pointer-events-none z-0" width="180" height="190" viewBox="0 0 180 190" fill="none">
          <path d="M10 180 C-10 145 -5 100 18 72 C41 44 80 35 105 52 C130 69 135 105 120 132 C105 159 68 175 10 180 Z" fill="#EAF6D8" opacity="0.45"/>
        </svg>

        {/* Dynamic Slide Content */}
        <div className="flex-1 flex flex-col relative z-10 w-full h-full pt-16 pb-8">
          
          {/* Image Container with CSS Cropping to hide baked-in text */}
          <div className="relative w-full h-[38vh] sm:h-[42vh] overflow-hidden shrink-0 pointer-events-none flex justify-center items-center mt-2">
            <motion.img
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              src={burgerScreenImg}
              alt="Delicious Burger"
              // Foolproof centering: position image absolutely, scale width, and use transform to perfectly center the burger
              className="absolute top-1/2 left-1/2 w-[125%] max-w-none h-auto -translate-x-1/2 -translate-y-[52%]"
            />
            {/* White gradient overlays to seamlessly blend the hard edges */}
            <div className="absolute bottom-0 left-0 w-full h-20 bg-gradient-to-t from-white via-white/80 to-transparent z-10" />
            <div className="absolute top-0 left-0 w-full h-16 bg-gradient-to-b from-white via-white/80 to-transparent z-10" />
          </div>

          {/* Text + Controls — Centered */}
          <div className="px-8 flex flex-col items-center justify-center w-full flex-1 text-center z-20 mt-4">

            {/* Brand Name */}
            <h2 className="text-3xl font-black text-gray-900 tracking-tight mb-2">
              Eatiefy
            </h2>

            {/* Headlines */}
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 leading-tight mb-3">
              Satisfy Your <span style={{ color: "#659116" }}>Cravings</span>
            </h1>

            <p className="text-sm sm:text-base text-gray-500 leading-relaxed max-w-[280px] mx-auto mb-8">
              Delicious meals, hot burgers, and street foods delivered fresh to your doorstep.
            </p>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Action Buttons */}
            <div className="w-full max-w-xs mx-auto">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleGetStarted}
                className="w-full text-white font-bold py-3.5 px-6 rounded-2xl flex items-center justify-center transition-all text-base shadow-[0_8px_20px_rgba(101,145,22,0.3)] hover:opacity-90"
                style={{ backgroundColor: "#659116" }}
              >
                Get Started
              </motion.button>

              {/* Sign In Row */}
              <div className="text-center mt-5 w-full">
                <span className="text-sm text-gray-500">
                  Already have an account?{" "}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem('eatiefy_onboarding_completed', 'true');
                    onSignInClick();
                  }}
                  className="text-sm font-bold hover:opacity-80 transition-opacity"
                  style={{ color: "#659116" }}
                >
                  Sign In
                </button>
              </div>
            </div>

          </div>

        </div>
      </div>
    </div>
  );
}

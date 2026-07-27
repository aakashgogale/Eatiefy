import React from 'react';
import { motion } from 'framer-motion';
import onboardingBurger from '../../assets/onboarding_burger.png';

export default function OnboardingSplash({ onComplete, onSignInClick }) {
  const handleGetStarted = () => {
    localStorage.setItem('eatiefy_onboarding_completed', 'true');
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-white dark:bg-[#0a0a0a] font-sans select-none flex justify-center">
      
      {/* Main Content Container (Limited to mobile width on desktop, full screen on mobile) */}
      <div className="relative w-full h-full max-w-md bg-white dark:bg-[#0a0a0a] flex flex-col justify-between overflow-hidden">
        

        {/* ══════════════════════════════════════════
            LUXURY BACKGROUND DECORATION LAYER
            All z-0, pointer-events-none, behind bowl
        ══════════════════════════════════════════ */}

        {/* ① Top-right large organic blob — partially cropped off screen */}
        <svg className="absolute -top-10 -right-10 pointer-events-none z-0"
          width="260" height="280" viewBox="0 0 260 280" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M190 10 C220 -5 265 10 270 50 C275 90 252 135 228 158 C204 181 170 178 155 155 C140 132 145 95 158 68 C171 41 160 25 190 10 Z"
            fill="#EAF6D8" opacity="0.72"/>
          <path d="M230 -15 C255 -5 278 25 278 60 C278 95 260 130 238 145 C225 153 215 148 212 135 C209 122 218 105 225 85 C235 60 238 30 230 -15 Z"
            fill="#DDF2C8" opacity="0.45"/>
        </svg>

        {/* ② Top-left small blob — soft, mostly off-screen, 9% opacity */}
        <svg className="absolute -top-6 -left-6 pointer-events-none z-0"
          width="160" height="160" viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 10 C-10 20 -20 60 -8 90 C4 120 35 135 60 125 C85 115 95 88 88 62 C81 36 50 0 20 10 Z"
            fill="#EAF6D8" opacity="0.55"/>
        </svg>

        {/* ③ Bottom-left anchor blob */}
        <svg className="absolute -bottom-8 -left-8 pointer-events-none z-0"
          width="180" height="190" viewBox="0 0 180 190" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 180 C-10 145 -5 100 18 72 C41 44 80 35 105 52 C130 69 135 105 120 132 C105 159 68 175 10 180 Z"
            fill="#EAF6D8" opacity="0.45"/>
        </svg>

        {/* ④ Faint circular halo behind the bowl */}
        <svg className="absolute top-4 left-0 w-full pointer-events-none z-0"
          height="340" viewBox="0 0 390 340" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="160" cy="168" r="148" fill="#EAF6D8" opacity="0.07"/>
        </svg>

        {/* ⑤ Botanical leaf silhouettes — left side behind bowl */}
        <svg className="absolute top-10 -left-3 pointer-events-none z-0"
          width="88" height="210" viewBox="0 0 88 210" fill="none" xmlns="http://www.w3.org/2000/svg"
          style={{ opacity: 0.14 }}>
          {/* Leaf A – tall slender */}
          <path d="M22 200 C10 150 22 95 50 52 C36 90 24 148 22 200 Z" fill="#DDF2C8"/>
          <path d="M22 200 C34 150 50 98 50 52 C42 92 30 148 22 200 Z" fill="#B8DFA0" opacity="0.55"/>
          {/* Leaf B – wide arching */}
          <path d="M46 178 C26 135 34 82 68 48 C50 80 36 132 46 178 Z" fill="#DDF2C8"/>
          <path d="M46 178 C62 132 76 84 68 48 C64 82 52 132 46 178 Z" fill="#B8DFA0" opacity="0.45"/>
          {/* Leaf C – small top accent */}
          <path d="M8 115 C4 88 18 65 40 52 C26 68 10 90 8 115 Z" fill="#DDF2C8" opacity="0.65"/>
        </svg>

        {/* ⑥ Small floating leaf silhouettes — lower-right of bowl */}
        <svg className="absolute top-48 right-2 pointer-events-none z-0"
          width="70" height="100" viewBox="0 0 70 100" fill="none" xmlns="http://www.w3.org/2000/svg"
          style={{ opacity: 0.10 }}>
          <path d="M55 10 C70 30 65 62 48 78 C42 55 44 28 55 10 Z" fill="#DDF2C8"/>
          <path d="M55 10 C40 28 36 58 48 78 C46 55 48 30 55 10 Z" fill="#B8DFA0" opacity="0.5"/>
          <path d="M35 30 C48 45 46 68 34 80 C30 60 30 44 35 30 Z" fill="#DDF2C8" opacity="0.7"/>
        </svg>

        {/* ⑦ Thin organic curved arc following the bowl's circular form */}
        <svg className="absolute top-0 left-0 w-full pointer-events-none z-0"
          height="310" viewBox="0 0 390 310" fill="none" xmlns="http://www.w3.org/2000/svg"
          style={{ opacity: 0.07 }} preserveAspectRatio="none">
          <path d="M 10 280 C 70 180 170 100 290 130 C 340 145 370 168 390 190"
            stroke="#5A9A18" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
        </svg>

        {/* ⑧ Tiny accent dots — top-right cluster near blob */}
        <svg className="absolute top-0 right-0 pointer-events-none z-0"
          width="190" height="190" viewBox="0 0 190 190" fill="none" xmlns="http://www.w3.org/2000/svg"
          style={{ opacity: 0.30 }}>
          <circle cx="145" cy="20"  r="3.8" fill="#98CC58"/>
          <circle cx="160" cy="44"  r="2.4" fill="#B4DA7C"/>
          <circle cx="124" cy="35"  r="2.0" fill="#98CC58"/>
          <circle cx="170" cy="68"  r="1.6" fill="#B4DA7C"/>
          <circle cx="138" cy="55"  r="1.2" fill="#98CC58"/>
        </svg>

        {/* ⑨ Top-left dots — balance the top-right cluster */}
        <svg className="absolute top-4 left-4 pointer-events-none z-0"
          width="70" height="70" viewBox="0 0 70 70" fill="none" xmlns="http://www.w3.org/2000/svg"
          style={{ opacity: 0.22 }}>
          <circle cx="18" cy="12" r="3.0" fill="#98CC58"/>
          <circle cx="36" cy="6"  r="1.8" fill="#B4DA7C"/>
          <circle cx="8"  cy="28" r="1.4" fill="#98CC58"/>
        </svg>

        {/* ⑩ Sparkle stars — subtle 4-point crosses around the bowl */}
        <svg className="absolute top-0 left-0 w-full pointer-events-none z-0"
          height="320" viewBox="0 0 390 320" fill="none" xmlns="http://www.w3.org/2000/svg"
          style={{ opacity: 0.07 }}>
          {/* Star at top-right of bowl */}
          <path d="M310 55 L312 60 L317 62 L312 64 L310 69 L308 64 L303 62 L308 60 Z" fill="#6BAA20"/>
          {/* Star at left of bowl */}
          <path d="M42 148 L44 154 L50 156 L44 158 L42 164 L40 158 L34 156 L40 154 Z" fill="#6BAA20"/>
          {/* Star near bottom of bowl */}
          <path d="M220 290 L221.5 294 L226 295.5 L221.5 297 L220 301 L218.5 297 L214 295.5 L218.5 294 Z" fill="#6BAA20"/>
        </svg>

        {/* Dynamic Slide Content */}
        <div className="flex-1 flex flex-col relative z-10 w-full h-full">
          
          {/* Salad Bowl Image Container */}
          <div className="relative w-full mt-16 mx-auto overflow-visible shrink-0 pointer-events-none flex justify-center">
            <motion.img
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              src={onboardingBurger}
              alt="Onboarding Delicious Burger"
              className="w-[98%] h-full object-contain drop-shadow-[0_16px_32px_rgba(0,0,0,0.06)] dark:drop-shadow-[0_16px_32px_rgba(0,0,0,0.4)]"
            />
          </div>

          {/* Text + Controls — starts directly below image, button pinned to bottom */}
          <div className="px-8 pt-5 pb-8 sm:pb-10 flex flex-col items-start w-full flex-1">

            {/* Brand Name */}
            <div className="flex items-center mb-4">
              <span className="text-4xl sm:text-5xl font-black text-gray-900 dark:text-white tracking-tight">
                Eatiefy
              </span>
            </div>

            {/* Headlines */}
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white text-left leading-[1.25] tracking-tight mb-3">
              Satisfy Your <br />
              <span style={{ color: "var(--module-theme-color, #659116)" }}>
                Cravings
              </span>
            </h1>

            <p className="text-sm sm:text-base text-gray-500 dark:text-gray-400 text-left leading-relaxed max-w-[300px]">
              Delicious meals, hot burgers, and street foods delivered fresh to your doorstep.
            </p>

            {/* Spacer — pushes button to bottom */}
            <div className="flex-1" />

            {/* Action Buttons — pinned to bottom */}
            <div className="w-full">
              <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={handleGetStarted}
                className="w-full text-white font-bold py-3.5 px-6 rounded-2xl flex items-center justify-center transition-opacity text-base shadow-sm hover:opacity-90"
                style={{ backgroundColor: "var(--module-theme-color, #659116)" }}
              >
                <span>Get Started</span>
              </motion.button>

              {/* Sign In Row */}
              <div className="text-center mt-4 w-full">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Already have an account?{" "}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem('eatiefy_onboarding_completed', 'true');
                    onSignInClick();
                  }}
                  className="text-xs font-bold hover:opacity-85 transition-opacity"
                  style={{ color: "var(--module-theme-color, #659116)" }}
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

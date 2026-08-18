import React from 'react';
import { motion } from 'framer-motion';
import EatiefyScreen from '../../assets/EatiefyScreen.webp';

export default function OnboardingSplash({ onComplete, onSignInClick }) {
  const handleGetStarted = () => {
    localStorage.setItem('eatiefy_onboarding_completed', 'true');
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-[#024a1b] font-sans select-none flex justify-center">
      
      {/* Main Content Container */}
      <div className="relative w-full h-full max-w-md flex flex-col justify-end overflow-hidden shadow-2xl">
        
        {/* Full Screen Background Image */}
        <motion.img
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          src={EatiefyScreen}
          alt="Eatiefy Splash"
          className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none"
        />

        {/* Subtle dark gradient at the bottom to ensure button visibility */}
        <div className="absolute bottom-0 left-0 w-full h-[35%] bg-gradient-to-t from-black/60 via-black/20 to-transparent pointer-events-none" />

        {/* Action Buttons — Pinned to the bottom */}
        <div className="relative z-20 w-full px-6 pb-12 sm:pb-16 flex flex-col items-center">
          
          <motion.button
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.5, ease: "easeOut" }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleGetStarted}
            className="w-full max-w-[320px] text-green-950 font-black py-4 px-6 rounded-full flex items-center justify-center transition-all shadow-[0_8px_20px_rgba(0,0,0,0.3)] hover:shadow-[0_8px_25px_rgba(202,238,59,0.4)]"
            style={{ backgroundColor: "#caee3b" }}
          >
            <span className="text-[17px] tracking-wide uppercase">Get Started</span>
          </motion.button>

          {/* Sign In Row */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className="text-center mt-6 w-full"
          >
            <span className="text-sm font-medium text-white/80 drop-shadow-md">
              Already have an account?{" "}
            </span>
            <button
              type="button"
              onClick={() => {
                localStorage.setItem('eatiefy_onboarding_completed', 'true');
                onSignInClick();
              }}
              className="text-sm font-bold tracking-wide hover:opacity-80 transition-opacity drop-shadow-md underline decoration-2 underline-offset-4"
              style={{ color: "#caee3b" }}
            >
              Sign In
            </button>
          </motion.div>
          
        </div>
      </div>
    </div>
  );
}

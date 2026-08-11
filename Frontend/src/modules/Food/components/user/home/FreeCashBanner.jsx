import React from 'react';
import { motion } from 'framer-motion';

export default function FreeCashBanner({ amount = 20, minOrderValue = 99 }) {
  return (
    <div 
      className="overflow-hidden"
      style={{
        width: '100vw',
        position: 'relative',
        left: '50%',
        right: '50%',
        marginLeft: '-50vw',
        marginRight: '-50vw',
      }}
    >
      <div 
        className="w-full relative bg-gradient-to-r from-[#7a31f0] to-[#9246f6] flex items-stretch overflow-hidden"
        style={{
          minHeight: '220px',
          maskImage: `
            radial-gradient(circle at 16px 16px, black 15.5px, transparent 16px),
            radial-gradient(circle at 16px 16px, black 15.5px, transparent 16px),
            linear-gradient(black, black)
          `,
          maskSize: '32px 32px, 32px 32px, 100% calc(100% - 32px)',
          maskPosition: 'top left, bottom left, 0 16px',
          maskRepeat: 'repeat-x, repeat-x, no-repeat',
          WebkitMaskImage: `
            radial-gradient(circle at 16px 16px, black 15.5px, transparent 16px),
            radial-gradient(circle at 16px 16px, black 15.5px, transparent 16px),
            linear-gradient(black, black)
          `,
          WebkitMaskSize: '32px 32px, 32px 32px, 100% calc(100% - 32px)',
          WebkitMaskPosition: 'top left, bottom left, 0 16px',
          WebkitMaskRepeat: 'repeat-x, repeat-x, no-repeat',
        }}
      >
        
        {/* Abstract Floating Shapes (Exact Replicas) */}
        <div className="absolute inset-0 pointer-events-none">
          
          {/* Subtle light flares */}
          <div className="absolute top-[20%] left-[45%] w-3 h-3 bg-white/90 rounded-full blur-[2px]" />
          <div className="absolute top-[35%] right-[25%] w-2 h-2 bg-white/80 rounded-full blur-[1px]" />
          <div className="absolute bottom-[20%] right-[10%] w-2.5 h-2.5 bg-white/90 rounded-full blur-[1.5px]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-white/10 blur-[50px] rounded-full mix-blend-overlay" />

          {/* Pink Worm (Top Right) */}
          <svg className="absolute -top-2 right-[25%] w-20 h-32 z-0 opacity-100" viewBox="0 0 100 150">
            <path d="M 20 -10 C 20 40, 80 30, 80 75 C 80 120, 20 120, 20 160" fill="none" stroke="#ff3070" strokeWidth="18" strokeLinecap="round" />
            <circle cx="28" cy="20" r="5" fill="white" />
            <circle cx="26" cy="20" r="2.5" fill="black" />
            <circle cx="20" cy="50" r="5" fill="white" />
            <circle cx="18" cy="50" r="2.5" fill="black" />
          </svg>

          {/* Orange Splat (Bottom Center-Right) */}
          <svg className="absolute -bottom-8 right-[38%] w-36 h-36 z-0" viewBox="0 0 100 100">
            <polygon points="50,10 62,35 95,35 70,55 80,90 50,70 20,90 30,55 5,35 38,35" fill="#ff7300" />
            <circle cx="43" cy="58" r="5.5" fill="white" />
            <circle cx="45" cy="58" r="2.5" fill="black" />
            <circle cx="58" cy="58" r="5.5" fill="white" />
            <circle cx="60" cy="58" r="2.5" fill="black" />
            <path d="M 48 70 Q 51 74 54 70" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>

          {/* Yellow Blob (Bottom Right) */}
          <svg className="absolute -bottom-6 -right-2 w-28 h-28 z-0" viewBox="0 0 100 100">
            <path d="M 10 100 C 10 30, 90 30, 90 100 Z" fill="#ffcc00" />
            <circle cx="45" cy="65" r="5" fill="white" />
            <circle cx="43" cy="65" r="2" fill="black" />
            <circle cx="65" cy="55" r="5" fill="white" />
            <circle cx="63" cy="55" r="2" fill="black" />
            <path d="M 42 80 Q 50 85 55 75" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>

        <div className="relative z-10 w-full flex flex-row items-center justify-between px-6 sm:px-10 py-10">
          
          {/* Left Text */}
          <div className="flex flex-col justify-center max-w-[55%]">
            <h2 
              className="text-white font-extrabold leading-[1.15] mb-2 drop-shadow-md whitespace-nowrap"
              style={{ fontSize: 'clamp(24px, 5vw, 42px)' }}
            >
              Hurry, {amount} Free Cash<br/>expiring soon!
            </h2>
            <p className="text-white/95 font-medium tracking-wide" style={{ fontSize: 'clamp(12px, 2.5vw, 18px)' }}>
              Valid on food orders above ₹{minOrderValue}
            </p>
          </div>

          {/* Right Floating Card */}
          <div className="flex-shrink-0 flex items-center justify-center -mr-2 sm:mr-6">
            <motion.div 
              whileHover={{ scale: 1.05 }}
              initial={{ rotate: -6 }}
              className="relative px-5 py-4 sm:px-8 sm:py-6 rounded-[20px] sm:rounded-[28px] overflow-hidden shadow-[0_8px_30px_rgba(255,20,118,0.5)] border border-white/40"
              style={{
                background: 'linear-gradient(135deg, rgba(255,100,165,0.95), rgba(255,20,118,0.95))',
                backdropFilter: 'blur(10px)',
                minWidth: 'clamp(140px, 25vw, 200px)'
              }}
            >
              <div className="text-white font-bold tracking-widest uppercase text-center mb-1 drop-shadow-sm opacity-95" style={{ fontSize: 'clamp(9px, 1.5vw, 12px)' }}>
                CASH AVAILABLE
              </div>
              <div className="text-white font-black text-center flex items-center justify-center leading-none drop-shadow-lg" style={{ fontSize: 'clamp(36px, 6vw, 56px)' }}>
                <span className="text-[24px] sm:text-[32px] -mt-1 sm:-mt-2 mr-1">₹</span>{amount}
              </div>
            </motion.div>
          </div>
          
        </div>
      </div>
    </div>
  );
}

import { useParams, Link, useSearchParams, useNavigate, useLocation } from "react-router-dom"
import React, { useState, useEffect, useMemo, useRef, useCallback, memo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { toast } from "sonner"
import {
  ArrowLeft,
  Share2,
  Star,
  RefreshCw,
  Phone,
  User,
  ChevronRight,
  MapPin,
  Home as HomeIcon,
  MessageSquare,
  X,
  Check,
  Shield,
  Receipt,
  CircleSlash,
  Loader2,
  Clock,
  Calendar,
  ShoppingBag,
  Users,
  Navigation
} from "lucide-react"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { Card, CardContent } from "@food/components/ui/card"
import { Button } from "@food/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
import { Textarea } from "@food/components/ui/textarea"
import { useOrders } from "@food/context/OrdersContext"
import { useProfile } from "@food/context/ProfileContext"
import { useLocation as useUserLocation } from "@food/hooks/useLocation"
import DeliveryTrackingMap from "@food/components/user/DeliveryTrackingMap"
import { orderAPI, restaurantAPI } from "@food/api"
import { useCompanyName } from "@food/hooks/useCompanyName"
import { RESTAURANT_PIN_SVG, CUSTOMER_PIN_SVG, RIDER_BIKE_SVG } from "@food/constants/mapIcons"
import burgerImg from "@food/assets/takeaway_burger.png"


// Fallback definitions in case imports fail at runtime or are shadowed
const DEFAULT_CUSTOMER_PIN = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#10B981"><path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/><circle cx="12" cy="9" r="3" fill="#FFFFFF"/></svg>`;
const SAFE_CUSTOMER_PIN = typeof CUSTOMER_PIN_SVG !== 'undefined' ? CUSTOMER_PIN_SVG : DEFAULT_CUSTOMER_PIN;
const DEFAULT_RESTAURANT_PIN = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="#FF6B35"><path d="M12 2C8.13 2 5 5.13 5 9c0 4.17 4.42 9.92 6.24 12.11.4.48 1.08.48 1.52 0C14.58 18.92 19 13.17 19 9c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5 14.5 7.62 14.5 9 13.38 11.5 12 11.5z"/><circle cx="12" cy="9" r="3" fill="#FFFFFF"/></svg>`;
const SAFE_RESTAURANT_PIN = typeof RESTAURANT_PIN_SVG !== 'undefined' ? RESTAURANT_PIN_SVG : DEFAULT_RESTAURANT_PIN;

const debugLog = (...args) => console.log('[OrderTracking]', ...args)
const debugWarn = (...args) => console.warn('[OrderTracking]', ...args)
const debugError = (...args) => console.error('[OrderTracking]', ...args)


// Animated checkmark component
const AnimatedCheckmark = ({ delay = 0 }) => (
  <motion.svg
    width="80"
    height="80"
    viewBox="0 0 80 80"
    initial="hidden"
    animate="visible"
    className="mx-auto"
  >
    <motion.circle
      cx="40"
      cy="40"
      r="36"
      fill="none"
      stroke="#22c55e"
      strokeWidth="4"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
    />
    <motion.path
      d="M24 40 L35 51 L56 30"
      fill="none"
      stroke="#22c55e"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: 0.4, delay: delay + 0.4, ease: "easeOut" }}
    />
  </motion.svg>
)

// Premium Takeaway Animation Component for Self-Pickup
// Premium Takeaway Animation Component for Self-Pickup
const TakeawayAnimation = memo(({ order }) => {
  const [transparentBurger, setTransparentBurger] = useState(null);
  const uiStatus = mapOrderToTrackingUiStatus(order);
  const isReady = uiStatus === 'ready';

  useEffect(() => {
    if (!burgerImg) return;
    const img = new Image();
    img.src = burgerImg;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];
        const minVal = Math.min(r, g, b);
        if (minVal > 238) {
          data[i+3] = 0;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      setTransparentBurger(canvas.toDataURL());
    };
    img.onerror = () => {
      setTransparentBurger(burgerImg);
    };
  }, []);

  return (
    <div className="relative w-full h-[240px] bg-gradient-to-br from-[#F59E0B] via-[#FBBF24] to-[#D97706] dark:from-[#78350F] dark:via-[#92400E] dark:to-[#451A03] border-b border-amber-500/20 flex flex-col items-center justify-center overflow-hidden">
      {/* Grid Overlay */}
      <div className="absolute inset-0 opacity-15 select-none pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.4) 1px, transparent 1px)', backgroundSize: '16px 16px' }} />

      {/* Radial Glows */}
      <div className="absolute top-1/4 left-1/4 w-60 h-60 rounded-full bg-white/20 dark:bg-yellow-400/5 blur-3xl animate-pulse select-none pointer-events-none" style={{ animationDuration: '4s' }} />
      <div className="absolute bottom-1/4 right-1/4 w-72 h-72 rounded-full bg-orange-400/10 dark:bg-orange-500/5 blur-3xl animate-pulse select-none pointer-events-none" style={{ animationDuration: '6s', animationDelay: '1s' }} />
      
      {/* Drifting Bokeh Circles */}
      <div className="absolute w-2 h-2 rounded-full bg-white/30 blur-[1px] animate-float-bokeh-1 select-none pointer-events-none" />
      <div className="absolute w-3 h-3 rounded-full bg-amber-300/40 blur-[2px] animate-float-bokeh-2 select-none pointer-events-none" />
      <div className="absolute w-1.5 h-1.5 rounded-full bg-orange-300/30 blur-[1px] animate-float-bokeh-3 select-none pointer-events-none" />
      <div className="absolute w-2.5 h-2.5 rounded-full bg-yellow-200/40 blur-[1.5px] animate-float-bokeh-4 select-none pointer-events-none" />

      {/* Top Typography section in Ometto-Takeaway-Self-Pickup theme */}
      <div className="text-center px-4 mt-1.5 select-none pointer-events-none flex flex-col items-center z-10">
        <h3 className="text-[#7C2D12] dark:text-[#FEF3C7] font-black text-[13px] sm:text-base tracking-widest mb-0.5 select-none uppercase drop-shadow-[0_1px_2px_rgba(255,255,255,0.3)] dark:drop-shadow-md">
          ORDER, EAT, ENJOY!
        </h3>
        <p className="text-[#9A3412] dark:text-[#FCD34D] font-bold text-[11px] sm:text-[13px] select-none italic tracking-wide opacity-95">
          With Takeaway Self PickUp
        </p>
      </div>

      {/* Spatial Canvas Container */}
      <div className="relative w-[300px] h-[120px] mt-1 z-10 flex items-center justify-between">
        
        {/* SVG Bezier curve trajectory line */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none select-none" style={{ zIndex: 5 }}>
          {/* Dotted path */}
          <path 
            d="M 47,60 Q 152,-15 257,74" 
            fill="none" 
            className="stroke-[#9A3412]/30 dark:stroke-[#FCD34D]/25"
            strokeWidth="2.5" 
            strokeLinecap="round"
            strokeDasharray="6,6" 
          />
          {/* Pulsing glow line */}
          <path 
            d="M 47,60 Q 152,-15 257,74" 
            fill="none" 
            stroke="url(#takeaway-path-grad)" 
            strokeWidth="3" 
            strokeLinecap="round"
            strokeDasharray="30,240"
            className="animate-route-pulse"
          />
          <defs>
            <linearGradient id="takeaway-path-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#EA580C" stopOpacity="0" className="dark:stop-color-[#F59E0B]" />
              <stop offset="50%" stopColor="#EA580C" stopOpacity="1" className="dark:stop-color-[#F59E0B]" />
              <stop offset="100%" stopColor="#EA580C" stopOpacity="0" className="dark:stop-color-[#F59E0B]" />
            </linearGradient>
          </defs>
        </svg>

        {/* Android Phone Frame Mockup (Left) */}
        <div className="absolute left-[15px] bottom-[5px] w-[64px] h-[110px] bg-slate-950 rounded-[15px] border-[2.5px] border-slate-800 shadow-[0_8px_20px_-5px_rgba(0,0,0,0.3),0_0_12px_rgba(217,119,6,0.2)] flex flex-col items-center justify-between p-1 overflow-hidden animate-phone-float z-10">
          {/* Speaker Notch */}
          <div className="w-7 h-1.5 bg-slate-800 rounded-b-md absolute top-0 left-1/2 -translate-x-1/2 z-20 flex items-center justify-center">
            <div className="w-3.5 h-[0.5px] bg-slate-700 rounded-full" />
          </div>
          
          {/* Internal screen */}
          <div className="relative w-full h-full rounded-[10px] bg-gradient-to-b from-[#451A03] to-[#090514] flex flex-col items-center justify-center overflow-hidden pt-2.5">
            {/* Screen grid pattern */}
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle, #fff 0.5px, transparent 0.5px)', backgroundSize: '6px 6px' }} />
            
            {/* Glow circle */}
            <div className="absolute w-10 h-10 rounded-full bg-green-500/15 blur-xl animate-pulse" />
            
            <div className="relative z-10 flex flex-col items-center justify-center scale-90">
              {/* Confirmed Animation Details badge */}
              <div className="relative w-8 h-8 rounded-full bg-emerald-500/25 border border-emerald-400/40 flex items-center justify-center text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)] animate-pulse">
                <Check className="w-4.5 h-4.5 stroke-[2.5]" />
                
                {/* Ripple */}
                <div className="absolute inset-0 rounded-full border border-emerald-400/50 animate-ping opacity-60" style={{ animationDuration: '1.8s' }} />
              </div>
              
              <span className="text-[6.5px] text-emerald-400 font-extrabold uppercase tracking-widest mt-1 select-none animate-pulse">
                {isReady ? "Ready" : "Booked"}
              </span>
              <span className="text-[4.5px] text-slate-400 font-medium tracking-normal mt-0.5 select-none uppercase">
                {isReady ? "For PickUp" : "Self PickUp"}
              </span>
            </div>
          </div>
        </div>

        {/* Takeaway Cart/Bag Container (Right) */}
        <div className="absolute right-[15px] bottom-[10px] w-[56px] h-[56px] flex flex-col items-center justify-center z-10">
          {/* Base shadow */}
          <div className="absolute bottom-[-2px] w-10 h-1 bg-black/35 blur-[2px] rounded-full scale-x-95 animate-shadow-shrink" />
          
          {/* Bag with squash/stretch */}
          <div className="relative w-12 h-12 flex items-center justify-center animate-bag-receive">
            <svg className="w-10 h-10 text-[#9A3412] dark:text-[#FCD34D] fill-[#9A3412]/10 dark:fill-[#FCD34D]/10 drop-shadow-lg filter drop-shadow-[0_3px_8px_rgba(217,119,6,0.25)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007z" />
            </svg>
            
            {/* Sparkles particles shooting out on burger arrival */}
            <div className="absolute inset-0 w-full h-full pointer-events-none overflow-visible z-20">
              <span className="absolute top-1 left-2.5 w-1.5 h-1.5 rounded-full bg-yellow-400 animate-sparkle-1" />
              <span className="absolute top-1 right-2.5 w-2 h-2 bg-white rotate-45 animate-sparkle-2" />
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-yellow-500 rotate-12 animate-sparkle-3" />
              <span className="absolute bottom-3 right-1 w-1.5 h-1.5 rounded-full bg-white animate-sparkle-4" />
            </div>
          </div>
        </div>

        {/* Flying Burger Item */}
        <img 
          src={transparentBurger || burgerImg} 
          className="absolute left-[27px] top-[40px] w-10 h-10 object-contain pointer-events-none animate-burger-pack z-20 drop-shadow-[0_6px_12px_rgba(0,0,0,0.3)]" 
          alt="Burger"
        />

      </div>

      {/* Ready for pickup banner — only shown when restaurant marks ready */}
      {isReady && (
        <div className="w-full flex justify-center mt-4 z-10 select-none pointer-events-none">
          <p className="text-[#047857] dark:text-[#34D399] font-black text-[12px] sm:text-[13px] tracking-widest animate-bounce drop-shadow-sm">
            🎉 READY FOR PICK UP!
          </p>
        </div>
      )}

      {/* Embedded CSS Animations */}
      <style>{`
        @keyframes float-bokeh-1 {
          0%, 100% { transform: translate(40px, 90px) translateY(0) scale(1); opacity: 0.3; }
          50% { transform: translate(60px, 45px) translateY(-10px) scale(1.2); opacity: 0.6; }
        }
        @keyframes float-bokeh-2 {
          0%, 100% { transform: translate(220px, 60px) translateY(0) scale(1.2); opacity: 0.2; }
          50% { transform: translate(200px, 100px) translateY(-15px) scale(0.8); opacity: 0.5; }
        }
        @keyframes float-bokeh-3 {
          0%, 100% { transform: translate(140px, 120px) translateY(0); opacity: 0.4; }
          50% { transform: translate(160px, 75px) translateY(-8px); opacity: 0.7; }
        }
        @keyframes float-bokeh-4 {
          0%, 100% { transform: translate(280px, 35px) translateY(0); opacity: 0.3; }
          50% { transform: translate(260px, 75px) translateY(-20px); opacity: 0.6; }
        }
        @keyframes route-pulse {
          0% { stroke-dashoffset: 270; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes phone-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes burger-pack {
          0% {
            transform: translate(0, 0) scale(0.1) rotate(0deg);
            opacity: 0;
          }
          10% {
            transform: translate(0, -25px) scale(1.1) rotate(0deg);
            opacity: 1;
          }
          30% {
            transform: translate(0, -30px) scale(1.0) rotate(5deg);
            opacity: 1;
          }
          52% {
            transform: translate(105px, -65px) scale(1.0) rotate(90deg);
            opacity: 1;
          }
          68% {
            transform: translate(188px, -10px) scale(0.7) rotate(165deg);
            opacity: 0.95;
          }
          74% {
            transform: translate(210px, 14px) scale(0.2) rotate(180deg);
            opacity: 0;
          }
          100% {
            transform: translate(0, 0) scale(0.1) rotate(0deg);
            opacity: 0;
          }
        }
        @keyframes bag-receive {
          0%, 60%, 100% {
            transform: scale(1) rotate(0deg);
          }
          68% {
            transform: scale(1.25, 0.75);
          }
          75% {
            transform: scale(0.85, 1.25) translateY(-10px) rotate(-3deg);
          }
          85% {
            transform: scale(1.08, 0.92) rotate(2deg);
          }
          92% {
            transform: scale(1) rotate(0deg);
          }
        }
        @keyframes shadow-shrink {
          0%, 60%, 100% { transform: scaleX(0.95); opacity: 0.45; }
          68% { transform: scaleX(1.2); opacity: 0.55; }
          75% { transform: scaleX(0.7); opacity: 0.2; }
          85% { transform: scaleX(1.05); opacity: 0.48; }
          92% { transform: scaleX(0.95); opacity: 0.45; }
        }
        @keyframes sparkle-1 {
          0%, 73%, 86%, 100% { transform: translate(0, 0) scale(0); opacity: 0; }
          75% { transform: translate(-15px, -15px) scale(1); opacity: 1; }
          84% { transform: translate(-30px, -25px) scale(0.3); opacity: 0; }
        }
        @keyframes sparkle-2 {
          0%, 73%, 86%, 100% { transform: translate(0, 0) scale(0); opacity: 0; }
          75% { transform: translate(15px, -18px) scale(1.2); opacity: 1; }
          84% { transform: translate(30px, -30px) scale(0.3); opacity: 0; }
        }
        @keyframes sparkle-3 {
          0%, 73%, 86%, 100% { transform: translate(0, 0) scale(0); opacity: 0; }
          76% { transform: translate(-4px, -24px) scale(1); opacity: 1; }
          85% { transform: translate(-8px, -38px) scale(0.3); opacity: 0; }
        }
        @keyframes sparkle-4 {
          0%, 73%, 86%, 100% { transform: translate(0, 0) scale(0); opacity: 0; }
          76% { transform: translate(12px, -8px) scale(1); opacity: 1; }
          85% { transform: translate(22px, -12px) scale(0.3); opacity: 0; }
        }
        
        .animate-float-bokeh-1 { animation: float-bokeh-1 8s infinite ease-in-out; }
        .animate-float-bokeh-2 { animation: float-bokeh-2 10s infinite ease-in-out; }
        .animate-float-bokeh-3 { animation: float-bokeh-3 9s infinite ease-in-out; }
        .animate-float-bokeh-4 { animation: float-bokeh-4 11s infinite ease-in-out; }
        
        .animate-route-pulse { animation: route-pulse 3.5s infinite linear; }
        .animate-phone-float { animation: phone-float 4s infinite ease-in-out; }
        
        .animate-burger-pack {
          animation: burger-pack 3.5s infinite ease-in-out;
        }
        .animate-bag-receive {
          animation: bag-receive 3.5s infinite ease-in-out;
          transform-origin: bottom center;
        }
        .animate-shadow-shrink {
          animation: shadow-shrink 3.5s infinite ease-in-out;
          transform-origin: center center;
        }
        .animate-sparkle-1 { animation: sparkle-1 3.5s infinite ease-out; }
        .animate-sparkle-2 { animation: sparkle-2 3.5s infinite ease-out; }
        .animate-sparkle-3 { animation: sparkle-3 3.5s infinite ease-out; }
        .animate-sparkle-4 { animation: sparkle-4 3.5s infinite ease-out; }
      `}</style>
    </div>
  );
});

// Premium Dining Animation Component for Table Service
const DiningAnimation = memo(({ order }) => {
  return (
    <div className="relative w-full h-[300px] bg-gradient-to-br from-[#FFF5F5] to-[#FFE3E3] dark:from-[#170a0c] dark:to-[#261216] border-b border-gray-100 dark:border-gray-900/50 flex flex-col items-center justify-center overflow-hidden">
      {/* Glow effect */}
      <div className="absolute w-[200px] h-[200px] rounded-full bg-red-500/10 dark:bg-red-500/5 blur-3xl animate-pulse" />
      
      {/* Spatial Canvas */}
      <div className="relative flex items-center justify-center w-64 h-40">
        
        {/* Radar Rings */}
        <div className="absolute inset-0 rounded-full border-2 border-red-500/5 animate-ping" style={{ animationDuration: '4s' }} />
        <div className="absolute inset-8 rounded-full border border-red-500/10 animate-pulse" />
        
        {/* Rising Steam Lines */}
        <div className="absolute -top-6 left-[48%] flex gap-1.5 opacity-80 z-10">
          <span className="w-1 h-5 bg-red-400/30 dark:bg-red-400/20 rounded-full animate-steam" style={{ animationDelay: '0.2s' }} />
          <span className="w-1 h-7 bg-red-400/40 dark:bg-red-400/30 rounded-full animate-steam" style={{ animationDelay: '0.5s' }} />
          <span className="w-1 h-4 bg-red-400/30 dark:bg-red-400/20 rounded-full animate-steam" style={{ animationDelay: '0.8s' }} />
        </div>

        {/* Fork, Plate/Cloche, Knife Table Setting */}
        <div className="flex items-center gap-6 z-10">
          {/* Fork */}
          <div className="animate-fork-bounce">
            <svg className="w-6 h-12 text-red-500/70 dark:text-red-400/50" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 3v7a6 6 0 006 6v5m0-18v18m4-18v7a6 6 0 01-6 6" />
            </svg>
          </div>

          {/* Plate and Cloche Serving Dome */}
          <div className="relative flex flex-col items-center">
            {/* Cloche Dome */}
            <div className="animate-cloche-float mb-0.5">
              <svg className="w-20 h-16 text-[#DC2626] dark:text-[#E11D48] fill-red-500/10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2M4 19h16M12 5a8 8 0 00-8 8h16a8 8 0 00-8-8zM12 5c-1 0-2 1-2 2h4c0-1-1-2-2-2z" />
              </svg>
            </div>
            
            {/* Plate Base */}
            <div className="w-24 h-2 bg-gradient-to-r from-red-400 to-[#B80B3D] dark:from-red-900 dark:to-rose-950 rounded-full shadow-md shadow-red-500/20" />
          </div>

          {/* Knife */}
          <div className="animate-knife-bounce">
            <svg className="w-6 h-12 text-red-500/70 dark:text-red-400/50" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 3v18M18 3c-3 0-6 3-6 7v6h6V3z" />
            </svg>
          </div>
        </div>

      </div>

      {/* Text Indicators */}
      <div className="text-center px-4 mt-2 select-none pointer-events-none">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100/80 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-[10px] font-black uppercase tracking-wider mb-2">
          Dining - Table Service
        </span>
        <h4 className="text-base font-bold text-gray-900 dark:text-gray-100 leading-tight">
          Food will be served at your table
        </h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-xs leading-normal">
          Sit back and relax. Our server will bring your fresh hot meal directly to you shortly.
        </p>
      </div>

      {/* Embedded CSS Animations */}
      <style>{`
        @keyframes steam {
          0% { transform: translateY(0) scaleX(1); opacity: 0; }
          15% { opacity: 0.6; }
          50% { transform: translateY(-12px) scaleX(1.2); opacity: 0.3; }
          100% { transform: translateY(-24px) scaleX(0.8); opacity: 0; }
        }
        @keyframes cloche-float {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(2deg); }
        }
        @keyframes item-bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        .animate-steam {
          animation: steam 2s infinite ease-out;
        }
        .animate-cloche-float {
          animation: cloche-float 3s infinite ease-in-out;
        }
        .animate-fork-bounce {
          animation: item-bounce 3s infinite ease-in-out;
          animation-delay: 0.2s;
        }
        .animate-knife-bounce {
          animation: item-bounce 3s infinite ease-in-out;
          animation-delay: 0.4s;
        }
      `}</style>
    </div>
  );
});

// Real Delivery Map Component with User Live Location
const DeliveryMap = memo(({ orderId, order, isVisible, fallbackCustomerCoords = null, userLiveCoords = null, userLocationAccuracy = null, onEtaUpdate = null }) => {
  const toPointFromGeoJSON = (coords) => {
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  };

  // Memoize coordinates to prevent re-calculating on every parent render
  const restaurantCoords = useMemo(() => {
    // Try multiple sources for restaurant coordinates
    let coords = null;

    if (order?.restaurantLocation?.coordinates &&
      Array.isArray(order.restaurantLocation.coordinates) &&
      order.restaurantLocation.coordinates.length >= 2) {
      coords = order.restaurantLocation.coordinates;
    }
    else if (order?.restaurantId?.location?.coordinates &&
      Array.isArray(order.restaurantId.location.coordinates) &&
      order.restaurantId.location.coordinates.length >= 2) {
      coords = order.restaurantId.location.coordinates;
    }
    else if (order?.restaurantId?.location?.latitude && order?.restaurantId?.location?.longitude) {
      coords = [order.restaurantId.location.longitude, order.restaurantId.location.latitude];
    }

    const fromCoords = toPointFromGeoJSON(coords);
    if (fromCoords) return fromCoords;

    const fallbackLat = Number(order?.restaurantId?.location?.latitude || order?.restaurant?.location?.latitude);
    const fallbackLng = Number(order?.restaurantId?.location?.longitude || order?.restaurant?.location?.longitude);
    if (Number.isFinite(fallbackLat) && Number.isFinite(fallbackLng)) {
      return { lat: fallbackLat, lng: fallbackLng };
    }
    return null;
  }, [order?.restaurantId, order?.restaurantLocation, order?.restaurant]);

  const customerCoords = useMemo(() => {
    const coords = order?.address?.coordinates || order?.address?.location?.coordinates;
    const fromCoords = toPointFromGeoJSON(coords);
    if (fromCoords) return fromCoords;

    if (
      fallbackCustomerCoords &&
      Number.isFinite(fallbackCustomerCoords.lat) &&
      Number.isFinite(fallbackCustomerCoords.lng)
    ) {
      return fallbackCustomerCoords;
    }
    return null;
  }, [order?.address, fallbackCustomerCoords]);

  // Delivery boy data
  const deliveryBoyData = useMemo(() => order?.deliveryPartner ? {
    name: order.deliveryPartner.name || 'Delivery Partner',
    avatar: order.deliveryPartner.avatar || null
  } : null, [order?.deliveryPartner]);

  const effectiveCustomerCoords = useMemo(() => {
    if (order?.orderType === 'takeaway' && userLiveCoords && Number.isFinite(userLiveCoords.lat) && Number.isFinite(userLiveCoords.lng)) {
      return userLiveCoords;
    }
    if (customerCoords) return customerCoords;
    if (userLiveCoords && Number.isFinite(userLiveCoords.lat) && Number.isFinite(userLiveCoords.lng)) {
      return userLiveCoords;
    }
    if (restaurantCoords) return restaurantCoords;
    return null;
  }, [order?.orderType, customerCoords, userLiveCoords, restaurantCoords]);

  const effectiveRestaurantCoords = useMemo(() => {
    if (restaurantCoords) return restaurantCoords;
    if (effectiveCustomerCoords) return effectiveCustomerCoords;
    return null;
  }, [restaurantCoords, effectiveCustomerCoords]);

  // Firebase and backend write tracking under order.orderId (string) or mongoId; subscribe to all so we receive updates
  const orderTrackingIdsList = useMemo(() => [
    order?.orderId,
    order?.mongoId,
    order?._id,
    orderId,
    order?.id
  ].filter(Boolean), [order?.orderId, order?.mongoId, order?._id, orderId, order?.id]);

  if (!isVisible || !orderId || !order || !effectiveRestaurantCoords || !effectiveCustomerCoords) {
    return (
      <div
        className="relative h-[300px] sm:h-[450px] bg-gradient-to-b from-gray-100 to-gray-200 dark:from-[#0a0a0a] dark:to-[#1a1a1a]"
      />
    );
  }

  return (
    <div
      className="relative w-full h-[300px] sm:h-[450px] overflow-visible"
    >
      <DeliveryTrackingMap
        orderId={orderId}
        orderTrackingIds={orderTrackingIdsList}
        restaurantCoords={effectiveRestaurantCoords}
        customerCoords={effectiveCustomerCoords}

        userLiveCoords={userLiveCoords}
        userLocationAccuracy={userLocationAccuracy}
        deliveryBoyData={deliveryBoyData}
        order={order}
        onEtaUpdate={onEtaUpdate}
      />
    </div>
  );
});

// Section item component
const SectionItem = ({ icon: Icon, iconNode, title, subtitle, onClick, showArrow = true, rightContent }) => (
  <motion.button
    onClick={onClick}
    className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-left border-b border-dashed border-gray-200 dark:border-gray-800 last:border-0"
    whileTap={{ scale: 0.99 }}
  >
    <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0 overflow-hidden">
      {iconNode ? (
        <div
          className="w-6 h-6 flex-shrink-0 flex items-center justify-center [&_svg]:w-full [&_svg]:h-full [&_svg]:block"
        >
          {iconNode}
        </div>
      ) : (
        <Icon className="w-5 h-5 text-gray-600 dark:text-gray-400 flex-shrink-0" />
      )}
    </div>
    <div className="flex-1 min-w-0">
      <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{title}</p>
      {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{subtitle}</p>}
    </div>
    {rightContent || (showArrow && <ChevronRight className="w-5 h-5 text-gray-400 dark:text-gray-500 flex-shrink-0" />)}
  </motion.button>
)

class MapErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    debugError('OrderTracking map render failed:', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="relative h-[300px] sm:h-[450px] bg-gray-100 dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 flex items-center justify-center">
          <p className="text-sm text-gray-600 dark:text-gray-400 px-4 text-center">Live map unavailable right now</p>
        </div>
      )
    }
    return this.props.children
  }
}

const getRestaurantCoordsFromOrder = (apiOrder, fallback = null) => {
  if (
    apiOrder?.restaurantId?.location?.coordinates &&
    Array.isArray(apiOrder.restaurantId.location.coordinates) &&
    apiOrder.restaurantId.location.coordinates.length >= 2
  ) {
    return apiOrder.restaurantId.location.coordinates
  }
  if (apiOrder?.restaurantId?.location?.latitude && apiOrder?.restaurantId?.location?.longitude) {
    return [apiOrder.restaurantId.location.longitude, apiOrder.restaurantId.location.latitude]
  }
  if (
    apiOrder?.restaurant?.location?.coordinates &&
    Array.isArray(apiOrder.restaurant.location.coordinates) &&
    apiOrder.restaurant.location.coordinates.length >= 2
  ) {
    return apiOrder.restaurant.location.coordinates
  }
  return fallback || null
}

const getRestaurantAddressFromOrder = (apiOrder, previousOrder = null, explicitRestaurantAddress = null) => {
  if (explicitRestaurantAddress && String(explicitRestaurantAddress).trim()) {
    return String(explicitRestaurantAddress).trim()
  }

  const location = apiOrder?.restaurantId?.location || apiOrder?.restaurant?.location || {}

  if (location?.formattedAddress && String(location.formattedAddress).trim()) {
    return String(location.formattedAddress).trim()
  }
  if (location?.address && String(location.address).trim()) {
    return String(location.address).trim()
  }
  if (location?.addressLine1 && String(location.addressLine1).trim()) {
    return String(location.addressLine1).trim()
  }

  const parts = [location?.street, location?.area, location?.city, location?.state, location?.zipCode]
    .map((value) => (value == null ? '' : String(value).trim()))
    .filter(Boolean)

  if (parts.length > 0) return parts.join(', ')

  return previousOrder?.restaurantAddress || apiOrder?.restaurantAddress || apiOrder?.restaurant?.address || 'Restaurant location'
}

const getCustomerCoordsFromApiOrder = (apiOrder, previousOrder = null) => {
  const addr = apiOrder?.address || apiOrder?.deliveryAddress || {}
  const fromLoc = addr?.location?.coordinates
  if (Array.isArray(fromLoc) && fromLoc.length >= 2) return fromLoc
  const flat = addr?.coordinates
  if (Array.isArray(flat) && flat.length >= 2) return flat

  // Some payloads provide plain object coordinates instead of GeoJSON arrays.
  const objectCoord = addr?.location || addr
  const objLat = Number(objectCoord?.lat ?? objectCoord?.latitude)
  const objLng = Number(objectCoord?.lng ?? objectCoord?.longitude)
  if (Number.isFinite(objLat) && Number.isFinite(objLng)) return [objLng, objLat]

  const prev = previousOrder?.address?.coordinates || previousOrder?.address?.location?.coordinates
  if (Array.isArray(prev) && prev.length >= 2) return prev
  return null
}

const transformOrderForTracking = (apiOrder, previousOrder = null, explicitRestaurantCoords = null, explicitRestaurantAddress = null) => {
  const restaurantCoords = explicitRestaurantCoords || getRestaurantCoordsFromOrder(apiOrder, previousOrder?.restaurantLocation?.coordinates)
  const restaurantAddress = getRestaurantAddressFromOrder(apiOrder, previousOrder, explicitRestaurantAddress)
  // API returns `deliveryAddress`; some paths use `address`
  const addr = apiOrder?.address || apiOrder?.deliveryAddress || {}
  const customerCoordsResolved = getCustomerCoordsFromApiOrder(apiOrder, previousOrder)

  return {
    id: apiOrder?.orderId || apiOrder?._id,
    mongoId: apiOrder?._id || null,
    orderId: apiOrder?.orderId || apiOrder?._id,
    restaurant: 
      apiOrder?.restaurantId?.restaurantName || 
      apiOrder?.restaurantId?.name || 
      apiOrder?.restaurantName || 
      (typeof apiOrder?.restaurant === 'string' ? apiOrder.restaurant : null) ||
      apiOrder?.restaurant?.restaurantName || 
      apiOrder?.restaurant?.name || 
      previousOrder?.restaurant || 
      'Restaurant',
    restaurantPhone:
      apiOrder?.restaurantPhone ||
      apiOrder?.restaurantId?.phone ||
      apiOrder?.restaurantId?.ownerPhone ||
      apiOrder?.restaurant?.phone ||
      apiOrder?.restaurant?.ownerPhone ||
      previousOrder?.restaurantPhone ||
      '',
    restaurantAddress,
    restaurantId: apiOrder?.restaurantId || previousOrder?.restaurantId || null,
    userId: apiOrder?.userId || previousOrder?.userId || null,
    userName: apiOrder?.userName || apiOrder?.userId?.name || apiOrder?.userId?.fullName || previousOrder?.userName || '',
    userPhone: apiOrder?.userPhone || apiOrder?.userId?.phone || previousOrder?.userPhone || '',
    address: {
      street: addr?.street || previousOrder?.address?.street || '',
      city: addr?.city || previousOrder?.address?.city || '',
      state: addr?.state || previousOrder?.address?.state || '',
      zipCode: addr?.zipCode || previousOrder?.address?.zipCode || '',
      additionalDetails: addr?.additionalDetails || previousOrder?.address?.additionalDetails || '',
      formattedAddress: addr?.formattedAddress ||
        (addr?.street && addr?.city
          ? `${addr.street}${addr.additionalDetails ? `, ${addr.additionalDetails}` : ''}, ${addr.city}${addr.state ? `, ${addr.state}` : ''}${addr.zipCode ? ` ${addr.zipCode}` : ''}`
          : previousOrder?.address?.formattedAddress || addr?.city || ''),
      coordinates: customerCoordsResolved || addr?.location?.coordinates || previousOrder?.address?.coordinates || null
    },
    restaurantLocation: {
      coordinates: restaurantCoords
    },
    items: apiOrder?.items?.map(item => ({
      name: item.name,
      variantName: item.variantName || '',
      quantity: item.quantity,
      price: item.price
    })) || previousOrder?.items || [],
    total: apiOrder?.pricing?.total || previousOrder?.total || 0,
    // Backend canonical field is orderStatus; keep legacy `status` for UI compatibility.
    status: apiOrder?.orderStatus || apiOrder?.status || previousOrder?.status || 'pending',
    deliveryPartner: apiOrder?.deliveryPartnerId ? {
      name: apiOrder.deliveryPartnerId.name || apiOrder.deliveryPartnerId.fullName || 'Delivery Partner',
      phone: apiOrder.deliveryPartnerId.phone || apiOrder.deliveryPartnerId.phoneNumber || '',
      avatar: apiOrder.deliveryPartnerId.avatar || apiOrder.deliveryPartnerId.profilePicture || null
    } : (previousOrder?.deliveryPartner || null),
    deliveryPartnerId: apiOrder?.deliveryPartnerId?._id || apiOrder?.deliveryPartnerId || apiOrder?.dispatch?.deliveryPartnerId?._id || apiOrder?.dispatch?.deliveryPartnerId || apiOrder?.assignmentInfo?.deliveryPartnerId || null,
    dispatch: apiOrder?.dispatch || previousOrder?.dispatch || null,
    assignmentInfo: apiOrder?.assignmentInfo || previousOrder?.assignmentInfo || null,
    tracking: apiOrder?.tracking || previousOrder?.tracking || {},
    deliveryState: apiOrder?.deliveryState || previousOrder?.deliveryState || null,
    scheduledAt: apiOrder?.scheduledAt || previousOrder?.scheduledAt || null,
    createdAt: apiOrder?.createdAt || previousOrder?.createdAt || null,
    preparationTime: apiOrder?.preparationTime || previousOrder?.preparationTime || 0,
    acceptedAt: apiOrder?.acceptedAt || previousOrder?.acceptedAt || null,
    totalAmount: apiOrder?.pricing?.total || apiOrder?.totalAmount || previousOrder?.totalAmount || 0,
    deliveryFee: apiOrder?.pricing?.deliveryFee || apiOrder?.deliveryFee || previousOrder?.deliveryFee || 0,
    gst: apiOrder?.pricing?.tax || apiOrder?.pricing?.gst || apiOrder?.gst || apiOrder?.tax || previousOrder?.gst || 0,
    packagingFee: apiOrder?.pricing?.packagingFee || apiOrder?.packagingFee || 0,
    platformFee: apiOrder?.pricing?.platformFee || apiOrder?.platformFee || 0,
    discount: apiOrder?.pricing?.discount || apiOrder?.discount || 0,
    subtotal: apiOrder?.pricing?.subtotal || apiOrder?.subtotal || 0,
    paymentMethod: apiOrder?.paymentMethod || apiOrder?.payment?.method || previousOrder?.paymentMethod || null,
    payment: apiOrder?.payment || previousOrder?.payment || null,
    orderType: apiOrder?.orderType || previousOrder?.orderType || 'delivery',
    // Preserve delivery OTP code received via socket event.
    // API responses intentionally strip the secret code for security,
    // so without preserving it the UI would lose the OTP on each poll refresh.
    deliveryVerification: (() => {
      const prevDV = previousOrder?.deliveryVerification || null
      const apiDV = apiOrder?.deliveryVerification || null
      const handoverOtp = apiOrder?.handoverOtp || null
      
      if (!prevDV && !apiDV && !handoverOtp) return null

      const prevDropOtp = prevDV?.dropOtp || null
      const apiDropOtp = apiDV?.dropOtp || null
      
      const merged = {
        ...(prevDV || {}),
        ...(apiDV || {})
      }

      // Prioritize: 1. Real-time handoverOtp from current API response
      // 2. Previously preserved code in local state (from socket or earlier poll)
      // 3. Nested code field in API response (if ever present)
      const finalCode = handoverOtp || prevDropOtp?.code || apiDropOtp?.code

      if (finalCode || prevDropOtp?.required || apiDropOtp?.required) {
        merged.dropOtp = {
          ...(prevDropOtp || {}),
          ...(apiDropOtp || {}),
          code: finalCode
        }
      }
      return merged
    })(),
    cancellationReason: apiOrder?.cancellationReason || previousOrder?.cancellationReason || null,
    ratings: apiOrder?.ratings || previousOrder?.ratings || {},
    restaurantRating: apiOrder?.ratings?.restaurant?.rating || apiOrder?.restaurantRating || previousOrder?.restaurantRating || null,
    deliveryPartnerRating: apiOrder?.ratings?.deliveryPartner?.rating || apiOrder?.deliveryPartnerRating || previousOrder?.deliveryPartnerRating || null,
  }
}

/**
 * Backend uses `orderStatus` (created, confirmed, preparing, ready_for_pickup, picked_up, delivered, cancelled_*).
 * In this flow `confirmed` means the user placed the order and it is waiting for restaurant acceptance.
 * `preparing` is the first true restaurant-accepted state.
 */
function mapBackendOrderStatusToUi(raw) {
  const s = String(raw || "").toLowerCase()
  if (!s || s === "pending" || s === "created" || s === "confirmed") return "placed"
  if (s === "accepted" || s === "preparing" || s === "processed") return "preparing"
  if (s === "ready" || s === "ready_for_pickup" || s === "reached_pickup" || s === "order_confirmed") return "ready"
  if (s === "picked_up" || s === "out_for_delivery" || s === "en_route_to_delivery") return "on_way"
  if (s === "reached_drop" || s === "at_drop" || s === "at_delivery") return "at_drop"
  if (s === "delivered" || s === "completed") return "delivered"
  if (s.includes("cancelled") || s === "cancelled") return "cancelled"
  return "placed"
}

function mapOrderToTrackingUiStatus(orderLike) {
  if (!orderLike) return "placed"
  const statusRaw = orderLike.status || orderLike.orderStatus
  const phase = orderLike.deliveryState?.currentPhase

  // Terminal states handled first
  if (isFoodOrderCancelledStatus(statusRaw)) return "cancelled"
  if (statusRaw === "delivered" || statusRaw === "completed") return "delivered"

  // Live Ride / Phase-based mapping (Highest priority for precision)
  const isRiderAccepted = orderLike.dispatch?.status === "accepted" || orderLike.assignmentInfo?.status === "accepted" || orderLike.deliveryPartner?.status === "accepted";
  
  if (phase === "reached_drop" || phase === "at_drop" || statusRaw === "at_drop") return "at_drop"
  if (phase === "en_route_to_delivery" || statusRaw === "picked_up" || statusRaw === "out_for_delivery") return "on_way"
  if (phase === "at_pickup" && orderLike.deliveryPartnerId && isRiderAccepted) return "at_pickup"
  if (phase === "en_route_to_pickup" && orderLike.deliveryPartnerId && isRiderAccepted) return "assigned"

  // Fallback to basic status mapping
  return mapBackendOrderStatusToUi(statusRaw)
}

/** Prefer live delivery phase when present (socket / polling include deliveryState). */
function isFoodOrderCancelledStatus(statusRaw) {
  const s = String(statusRaw || "").toLowerCase()
  return s === "cancelled" || s.includes("cancelled")
}

function normalizeLookupId(value) {
  if (value == null) return ""
  const raw = String(value).trim()
  if (!raw || raw === "undefined" || raw === "null") return ""
  return raw
}

const getGlobalLastFetchTime = (id) => {
  if (typeof window === 'undefined') return 0;
  window.__lastOrderDetailsFetchTime = window.__lastOrderDetailsFetchTime || {};
  return window.__lastOrderDetailsFetchTime[id] || 0;
};

const setGlobalLastFetchTime = (id, time) => {
  if (typeof window === 'undefined') return;
  window.__lastOrderDetailsFetchTime = window.__lastOrderDetailsFetchTime || {};
  window.__lastOrderDetailsFetchTime[id] = time;
};

export default function OrderTracking() {
  const companyName = useCompanyName()
  const navigate = useNavigate()
  const location = useLocation()
  const { orderId } = useParams()
  const [searchParams] = useSearchParams()
  const confirmed = searchParams.get("confirmed") === "true"
  const { profile, getDefaultAddress } = useProfile()
  const { location: userLiveLocation } = useUserLocation()
  const { getOrderById } = useOrders()

  const [isSocketConnected, setIsSocketConnected] = useState(() => {
    return typeof window !== 'undefined' ? !!window.orderSocketConnected : false
  })

  useEffect(() => {
    const handleConnectionChange = (e) => {
      setIsSocketConnected(!!e?.detail?.isConnected)
    }
    window.addEventListener('userSocketConnectionChange', handleConnectionChange)
    return () => {
      window.removeEventListener('userSocketConnectionChange', handleConnectionChange)
    }
  }, [])
  
  // Extract initial order from location state or context for instant 0ms rendering
  const locationOrder = location.state?.order || location.state?.placedOrder
  const contextOrder = getOrderById(orderId)
  const initialOrder = locationOrder || contextOrder || null

  // State for order data
  const [order, setOrder] = useState(() => initialOrder ? transformOrderForTracking(initialOrder) : null)
  const [loading, setLoading] = useState(() => !initialOrder)
  const [error, setError] = useState(null)

  const [showConfirmation, setShowConfirmation] = useState(confirmed)
  const [orderStatus, setOrderStatus] = useState('placed')
  const [estimatedTime, setEstimatedTime] = useState(29)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const orderRef = useRef(order)
  const estimatedTimeRef = useRef(estimatedTime)

  useEffect(() => {
    orderRef.current = order
  }, [order])

  useEffect(() => {
    estimatedTimeRef.current = estimatedTime
  }, [estimatedTime])

  const isRefreshingRef = useRef(isRefreshing)
  useEffect(() => {
    isRefreshingRef.current = isRefreshing
  }, [isRefreshing])

  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [showOrderDetails, setShowOrderDetails] = useState(false)
  const [cancellationReason, setCancellationReason] = useState("")
  const [refundDestination, setRefundDestination] = useState("source")
  const [isCancelling, setIsCancelling] = useState(false)
  const [isInstructionsModalOpen, setIsInstructionsModalOpen] = useState(false)
  const [deliveryInstructions, setDeliveryInstructions] = useState("")
  const [isUpdatingInstructions, setIsUpdatingInstructions] = useState(false)
  const [resolvedLookupId, setResolvedLookupId] = useState("")
  const [timerNow, setTimerNow] = useState(Date.now())
  
  const navigateToHomeAfterRating = useRef(false)

  // Rating states
  const [showRatingModal, setShowRatingModal] = useState(false)
  const [selectedRestaurantRating, setSelectedRestaurantRating] = useState(null)
  const [selectedDeliveryRating, setSelectedDeliveryRating] = useState(null)
  const [restaurantFeedbackText, setRestaurantFeedbackText] = useState("")
  const [deliveryFeedbackText, setDeliveryFeedbackText] = useState("")
  const [submittingRating, setSubmittingRating] = useState(false)
  const [isLocalRated, setIsLocalRated] = useState(false)

  // Sync with localStorage on load/change
  useEffect(() => {
    const key = `rated_order_${orderId}`;
    if (localStorage.getItem(key) === 'true') {
      setIsLocalRated(true);
    }
  }, [orderId]);

  // Check if order is already rated
  const resRatingVal = Number(order?.ratings?.restaurant?.rating || order?.restaurantRating || 0)
  const delRatingVal = Number(order?.ratings?.deliveryPartner?.rating || order?.deliveryPartnerRating || 0)

  const hasRestaurantRating = resRatingVal > 0
  const hasDeliveryPartner = !!(order?.deliveryPartnerId || order?.deliveryPartnerName)
  const hasDeliveryRating = delRatingVal > 0
  const isOrderRated = hasRestaurantRating && (!hasDeliveryPartner || hasDeliveryRating)


  const handleOpenRating = () => {
    setSelectedRestaurantRating(order?.ratings?.restaurant?.rating || order?.restaurantRating || null)
    setSelectedDeliveryRating(order?.ratings?.deliveryPartner?.rating || order?.deliveryPartnerRating || null)
    setRestaurantFeedbackText(order?.ratings?.restaurant?.comment || "")
    setDeliveryFeedbackText(order?.ratings?.deliveryPartner?.comment || "")
    setShowRatingModal(true)
  }

  useEffect(() => {
    if (!showRatingModal && navigateToHomeAfterRating.current) {
      navigateToHomeAfterRating.current = false
      navigate("/user/home")
    }
  }, [showRatingModal])

  const handleBackClick = () => {
    const isDelivered = orderStatus === "delivered" || order?.status === "delivered" || Boolean(order?.deliveredAt)
    if (isDelivered && !isOrderRated) {
      navigateToHomeAfterRating.current = true
      handleOpenRating()
    } else {
      navigate(isDelivered ? "/user/home" : "/user/orders")
    }
  }

  const handleSubmitRating = async () => {
    const deliveryPartnerCheck = !!(order?.deliveryPartnerId || order?.deliveryPartnerName)
    const isMissingDeliveryRating = deliveryPartnerCheck && selectedDeliveryRating === null
    if (!order || selectedRestaurantRating === null || isMissingDeliveryRating) {
      toast.error("Please select all required ratings first")
      return
    }

    try {
      setSubmittingRating(true)
      const response = await orderAPI.submitOrderRatings(order.mongoId || order._id || order.id, {
        restaurantRating: selectedRestaurantRating,
        deliveryPartnerRating: deliveryPartnerCheck ? selectedDeliveryRating : undefined,
        restaurantComment: restaurantFeedbackText || undefined,
        deliveryPartnerComment: deliveryPartnerCheck ? (deliveryFeedbackText || undefined) : undefined,
      })
      
      const updatedOrderData = response?.data?.data?.order || response?.data?.order
      
      // Save rating state locally to prevent duplicate rating clicks/popups
      const oId = order.mongoId || order._id || order.id || orderId;
      localStorage.setItem(`rated_order_${oId}`, "true");
      setIsLocalRated(true);

      setOrder(prev => {
        const prevRatings = prev?.ratings || {};
        const newRestRating = selectedRestaurantRating;
        const newDelivRating = selectedDeliveryRating;
        const apiRatings = updatedOrderData?.ratings || {};
        
        return {
          ...prev,
          ...(updatedOrderData || {}),
          ratings: {
            ...prevRatings,
            ...apiRatings,
            restaurant: {
              ...(prevRatings.restaurant || {}),
              ...(apiRatings.restaurant || {}),
              rating: newRestRating,
              comment: restaurantFeedbackText || prevRatings.restaurant?.comment || ""
            },
            deliveryPartner: {
              ...(prevRatings.deliveryPartner || {}),
              ...(apiRatings.deliveryPartner || {}),
              rating: newDelivRating,
              comment: deliveryFeedbackText || prevRatings.deliveryPartner?.comment || ""
            }
          },
          restaurantRating: newRestRating,
          deliveryPartnerRating: newDelivRating
        };
      });

      toast.success("Thanks for your feedback!")
      setShowRatingModal(false)
    } catch (error) {
      debugError("Error submitting order ratings:", error)
      toast.error(error?.response?.data?.message || "Failed to submit ratings")
    } finally {
      setSubmittingRating(false)
    }
  }

  const handleEtaUpdate = useCallback((newEta) => {
    if (typeof newEta === 'string') {
      const match = newEta.match(/(\d+)/);
      if (match) {
        setEstimatedTime(parseInt(match[1], 10));
        return;
      }
    }
    if (typeof newEta === 'number' && !isNaN(newEta)) {
      setEstimatedTime(newEta);
    }
  }, [])
  const lastRealtimeRefreshRef = useRef(0)
  const trackingOrderIdsRef = useRef(new Set())
  const terminalPollStopRef = useRef(false)
  const lookupIdsRef = useRef([])
  const isInitialPollRequestedRef = useRef(null)
  const lastPollExecutionRef = useRef(0) // New: Hard throttle for extreme cases
  const lastStatusToastRef = useRef({ key: '', at: 0 })

  const ORDER_STATUS_TOAST_ID = 'order-tracking-status-update'
  const ORDER_STATUS_TOAST_DEDUPE_MS = 4000

  // Delivery handover OTP received via socket event.
  // Kept separately so UI still renders even if the event arrives
  // before the order API poll populates `order` state.
  const [socketDropOtpCode, setSocketDropOtpCode] = useState(null)


  // OTP received via socket event (deliveryDropOtp)
  useEffect(() => {
    const handleDeliveryDropOtp = (event) => {
      const detail = event?.detail || {}
      const otp = detail?.otp != null ? String(detail.otp) : null
      const evtOrderId = detail?.orderId != null ? String(detail.orderId) : null
      const evtOrderMongoId =
        detail?.orderMongoId != null ? String(detail.orderMongoId) : null

      if (!otp) return

      // If the order is already loaded, match by either orderId or mongoId.
      // Otherwise, match against the current URL param.
      const currentIds = [String(orderId)]
      if (order?.orderId) currentIds.push(String(order.orderId))
      if (order?.mongoId) currentIds.push(String(order.mongoId))
      if (order?._id) currentIds.push(String(order._id))

      const matches =
        (evtOrderId && currentIds.includes(evtOrderId)) ||
        (evtOrderMongoId && currentIds.includes(evtOrderMongoId))

      if (!matches) return

      // Always store so UI can render even if `order` hasn't loaded yet.
      setSocketDropOtpCode(otp)

      setOrder((prev) => {
        if (!prev) return prev
        const prevDV = prev.deliveryVerification || {}
        const prevDropOtp = prevDV.dropOtp || {}
        
        // Only update if code actually changed to avoid render loops
        if (prevDropOtp.code === otp) return prev;
        
        return {
          ...prev,
          deliveryVerification: {
            ...prevDV,
            dropOtp: {
              ...prevDropOtp,
              required: true,
              verified: false,
              code: otp
            }
          }
        }
      })
    }

    window.addEventListener('deliveryDropOtp', handleDeliveryDropOtp)
    return () => window.removeEventListener('deliveryDropOtp', handleDeliveryDropOtp)
  }, [orderId, order])

  // --- Start: Sync arrival time and status ---
  const getDeliveryTargetTime = useCallback((orderData) => {
    if (!orderData) return null;

    // If preparationTime is set by the restaurant, use acceptedAt + preparationTime
    if (orderData.preparationTime && orderData.acceptedAt) {
      const acceptTime = new Date(orderData.acceptedAt);
      return new Date(acceptTime.getTime() + orderData.preparationTime * 60000);
    }

    // Use scheduled time if available, fallback to creation time
    const orderTime = new Date(
      orderData.scheduledAt || orderData.createdAt || orderData.orderDate || orderData.created_at || orderData.date || Date.now()
    );

    // For non-scheduled orders, we add the estimated delivery time to the creation time.
    // For scheduled orders, scheduledAt is already the target time.
    const isScheduled = !!orderData.scheduledAt;
    const estimatedMinutes = isScheduled 
      ? 0 
      : (orderData.estimatedDeliveryTime || orderData.estimatedTime || orderData.estimated_delivery_time || 35);

    return new Date(orderTime.getTime() + estimatedMinutes * 60000);
  }, []);

  // Single clock source for estimatedTime and orderStatus sync
  useEffect(() => {
    if (!order) return;

    const targetTime = getDeliveryTargetTime(order);

    const updateTimerAndStatus = () => {
      const actualStatus = mapOrderToTrackingUiStatus(order);
      let diffMs = 0;
      if (targetTime) {
        diffMs = targetTime.getTime() - Date.now();
      }

      if (diffMs <= 0) {
        setEstimatedTime(0);
        // Do NOT auto-set to 'ready' — that status must come from the restaurant
        setOrderStatus(actualStatus);
      } else {
        const mins = Math.ceil(diffMs / 60000);
        setEstimatedTime(mins);
        setOrderStatus(actualStatus);
      }
    };

    updateTimerAndStatus();
    const interval = setInterval(updateTimerAndStatus, 1000); // Check every second for instant response

    return () => clearInterval(interval);
  }, [order, getDeliveryTargetTime]);
  // --- End: Sync arrival time and status ---

  // --------------------------------------------------------------------------
  // DATA FETCHING & POLLING STABILITY (FIXED FOR HAMMERING)
  // --------------------------------------------------------------------------

  // Socket notifications include order ids — keep a set so events match this page.
  useEffect(() => {
    const s = trackingOrderIdsRef.current
    s.add(String(orderId))
    if (order?.orderId) s.add(String(order.orderId))
    if (order?.mongoId) s.add(String(order.mongoId))
    if (order?.id) s.add(String(order.id))
  }, [orderId, order?.orderId, order?.mongoId, order?.id])

  useEffect(() => {
    const ids = [
      resolvedLookupId,
      orderId,
      order?.orderId,
      order?.mongoId,
      order?._id,
      order?.id,
    ]
      .map(normalizeLookupId)
      .filter(Boolean)
    lookupIdsRef.current = Array.from(new Set(ids))
  }, [orderId, resolvedLookupId, order?.orderId, order?.mongoId, order?._id, order?.id])

  // Stability Nuke: Move function bodies into a ref-protected execute flow
  const stableOpsRef = useRef({
    resolveOrderFromList: async (rawLookupId) => {
      const needle = normalizeLookupId(rawLookupId)
      if (!needle) return null
      try {
        const listResponse = await orderAPI.getOrders({ page: 1, limit: 50 })
        let orders = []
        if (listResponse?.data?.success && listResponse?.data?.data?.orders) {
          orders = listResponse.data.data.orders || []
        } else if (listResponse?.data?.orders) {
          orders = listResponse.data.orders || []
        } else if (Array.isArray(listResponse?.data?.data?.data)) {
          orders = listResponse.data.data.data || []
        } else if (Array.isArray(listResponse?.data?.data)) {
          orders = listResponse.data.data || []
        }

        const matched = (orders || []).find((o) => {
          const candidates = [o?._id, o?.id, o?.orderId, o?.mongoId].map(normalizeLookupId)
          return candidates.includes(needle)
        })
        if (matched) return matched
      } catch (err) {
        debugWarn('resolveOrderFromList error:', err)
      }
      return null
    },
    fetchOrderDetailsWithFallback: async (options = {}) => {
      const lookupIds = lookupIdsRef.current
      if (lookupIds.length === 0) throw new Error("Order id required")
      let lastError = null
      for (const id of lookupIds) {
        try {
          // Double guard against hammer
          return await orderAPI.getOrderDetails(id, options)
        } catch (err) {
          lastError = err
          if (err?.response?.status === 400 || err?.response?.status === 404) continue
          throw err
        }
      }
      throw lastError || new Error("Failed to fetch order details")
    }
  });

  const resolveOrderFromList = useCallback((id) => stableOpsRef.current.resolveOrderFromList(id), [])
  const fetchOrderDetailsWithFallback = useCallback((opts) => stableOpsRef.current.fetchOrderDetailsWithFallback(opts), [])

  // Clear OTP when order is finalized.
  useEffect(() => {
    if (!order) return
    const status = mapOrderToTrackingUiStatus(order)
    if (status === 'delivered' || status === 'cancelled') {
      setSocketDropOtpCode(null)


      setOrder((prev) => {
        if (!prev?.deliveryVerification?.dropOtp?.code) return prev
        return {
          ...prev,
          deliveryVerification: {
            ...(prev.deliveryVerification || {}),
            dropOtp: {
              ...(prev.deliveryVerification?.dropOtp || {}),
              code: null
            }
          }
        }
      })
    }
  }, [orderStatus, order])

  const defaultAddress = getDefaultAddress()
  const fallbackCustomerCoords = useMemo(() => {
    const orderCoords = order?.address?.coordinates || order?.address?.location?.coordinates
    if (Array.isArray(orderCoords) && orderCoords.length >= 2) {
      const lng = Number(orderCoords[0])
      const lat = Number(orderCoords[1])
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng }
      }
    }

    const orderLocObj = order?.address?.location || order?.address
    const orderObjLat = Number(orderLocObj?.lat ?? orderLocObj?.latitude)
    const orderObjLng = Number(orderLocObj?.lng ?? orderLocObj?.longitude)
    if (Number.isFinite(orderObjLat) && Number.isFinite(orderObjLng)) {
      return { lat: orderObjLat, lng: orderObjLng }
    }

    const defaultCoords = defaultAddress?.location?.coordinates
    if (Array.isArray(defaultCoords) && defaultCoords.length >= 2) {
      const lng = Number(defaultCoords[0])
      const lat = Number(defaultCoords[1])
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng }
      }
    }

    const defaultLocObj = defaultAddress?.location || defaultAddress
    const defaultObjLat = Number(defaultLocObj?.lat ?? defaultLocObj?.latitude)
    const defaultObjLng = Number(defaultLocObj?.lng ?? defaultLocObj?.longitude)
    if (Number.isFinite(defaultObjLat) && Number.isFinite(defaultObjLng)) {
      return { lat: defaultObjLat, lng: defaultObjLng }
    }

    const liveLat = Number(userLiveLocation?.latitude)
    const liveLng = Number(userLiveLocation?.longitude)
    if (Number.isFinite(liveLat) && Number.isFinite(liveLng)) {
      return { lat: liveLat, lng: liveLng }
    }

    return null
  }, [
    order?.address?.coordinates,
    order?.address?.location?.coordinates,
    defaultAddress?.location?.coordinates,
    userLiveLocation?.latitude,
    userLiveLocation?.longitude
  ])

  const userLiveCoords = useMemo(() => {
    const lat = Number(userLiveLocation?.latitude)
    const lng = Number(userLiveLocation?.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  }, [userLiveLocation?.latitude, userLiveLocation?.longitude])

  const isAdminAccepted = useMemo(() => {
    const status = order?.status
    return [
      "preparing",
      "ready",
      "ready_for_pickup",
      "picked_up",
    ].includes(status)
  }, [order?.status])

  // Single source of truth is now handled by the unified sync clock useEffect above.

  const acceptedAtMs = useMemo(() => {
    const timestamp =
      order?.tracking?.preparing?.timestamp ||
      order?.updatedAt ||
      order?.createdAt

    const parsed = timestamp ? new Date(timestamp).getTime() : NaN
    return Number.isFinite(parsed) ? parsed : null
  }, [order?.tracking?.preparing?.timestamp, order?.updatedAt, order?.createdAt])

  const editWindowRemainingMs = useMemo(() => {
    if (!isAdminAccepted || !acceptedAtMs) return 0
    const remaining = 60000 - (timerNow - acceptedAtMs)
    return Math.max(0, remaining)
  }, [isAdminAccepted, acceptedAtMs, timerNow])

  const isEditWindowOpen = editWindowRemainingMs > 0

  const editWindowText = useMemo(() => {
    const totalSeconds = Math.ceil(editWindowRemainingMs / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }, [editWindowRemainingMs])

  const handleCallRestaurant = (e) => {
    // Prevent event bubbling if necessary
    if (e && e.stopPropagation) e.stopPropagation();

    const rawPhone =
      order?.restaurantPhone ||
      order?.restaurantId?.phone ||
      order?.restaurantId?.ownerPhone ||
      order?.restaurantId?.contact?.phone ||
      order?.restaurant?.phone ||
      order?.restaurant?.ownerPhone ||
      order?.restaurantId?.location?.phone ||
      '';

    const cleanPhone = String(rawPhone).replace(/[^\d+]/g, '');
    
    if (!cleanPhone || cleanPhone.length < 5) {
      toast.error('Restaurant phone number not available');
      return;
    }

    debugLog('?? Attempting to call restaurant:', cleanPhone);
    
    // Most compatible way to trigger dialer on overall mobile/web environments:
    // Create a temporary hidden anchor and programmatically click it.
    try {
      const link = document.createElement('a');
      link.href = `tel:${cleanPhone}`;
      link.setAttribute('target', '_self');
      document.body.appendChild(link);
      link.click();
      if (document.body.contains(link)) document.body.removeChild(link);
    } catch (err) {
      debugError('Call failed via link click:', err);
      // Last-ditch fallback
      window.location.assign(`tel:${cleanPhone}`);
    }
  };

  const handleOpenDirections = async (e) => {
    if (e && e.stopPropagation) e.stopPropagation();

    let lat = null;
    let lng = null;

    // Helper to extract coords
    const extractCoords = (obj) => {
      if (!obj) return null;
      // If array [lng, lat]
      if (Array.isArray(obj) && obj.length >= 2) {
        return { lat: Number(obj[1]), lng: Number(obj[0]) };
      }
      // If array nested in coordinates
      if (obj.coordinates && Array.isArray(obj.coordinates) && obj.coordinates.length >= 2) {
        return { lat: Number(obj.coordinates[1]), lng: Number(obj.coordinates[0]) };
      }
      // If object with lat/lng or latitude/longitude
      const latVal = obj.lat || obj.latitude;
      const lngVal = obj.lng || obj.longitude;
      if (latVal != null && lngVal != null) {
        return { lat: Number(latVal), lng: Number(lngVal) };
      }
      return null;
    };

    // Try multiple sources on order
    let resolved = extractCoords(order?.restaurantLocation) || 
                   extractCoords(order?.restaurantId?.location) ||
                   extractCoords(order?.restaurant?.location);

    if (resolved) {
      lat = resolved.lat;
      lng = resolved.lng;
    }

    // Fallbacks on order object properties
    if (lat === null || lng === null) {
      const loc = order?.restaurantId?.location || order?.restaurant?.location;
      if (loc && Number.isFinite(Number(loc.latitude)) && Number.isFinite(Number(loc.longitude))) {
        lat = Number(loc.latitude);
        lng = Number(loc.longitude);
      } else if (loc && Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lng))) {
        lat = Number(loc.lat);
        lng = Number(loc.lng);
      }
    }

    // Dynamic fetch from restaurant API if coords are still missing
    if (lat === null || lng === null) {
      const restId = order?.restaurantId?._id || order?.restaurantId?.id || (typeof order?.restaurantId === 'string' ? order.restaurantId : null);
      if (restId) {
        try {
          const restaurantResponse = await restaurantAPI.getRestaurantById(restId);
          if (restaurantResponse?.data?.success && restaurantResponse.data.data?.restaurant) {
            const restaurant = restaurantResponse.data.data.restaurant;
            const fetched = extractCoords(restaurant.location);
            if (fetched) {
              lat = fetched.lat;
              lng = fetched.lng;
            }
          }
        } catch (err) {
          debugError('Failed to fetch restaurant details in handleOpenDirections:', err);
        }
      }
    }

    let mapsUrl = '';
    const name = order?.restaurant || 'Restaurant';

    if (lat !== null && lng !== null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
      mapsUrl = `https://maps.google.com/?q=${lat},${lng}+(${encodeURIComponent(name)})`;
    } else {
      const address = order?.restaurantAddress || '';
      const query = address ? `${name} ${address}` : name;
      mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(query)}`;
    }

    window.open(mapsUrl, '_blank');
  };

  const handleCallRider = (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    
    const rawPhone = order?.deliveryPartner?.phone || '';
    const cleanPhone = String(rawPhone).replace(/[^\d+]/g, '');

    if (!cleanPhone || cleanPhone.length < 5) {
      toast.error('Rider phone number not available');
      return;
    }

    debugLog('?? Attempting to call rider:', cleanPhone);
    
    try {
      const link = document.createElement('a');
      link.href = `tel:${cleanPhone}`;
      link.setAttribute('target', '_self');
      document.body.appendChild(link);
      link.click();
      if (document.body.contains(link)) document.body.removeChild(link);
    } catch (err) {
      debugError('Call failed via link click:', err);
      window.location.assign(`tel:${cleanPhone}`);
    }
  };

  const customerDeliveryOtp = useMemo(() => {
    const codeFromOrder = order?.deliveryVerification?.dropOtp?.code
    const code = codeFromOrder ?? socketDropOtpCode
    return code ? String(code) : null
  }, [order?.deliveryVerification?.dropOtp?.code, socketDropOtpCode])

  useEffect(() => {
    if (!isEditWindowOpen) return
    const interval = setInterval(() => {
      setTimerNow(Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [isEditWindowOpen])

  // Poll for order updates (especially when delivery partner accepts)

  const pollRef = useRef(null);

  // Main fetch & polling core logic. (Isolated from socket connection stat-changes)
  useEffect(() => {
    if (!orderId) return;

    let isSubscribed = true;
    let requestInProgress = false;

    const poll = async (isInitial = false) => {
      if (!isSubscribed || requestInProgress) return;
      if (terminalPollStopRef.current && !isInitial) return;

      const now = Date.now();
      
      let hasOrderData = !!orderRef.current;

      // Check context immediately to avoid loaders if data exists locally
      if (isInitial) {
        const rawContext = getOrderById(orderId);
        if (rawContext) {
          setOrder(transformOrderForTracking(rawContext));
          setLoading(false);
          hasOrderData = true;
        }
      }

      // Global throttle across component remounts to prevent rapid API hammering
      const globalLastFetch = getGlobalLastFetchTime(orderId);
      if (isInitial && hasOrderData && now - globalLastFetch < 2000) {
        debugLog("?? Throttling initial poll - too soon since last fetch");
        setLoading(false);
        return;
      }
      if (isInitial) {
        setGlobalLastFetchTime(orderId, now);
      }

      if (isInitial && now - lastPollExecutionRef.current < 1000) return;
      if (isInitial) lastPollExecutionRef.current = now;

      requestInProgress = true;
      try {
        const response = await fetchOrderDetailsWithFallback({ force: isInitial });
        if (!isSubscribed) return;

        let finalOrderData = null;

        if (response.data?.success && response.data.data?.order) {
          finalOrderData = response.data.data.order;
        } else if (isInitial) {
          const matchedOrder = await resolveOrderFromList(orderId);
          if (matchedOrder) finalOrderData = matchedOrder;
        }

        if (finalOrderData) {
          setOrder(prev => {
            const transformedOrder = transformOrderForTracking(finalOrderData, prev);
            const ui = mapOrderToTrackingUiStatus(transformedOrder);
            terminalPollStopRef.current = ui === 'delivered' || ui === 'cancelled';
            return transformedOrder;
          });
          setError(null);
          setLoading(false);
          return;
        }

        if (isInitial && !order) {
          setError(response.data?.message || 'Order not found');
          terminalPollStopRef.current = true;
        }
      } catch (err) {
        if (isInitial && !order) {
          try {
            const matchedOrder = await resolveOrderFromList(orderId);
            if (matchedOrder) {
              if (!isSubscribed) return;
              setOrder(prev => transformOrderForTracking(matchedOrder, prev));
              setError(null);
              setLoading(false);
              return;
            }
          } catch {}
          if (!isSubscribed) return;
          setError(err.response?.data?.message || 'Failed to fetch order details');
          terminalPollStopRef.current = true;
        }
      } finally {
        requestInProgress = false;
        if (isInitial && isSubscribed) setLoading(false);
      }
    };

    pollRef.current = poll;
    terminalPollStopRef.current = false;

    if (isInitialPollRequestedRef.current !== orderId) {
      isInitialPollRequestedRef.current = orderId;
      poll(true);
    }

    return () => {
      isSubscribed = false;
    };
  }, [orderId, fetchOrderDetailsWithFallback, resolveOrderFromList]);

  // Interval Manager (dynamically adapts based on socket connection state independently)
  useEffect(() => {
    if (!orderId) return;

    const tick = () => {
      if (terminalPollStopRef.current) return;
      if (document.hidden) return;
      // Delegate to the latest instance of our polling function capturing current state
      if (pollRef.current) pollRef.current(false);
    };
    
    const pollInterval = (isSocketConnected || window.orderSocketConnected) ? 60000 : 20000;
    const interval = setInterval(tick, pollInterval);

    return () => clearInterval(interval);
  }, [orderId, isSocketConnected]);

  useEffect(() => {
    if (!order) return
    const ui = mapOrderToTrackingUiStatus(order)
    terminalPollStopRef.current = ui === 'delivered' || ui === 'cancelled'
  }, [order])

  // Post-checkout splash only — real status comes from API / poll / socket.
  useEffect(() => {
    if (!confirmed) return
    const timer1 = setTimeout(() => setShowConfirmation(false), 3000)
    return () => clearTimeout(timer1)
  }, [confirmed])

  // Countdown timer is now handled by the unified sync clock useEffect above.

  // Listen for order status updates from socket (e.g., "Delivery partner on the way")
  useEffect(() => {
    const handleOrderStatusNotification = (event) => {
      const payload = event?.detail || {};
      const { message, status, estimatedDeliveryTime, orderId: evtOrderId, orderMongoId } = payload;

      const evtKeys = [evtOrderId, orderMongoId, payload?._id].filter(Boolean).map(String)
      const idMatches =
        evtKeys.length === 0 ||
        evtKeys.some((k) => String(k) === String(orderId)) ||
        evtKeys.some((k) => trackingOrderIdsRef.current.has(k))

      debugLog('?? Order status notification received:', { message, status, idMatches });

      if (idMatches) {
        const next = mapOrderToTrackingUiStatus({
          status,
          orderStatus: payload.orderStatus || status,
          deliveryState: payload.deliveryState,
        });
        const currentOrder = orderRef.current;
        const currentEstTime = estimatedTimeRef.current;
        if ((currentOrder?.orderType === 'takeaway' || currentOrder?.orderType === 'dining') && 
            currentEstTime <= 0 && 
            ['placed', 'preparing'].includes(next)) {
          setOrderStatus('ready');
        } else {
          setOrderStatus(next);
        }

        // Pull latest order state without refresh spam on bursty socket events.
        const now = Date.now();
        if (now - lastRealtimeRefreshRef.current > 1500 && !isRefreshingRef.current) {
          lastRealtimeRefreshRef.current = now;
          handleRefresh();
        }
      }

      // Show a single deduped notification toast
      if (message && idMatches) {
        const toastKey = `${String(evtOrderId || orderMongoId || orderId)}:${String(status || payload.orderStatus || '')}`
        const now = Date.now()
        const isDuplicateToast =
          toastKey &&
          toastKey === lastStatusToastRef.current.key &&
          now - lastStatusToastRef.current.at < ORDER_STATUS_TOAST_DEDUPE_MS

        if (isDuplicateToast) return

        lastStatusToastRef.current = { key: toastKey, at: now }
        toast.dismiss(ORDER_STATUS_TOAST_ID)
        toast.success(message, {
          id: ORDER_STATUS_TOAST_ID,
          duration: 5000,
          position: 'top-center',
          description: estimatedDeliveryTime
            ? `Estimated delivery in ${Math.round(estimatedDeliveryTime / 60)} minutes`
            : undefined
        });

        // Optional: Vibrate device if supported and user has interacted
        if (typeof window !== 'undefined' && window.__userHasInteracted && navigator.vibrate) {
          try {
            navigator.vibrate([200, 100, 200]);
          } catch (_) {}
        }
      }
    };

    // Listen for custom event from DeliveryTrackingMap
    window.addEventListener('orderStatusNotification', handleOrderStatusNotification);

    return () => {
      window.removeEventListener('orderStatusNotification', handleOrderStatusNotification);
    };
  }, [orderId])

  const handleCancelOrder = () => {
    // Check if order can be cancelled (only Razorpay orders that aren't delivered/cancelled)
    if (!order) return;

    if (isAdminAccepted && !isEditWindowOpen) {
      toast.error('Cancellation window ended. You can no longer cancel this order.');
      return;
    }

    if (order.status === 'cancelled') {
      toast.error('Order is already cancelled');
      return;
    }

    if (order.status === 'delivered') {
      toast.error('Cannot cancel a delivered order');
      return;
    }

    // Allow cancellation for all payment methods (Razorpay, COD, Wallet)
    // Only restrict if order is already cancelled or delivered (checked above)

    const method = String(order?.payment?.method || order?.paymentMethod || "").toLowerCase()
    const status = String(order?.payment?.status || "").toLowerCase()
    const isRazorpayPaid =
      method === "razorpay" && ["paid", "authorized", "captured", "settled", "refunded"].includes(status)

    setRefundDestination(isRazorpayPaid ? "source" : "wallet")

    setShowCancelDialog(true);
  };

  const handleConfirmCancel = async () => {
    if (!cancellationReason.trim()) {
      toast.error('Please provide a reason for cancellation');
      return;
    }

    setIsCancelling(true);
    try {
      const cancelLookupId =
        lookupIdsRef.current[0] || normalizeLookupId(orderId)
      const method = String(order?.payment?.method || order?.paymentMethod || "").toLowerCase()
      const status = String(order?.payment?.status || "").toLowerCase()
      const isRazorpayPaid =
        method === "razorpay" && ["paid", "authorized", "captured", "settled", "refunded"].includes(status)

      const payload = {
        reason: cancellationReason.trim(),
        ...(isRazorpayPaid ? { refundDestination } : {}),
      }

      const response = await orderAPI.cancelOrder(cancelLookupId, payload);
      if (response.data?.success) {
        const paymentMethod = order?.payment?.method || order?.paymentMethod;
        const successMessage = response.data?.message ||
          (paymentMethod === 'cash' || paymentMethod === 'cod'
            ? 'Order cancelled successfully. No refund required as payment was not made.'
            : refundDestination === 'wallet'
              ? 'Order cancelled successfully. Refund has been added to your wallet.'
              : 'Order cancelled successfully. Refund will be processed to your original payment method.');
        toast.success(successMessage);
        setShowCancelDialog(false);
        setCancellationReason("");
        setRefundDestination("source");
        // Refresh order data
        const orderResponse = await fetchOrderDetailsWithFallback({ force: true });
        if (orderResponse.data?.success && orderResponse.data.data?.order) {
          const apiOrder = orderResponse.data.data.order;
          setOrder(transformOrderForTracking(apiOrder, order));
        }
      } else {
        toast.error(response.data?.message || 'Failed to cancel order');
      }
    } catch (error) {
      debugError('Error cancelling order:', error);
      toast.error(error.response?.data?.message || 'Failed to cancel order');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleUpdateInstructions = async () => {
    try {
      setIsUpdatingInstructions(true);
      const response = await orderAPI.updateOrderInstructions(resolvedLookupId || orderId, deliveryInstructions);
      if (response.data?.success) {
        toast.success("Delivery instructions updated");
        setIsInstructionsModalOpen(false);
        const updatedOrder = response.data.data?.order;
        if (updatedOrder) {
          setOrder(prev => transformOrderForTracking(updatedOrder, prev));
        } else {
          setOrder(prev => ({ ...prev, note: deliveryInstructions }));
        }
      } else {
        toast.error(response.data?.message || "Failed to update instructions");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update instructions");
    } finally {
      setIsUpdatingInstructions(false);
    }
  };

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Track my order from ${order?.restaurant || companyName}`,
          text: `Hey! Track my order from ${order?.restaurant || companyName} with ID #${order?.orderId || order?.id}.`,
          url: window.location.href,
        });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        toast.success("Tracking link copied to clipboard!");
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        debugError('Error sharing:', error);
        toast.error("Failed to share link");
      }
    }
  };

  const handleRefresh = async () => {
    if (isRefreshingRef.current) return
    isRefreshingRef.current = true
    setIsRefreshing(true)
    try {
      const response = await fetchOrderDetailsWithFallback({ force: true })
      if (response.data?.success && response.data.data?.order) {
        const apiOrder = response.data.data.order

        // Extract restaurant location coordinates with multiple fallbacks
        let restaurantCoords = null;
        let restaurantAddress = null;

        // Priority 1: restaurantId.location.coordinates (GeoJSON format: [lng, lat])
        if (apiOrder.restaurantId?.location?.coordinates &&
          Array.isArray(apiOrder.restaurantId.location.coordinates) &&
          apiOrder.restaurantId.location.coordinates.length >= 2) {
          restaurantCoords = apiOrder.restaurantId.location.coordinates;
        }
        // Priority 2: restaurantId.location with latitude/longitude properties
        else if (apiOrder.restaurantId?.location?.latitude && apiOrder.restaurantId?.location?.longitude) {
          restaurantCoords = [apiOrder.restaurantId.location.longitude, apiOrder.restaurantId.location.latitude];
        }
        // Priority 3: Check nested restaurant data
        else if (apiOrder.restaurant?.location?.coordinates) {
          restaurantCoords = apiOrder.restaurant.location.coordinates;
        }
        // Priority 4: Check if restaurantId is a string ID and fetch restaurant details
        else if (typeof apiOrder.restaurantId === 'string') {
          debugLog('?? restaurantId is a string ID, fetching restaurant details...', apiOrder.restaurantId);
          try {
            const restaurantResponse = await restaurantAPI.getRestaurantById(apiOrder.restaurantId);
            if (restaurantResponse?.data?.success && restaurantResponse.data.data?.restaurant) {
              const restaurant = restaurantResponse.data.data.restaurant;
              if (restaurant.location?.coordinates && Array.isArray(restaurant.location.coordinates) && restaurant.location.coordinates.length >= 2) {
                restaurantCoords = restaurant.location.coordinates;
                debugLog('? Fetched restaurant coordinates from API:', restaurantCoords);
              }
              restaurantAddress =
                restaurant?.location?.formattedAddress ||
                restaurant?.location?.address ||
                restaurant?.address ||
                null;
            }
          } catch (err) {
            debugError('? Error fetching restaurant details:', err);
          }
        }

        setOrder(prev => transformOrderForTracking(apiOrder, prev, restaurantCoords, restaurantAddress))
      }
    } catch (err) {
      debugError('Error refreshing order:', err)
    } finally {
      isRefreshingRef.current = false
      setIsRefreshing(false)
    }
  }

  // --------------------------------------------------------------------------
  // RENDER (Final JSX)
  // --------------------------------------------------------------------------

  // Loading state (moved after hooks)
  if (loading) {
    return (
      <AnimatedPage className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] p-4">
        <div className="max-w-lg mx-auto text-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-gray-600 dark:text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading order details...</p>
        </div>
      </AnimatedPage>
    )
  }

  // Error state (moved after hooks)
  if (error || !order) {
    return (
      <AnimatedPage className="min-h-screen bg-gray-50 dark:bg-[#0a0a0a] p-4">
        <div className="max-w-lg mx-auto text-center py-20">
          <h1 className="text-lg sm:text-xl md:text-2xl font-bold mb-4 dark:text-gray-100">Order Not Found</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">{error || 'The order you\'re looking for doesn\'t exist.'}</p>
          <Link to="/user/orders">
            <Button>Back to Orders</Button>
          </Link>
        </div>
      </AnimatedPage>
    )
  }

  const statusConfig = {
    placed: {
      title: "Order Placed",
      subtitle: "Waiting for restaurant to accept",
      color: "bg-green-600",
      iconType: 'food'
    },
    confirmed: {
      title: "Order Placed",
      subtitle: "Waiting for restaurant to accept",
      color: "bg-green-600",
      iconType: 'food'
    },
    preparing: {
      title: "Food is being prepared",
      subtitle: (order?.orderType === "takeaway" || order?.orderType === "dining")
        ? (typeof estimatedTime === 'number' 
            ? (estimatedTime <= 0 ? "Waiting for restaurant to mark ready" : `Ready for pickup in ${estimatedTime} mins`) 
            : "Cooking your meal")
        : (typeof estimatedTime === 'number' 
            ? (estimatedTime <= 0 ? "Arriving soon" : `Arriving in ${estimatedTime} mins`) 
            : "Cooking your meal"),
      color: "bg-green-600",
      iconType: 'food'
    },
    assigned: {
      title: "Rider is arriving",
      subtitle: "A delivery partner is arriving at the restaurant",
      color: "bg-green-600",
      iconType: 'rider'
    },
    at_pickup: {
      title: "Rider at restaurant",
      subtitle: "Rider is waiting for your order",
      color: "bg-green-600",
      iconType: 'rider'
    },
    ready: {
      title: (order?.orderType === "takeaway" || order?.orderType === "dining") ? "Ready for pickup" : "Handover in progress",
      subtitle: (order?.orderType === "takeaway" || order?.orderType === "dining") ? "Please collect your order from the restaurant" : "Rider is picking up your order",
      color: "bg-green-600",
      iconType: (order?.orderType === "takeaway" || order?.orderType === "dining") ? 'delivered' : 'rider'
    },
    on_way: {
      title: "Out for delivery",
      subtitle: typeof estimatedTime === 'number' 
        ? (estimatedTime <= 0 ? "Arriving soon" : `Arriving in ${estimatedTime} mins`) 
        : "Rider is out for delivery",
      color: "bg-green-600",
      iconType: 'rider'
    },
    at_drop: {
      title: "Arrived at location",
      subtitle: "Please come to the door",
      color: "bg-green-600",
      iconType: 'rider'
    },
    delivered: {
      title: order?.orderType === "takeaway" ? "Picked UP" : "Order delivered",
      subtitle: order?.orderType === "takeaway" ? "Thank you for ordering!" : "Enjoy your meal!",
      color: "bg-green-600",
      iconType: 'delivered'
    },
    cancelled: {
      title: order?.orderType === "takeaway"
        ? "Takeaway order cancelled"
        : order?.orderType === "dining"
          ? "Dining order cancelled"
          : "Order cancelled",
      subtitle: order?.cancellationReason || "This order has been cancelled",
      color: "bg-red-600",
      iconType: 'cancelled'
    }
  }

  const currentStatus = statusConfig[orderStatus] || statusConfig.placed
  const isScheduledOrder = Boolean(order?.scheduledAt) && !['delivered', 'cancelled'].includes(orderStatus)
  const scheduledDateFormatted = order?.scheduledAt
    ? new Date(order.scheduledAt).toLocaleString("en-IN", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null
  const isDeliveredOrder =
    orderStatus === "delivered" ||
    order?.status === "delivered" ||
    Boolean(order?.deliveredAt)

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-[#0a0a0a]">
      {/* Order Confirmed Modal */}
      <AnimatePresence>
        {showConfirmation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-white dark:bg-[#1a1a1a] flex flex-col items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, type: "spring" }}
              className="text-center px-8"
            >
              <AnimatedCheckmark delay={0.3} />
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.9 }}
                className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-6"
              >
                {isScheduledOrder ? "Order Scheduled!" : "Order Placed!"}
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.1 }}
                className="text-gray-600 dark:text-gray-300 mt-2"
              >
                {isScheduledOrder
                  ? `Scheduled for ${scheduledDateFormatted}`
                  : "Waiting for the restaurant to accept your order"}
              </motion.p>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.5 }}
                className="mt-8"
              >
                <div className="w-8 h-8 border-2 border-[#DC2626] border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-sm text-gray-500 mt-3">Loading order details...</p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 2.0 }}
                className="mt-12 pt-8 border-t border-gray-100 dark:border-gray-800"
              >
                <div className="flex items-center justify-center gap-2 text-[#DC2626] dark:text-orange-400 font-medium cursor-pointer hover:opacity-80 transition-opacity" onClick={() => navigate('/user/profile/report-safety-emergency', { state: { returnTo: location.pathname } })}>
                  <Shield className="w-4 h-4" />
                  <span className="text-sm">Learn about delivery partner safety</span>
                </div>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Green Header */}
      <motion.div
        className={`${currentStatus.color} text-white sticky top-0 z-40`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {/* Navigation bar */}
        <div className="flex items-center justify-between px-4 py-3">
          <motion.button
            className="w-10 h-10 flex items-center justify-center"
            whileTap={{ scale: 0.9 }}
            onClick={handleBackClick}
          >
            <ArrowLeft className="w-6 h-6" />
          </motion.button>
          <h2 className="font-semibold text-lg">{order.restaurant}</h2>
          <motion.button
            className="w-10 h-10 flex items-center justify-center cursor-pointer"
            whileTap={{ scale: 0.9 }}
            onClick={handleShare}
          >
            <Share2 className="w-5 h-5" />
          </motion.button>
        </div>

        {/* Status section - hidden for success milestones as requested */}
        {isScheduledOrder && ['placed', 'confirmed'].includes(orderStatus) ? (
          <div className="px-4 pb-5 text-center">
            <motion.div
              className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-full px-4 py-1.5 mb-3"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            >
              <Clock className="w-4 h-4" />
              <span className="text-sm font-semibold">Scheduled Order</span>
            </motion.div>
            <motion.h1
              className="text-2xl font-bold mb-2"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              Order Scheduled
            </motion.h1>
            <motion.div
              className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-full px-5 py-2.5"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <Calendar className="w-4 h-4" />
              <span className="text-sm font-medium">{scheduledDateFormatted}</span>
              <span className="w-1 h-1 rounded-full bg-white/60" />
              <motion.button
                onClick={handleRefresh}
                className="ml-1"
                animate={{ rotate: isRefreshing ? 360 : 0 }}
                transition={{ duration: 0.5 }}
              >
                <RefreshCw className="w-4 h-4" />
              </motion.button>
            </motion.div>
            <motion.p
              className="text-xs mt-3 text-white/80"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              The restaurant will start preparing your order closer to the scheduled time
            </motion.p>
          </div>
        ) : !['at_pickup', 'ready', 'on_way', 'at_drop', 'delivered'].includes(orderStatus) && (
          <div className="px-4 pb-4 text-center">
            <motion.h1
              className="text-2xl font-bold mb-3"
              key={currentStatus.title}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {currentStatus.title}
            </motion.h1>

            {/* Status pill */}
            <motion.div
              className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-full px-4 py-2"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <span className="text-sm font-medium">{currentStatus.subtitle}</span>
              <motion.button
                onClick={handleRefresh}
                className="ml-1 flex items-center justify-center"
                animate={{ rotate: isRefreshing ? 360 : 0 }}
                transition={{ duration: 0.5 }}
              >
                <RefreshCw className="w-4 h-4" />
              </motion.button>
            </motion.div>
        </div>
      )}
      </motion.div>

      {/* Map Section, Takeaway, or Dining Animation */}
      {!isDeliveredOrder && orderStatus !== 'cancelled' && !(isScheduledOrder && ['placed', 'confirmed'].includes(orderStatus)) && (
        order?.orderType === 'takeaway' ? (
          <TakeawayAnimation order={order} />
        ) : order?.orderType === 'dining' ? (
          <DiningAnimation order={order} />
        ) : (
          <MapErrorBoundary>
            <DeliveryMap
              orderId={orderId}
              order={order}
              isVisible={order !== null}
              fallbackCustomerCoords={fallbackCustomerCoords}
              userLiveCoords={userLiveCoords}
              userLocationAccuracy={userLiveLocation?.accuracy ?? null}
              onEtaUpdate={handleEtaUpdate}
            />
          </MapErrorBoundary>
        )
      )}

      {/* Scrollable Content */}
      <div className="max-w-4xl mx-auto px-4 md:px-6 lg:px-8 py-4 md:py-6 space-y-4 md:space-y-6 pb-24 md:pb-32">
        {/* Cancellation window removed as per user request to hide immediately after acceptance */}

        {customerDeliveryOtp && orderStatus !== 'delivered' && orderStatus !== 'cancelled' && (
          <motion.div
            className={`rounded-xl p-4 shadow-sm border ${
              order?.orderType === 'takeaway'
                ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/30'
                : 'bg-blue-50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/30'
            }`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28 }}
          >
            <p className={`text-xs font-semibold uppercase tracking-wide ${
              order?.orderType === 'takeaway' ? 'text-emerald-700 dark:text-emerald-400' : 'text-blue-700 dark:text-blue-400'
            }`}>
              {order?.orderType === 'takeaway' ? 'Takeaway OTP' : 'Delivery OTP'}
            </p>
            <p className={`text-2xl font-extrabold mt-1 tracking-widest ${
              order?.orderType === 'takeaway' ? 'text-emerald-900 dark:text-emerald-250' : 'text-blue-900 dark:text-blue-200'
            }`}>
              {customerDeliveryOtp}
            </p>
            <p className={`text-xs mt-1 ${
              order?.orderType === 'takeaway' ? 'text-emerald-700 dark:text-emerald-400' : 'text-blue-700 dark:text-blue-400'
            }`}>
              {order?.orderType === 'takeaway'
                ? 'Share this 4-digit OTP with the restaurant at the counter to verify and complete your pick-up.'
                : 'Share this 4-digit OTP with your delivery partner at drop-off.'}
            </p>
          </motion.div>
        )}

        {/* Takeaway / Self Pickup Card */}
        {order?.orderType === 'takeaway' && orderStatus !== 'ready' && orderStatus !== 'delivered' && orderStatus !== 'cancelled' && (
          <motion.div
            className="bg-orange-50 dark:bg-orange-950/20 border border-orange-100 dark:border-orange-900/30 rounded-xl p-4 shadow-sm flex items-start gap-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
          >
            <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center shrink-0">
              <ShoppingBag className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-gray-900 dark:text-gray-100 text-sm">Takeaway / Self Pickup</h4>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">
                {orderStatus === 'preparing'
                  ? "Your order is being prepared. We'll notify you when it's ready."
                  : "Waiting for the restaurant to accept and prepare your order."}
              </p>
            </div>
          </motion.div>
        )}

        {/* Dynamic Status Card */}
        {['at_pickup', 'ready', 'on_way', 'at_drop', 'delivered'].includes(orderStatus) && (
          <motion.div
            className="bg-white dark:bg-[#1a1a1a] rounded-xl p-3 sm:p-4 shadow-sm"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            {isScheduledOrder && ['placed', 'confirmed'].includes(orderStatus) ? (
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm border border-blue-100 bg-blue-50">
                  <Clock className="w-7 h-7 text-blue-600" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-gray-900 dark:text-gray-100 leading-tight">Order Scheduled</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-snug">
                    {scheduledDateFormatted}
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                    We'll notify you when the restaurant starts preparing
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm border border-gray-100 dark:border-gray-800 ${
                  currentStatus.iconType === 'rider' ? 'bg-blue-50 dark:bg-blue-900/20' : 
                  currentStatus.iconType === 'cancelled' ? 'bg-red-50 dark:bg-red-900/20' : 
                  currentStatus.iconType === 'delivered' ? 'bg-green-50 dark:bg-green-900/20' : 
                  'bg-orange-50 dark:bg-orange-900/20'
                }`}>
                  {currentStatus.iconType === 'rider' ? (
                    <div 
                      dangerouslySetInnerHTML={{ __html: RIDER_BIKE_SVG.replace(/width="\d+"/, 'width="100%"').replace(/height="\d+"/, 'height="100%"') }} 
                      className="w-full h-full" 
                    />
                  ) : currentStatus.iconType === 'cancelled' ? (
                    <div className="w-full h-full flex items-center justify-center p-2 text-red-500">
                      <X className="w-full h-full" />
                    </div>
                  ) : currentStatus.iconType === 'delivered' ? (
                    <div className="w-full h-full flex items-center justify-center p-2 text-green-500">
                      <Check className="w-full h-full" />
                    </div>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center p-2 text-orange-500">
                      <Receipt className="w-full h-full" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-gray-900 dark:text-gray-100 leading-tight">{currentStatus.title}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-snug">{currentStatus.subtitle}</p>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Rating Logic: Show rating card after delivery */}
        {orderStatus === 'delivered' && !isOrderRated && (
          <motion.div
            className={`bg-white dark:bg-[#1a1a1a] rounded-xl p-6 shadow-sm border-2 border-[#DC2626]/10 relative overflow-hidden group transition-all duration-200 ${
              isLocalRated 
                ? "cursor-default opacity-95" 
                : "cursor-pointer hover:bg-gray-50/80 dark:hover:bg-gray-800/20"
            }`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            onClick={isLocalRated ? undefined : handleOpenRating}
          >
            {/* Background pattern decoration */}
            <div className="absolute -top-4 -right-4 w-24 h-24 bg-[#DC2626]/5 rounded-full blur-2xl group-hover:bg-[#DC2626]/10 transition-colors" />
            
            <div className="flex flex-col items-center text-center relative z-10">
              <div className="w-16 h-16 bg-[#DC2626]/10 dark:bg-[#DC2626]/20 rounded-full flex items-center justify-center mb-4 transition-transform group-hover:scale-110 duration-300">
                <Star className="w-8 h-8 text-[#DC2626] fill-[#DC2626]" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {isLocalRated ? "Feedback Received" : "Enjoyed your food?"}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 mb-6 max-w-[280px]">
                {isLocalRated 
                  ? "Thank you for rating your experience! Your feedback has been submitted." 
                  : `Rate your experience with ${order?.restaurant || "The Restaurant"} and help us improve!`}
              </p>
              
              <Button 
                disabled={isLocalRated}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isLocalRated) {
                    handleOpenRating();
                  }
                }}
                className={`w-full max-w-[200px] font-bold h-12 rounded-xl border-none shadow-lg transition-all duration-150 ${
                  isLocalRated
                    ? "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed shadow-none"
                    : "bg-[#DC2626] hover:bg-[#991B1B] text-white shadow-[#DC2626]/20"
                }`}
              >
                {isLocalRated ? "Submitted" : "Give Rating"}
              </Button>
            </div>
          </motion.div>
        )}

        {/* Rating Summary: Show what the user rated */}
        {orderStatus === 'delivered' && isOrderRated && (
          <motion.div
            className="bg-white dark:bg-[#1a1a1a] rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-800 transition-all duration-200"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-50 dark:border-gray-800/50">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Your Feedback
              </h3>
              <button 
                disabled
                className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest cursor-not-allowed opacity-50"
              >
                Rating Submitted
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{order?.restaurant || "Food & Restaurant"}</span>
                  {order?.ratings?.restaurant?.comment && (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 italic mt-0.5 line-clamp-1">"{order.ratings.restaurant.comment}"</span>
                  )}
                </div>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={`res-rated-${star}`}
                      className={`w-3.5 h-3.5 ${
                        star <= (order?.ratings?.restaurant?.rating || order?.restaurantRating)
                          ? "text-yellow-400 fill-yellow-400"
                          : "text-gray-200 dark:text-gray-800"
                      }`}
                    />
                  ))}
                </div>
              </div>
              
              {hasDeliveryPartner && (
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Delivery Service</span>
                    {order?.ratings?.deliveryPartner?.comment && (
                      <span className="text-[10px] text-gray-500 dark:text-gray-400 italic mt-0.5 line-clamp-1">"{order.ratings.deliveryPartner.comment}"</span>
                    )}
                  </div>
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={`del-rated-${star}`}
                        className={`w-3.5 h-3.5 ${
                          star <= (order?.ratings?.deliveryPartner?.rating || order?.deliveryPartnerRating)
                            ? "text-yellow-400 fill-yellow-400"
                            : "text-gray-200 dark:text-gray-800"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Delivery Partner Info */}
        {order?.deliveryPartnerId && (
          <motion.div
            className="bg-white dark:bg-[#1a1a1a] rounded-xl shadow-sm overflow-hidden"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55 }}
          >
            <div className="flex items-center gap-3 p-4 border-b border-dashed border-gray-200 dark:border-gray-800">
              <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-900/20 overflow-hidden flex items-center justify-center flex-shrink-0 border border-blue-100 dark:border-blue-900/30 p-1">
                {order.deliveryPartner?.avatar ? (
                  <img src={order.deliveryPartner.avatar} alt="Rider" className="w-full h-full object-cover" />
                ) : (
                  <div 
                    dangerouslySetInnerHTML={{ __html: RIDER_BIKE_SVG.replace(/width="\d+"/, 'width="100%"').replace(/height="\d+"/, 'height="100%"') }} 
                    className="w-full h-full p-1" 
                  />
                )}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900 dark:text-gray-100">{order.deliveryPartner?.name || 'Delivery Partner'}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {orderStatus === 'delivered' ? 'Delivered your order' : 'Your delivery partner is arriving'}
                </p>
              </div>
              <motion.button
                className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center"
                onClick={handleCallRider}
                whileTap={{ scale: 0.9 }}
              >
                <Phone className="w-5 h-5 text-blue-600" />
              </motion.button>
            </div>
            {order?.note && (
              <div className="bg-blue-50/50 dark:bg-blue-900/10 p-3 mx-4 mb-4 rounded-lg flex items-start gap-2 border border-blue-100 dark:border-blue-900/20">
                <MessageSquare className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-0.5">Instruction for Rider</p>
                  <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed font-medium">"{order.note}"</p>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Delivery Partner Safety */}
        {orderStatus !== 'delivered' && orderStatus !== 'cancelled' && order?.orderType !== 'takeaway' && order?.orderType !== 'dining' && (
          <motion.button
            className="w-full bg-white dark:bg-[#1a1a1a] rounded-xl p-4 shadow-sm flex items-center gap-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => navigate('/user/profile/report-safety-emergency', { state: { returnTo: location.pathname } })}
          >
            <Shield className="w-6 h-6 text-gray-600 dark:text-gray-400" />
            <span className="flex-1 text-left font-medium text-gray-900 dark:text-gray-100">
              Learn about delivery partner safety
            </span>
            <ChevronRight className="w-5 h-5 text-gray-400" />
          </motion.button>
        )}

        {/* Delivery Details Banner */}
        {orderStatus !== 'delivered' && orderStatus !== 'cancelled' && order?.orderType !== 'takeaway' && order?.orderType !== 'dining' && (
          <motion.div
            className="bg-yellow-50 dark:bg-yellow-900/10 rounded-xl p-4 text-center border dark:border-yellow-900/30"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65 }}
          >
            <p className="text-yellow-800 dark:text-yellow-400 font-medium text-sm">
              All your delivery details in one place 🥡
            </p>
          </motion.div>
        )}

        {/* Contact & Address Section */}
        {order?.orderType !== 'takeaway' && (
          <motion.div
            className="bg-white dark:bg-[#1a1a1a] rounded-xl shadow-sm overflow-hidden"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
          >
            <SectionItem
              icon={User}
              title={
                order?.userName ||
                order?.userId?.fullName ||
                order?.userId?.name ||
                profile?.fullName ||
                profile?.name ||
                'Customer'
              }
              subtitle={
                order?.userPhone ||
                order?.userId?.phone ||
                profile?.phone ||
                defaultAddress?.phone ||
                'Phone number not available'
              }
              showArrow={false}
            />
            <SectionItem
              iconNode={
                order?.orderType === 'dining' ? (
                  <Users className="w-5 h-5 text-blue-600" />
                ) : (
                  <div
                    dangerouslySetInnerHTML={{ __html: SAFE_CUSTOMER_PIN }}
                    className="w-6 h-6 [&_svg]:w-full [&_svg]:h-full [&_svg]:block"
                  />
                )
              }
              title={
                order?.orderType === 'dining'
                  ? "Dining / Table Service"
                  : "Delivery at Location"
              }
              subtitle={(() => {
                if (order?.orderType === 'dining') {
                  return `Enjoy your food in the restaurant. Table service.`
                }

                // Priority 1: Use order address formattedAddress (live location address)
                if (order?.address?.formattedAddress && order.address.formattedAddress !== "Select location") {
                  return order.address.formattedAddress
                }

                // Priority 2: Build full address from order address parts
                if (order?.address) {
                  const orderAddressParts = []
                  if (order.address.street) orderAddressParts.push(order.address.street)
                  if (order.address.additionalDetails) orderAddressParts.push(order.address.additionalDetails)
                  if (order.address.city) orderAddressParts.push(order.address.city)
                  if (order.address.state) orderAddressParts.push(order.address.state)
                  if (order.address.zipCode) orderAddressParts.push(order.address.zipCode)
                  if (orderAddressParts.length > 0) {
                    return orderAddressParts.join(', ')
                  }
                }

                // Priority 3: Use defaultAddress formattedAddress (live location address)
                if (defaultAddress?.formattedAddress && defaultAddress.formattedAddress !== "Select location") {
                  return defaultAddress.formattedAddress
                }

                // Priority 4: Build full address from defaultAddress parts
                if (defaultAddress) {
                  const defaultAddressParts = []
                  if (defaultAddress.street) defaultAddressParts.push(defaultAddress.street)
                  if (defaultAddress.additionalDetails) defaultAddressParts.push(defaultAddress.additionalDetails)
                  if (defaultAddress.city) defaultAddressParts.push(defaultAddress.city)
                  if (defaultAddress.state) defaultAddressParts.push(defaultAddress.state)
                  if (defaultAddress.zipCode) defaultAddressParts.push(defaultAddress.zipCode)
                  if (defaultAddressParts.length > 0) {
                    return defaultAddressParts.join(', ')
                  }
                }

                return 'Add delivery address'
              })()}
              showArrow={false}
            />
            {!isAdminAccepted && orderStatus !== 'cancelled' && orderStatus !== 'delivered' && order?.orderType !== 'dining' && (
              <SectionItem
                icon={MessageSquare}
                title={order?.note ? "Edit delivery instructions" : "Add delivery instructions"}
                subtitle={order?.note ? order.note.substring(0, 35) + (order.note.length > 35 ? "..." : "") : ""}
                onClick={() => {
                  setDeliveryInstructions(order?.note || "");
                  setIsInstructionsModalOpen(true);
                }}
              />
            )}
          </motion.div>
        )}

        {/* Restaurant Section */}
        <motion.div
          className="bg-white dark:bg-[#1a1a1a] rounded-xl shadow-sm overflow-hidden"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.75 }}
        >
          <div className="flex items-center gap-3 p-4 border-b border-dashed border-gray-200 dark:border-gray-800">
            <div className="w-12 h-12 rounded-full bg-orange-100 overflow-hidden flex items-center justify-center flex-shrink-0">
              <div
                dangerouslySetInnerHTML={{ __html: SAFE_RESTAURANT_PIN }}
                className="w-7 h-7 [&_svg]:w-full [&_svg]:h-full [&_svg]:block"
              />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-gray-900 dark:text-gray-100">{order.restaurant}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{order.restaurantAddress || 'Restaurant location'}</p>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <motion.button
                className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center shadow-sm"
                onClick={handleOpenDirections}
                whileTap={{ scale: 0.9 }}
                title="Get Directions"
              >
                <Navigation className="w-5 h-5 text-[#DC2626]" />
              </motion.button>
              <motion.button
                className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center shadow-sm"
                onClick={handleCallRestaurant}
                whileTap={{ scale: 0.9 }}
                title="Call Restaurant"
              >
                <Phone className="w-5 h-5 text-[#DC2626]" />
              </motion.button>
            </div>
          </div>

          {/* Order Items */}
          <div
            className="p-4 border-b border-dashed border-gray-200 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            onClick={() => setShowOrderDetails(true)}
          >
            <div className="flex items-start gap-3">
              <Receipt className="w-5 h-5 text-gray-500 mt-0.5" />
              <div className="flex-1">
                <div className="mt-2 space-y-1">
                  {order?.items?.map((item, index) => (
                    <div key={index} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <span className="w-4 h-4 rounded border border-green-600 flex items-center justify-center">
                        <span className="w-2 h-2 rounded-full bg-green-600" />
                      </span>
                      <span>{item.quantity} x {item.name}{item.variantName ? ` (${item.variantName})` : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
          </div>
        </motion.div>

        {!isAdminAccepted && orderStatus !== 'cancelled' && orderStatus !== 'delivered' && (
          <motion.div
            className="flex flex-col gap-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
          >
            <Button
              variant="outline"
              className="w-full h-12 rounded-xl font-semibold bg-red-600 text-white border-red-600 shadow-sm hover:bg-red-700 hover:text-white hover:border-red-700"
              onClick={handleCancelOrder}
            >
              Cancel Order
            </Button>
            <p className="text-[10px] text-gray-400 text-center px-4">
              You can cancel your order until the restaurant accepts it.
            </p>
          </motion.div>
        )}

      </div>

      {/* Cancel Order Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent className="sm:max-w-xl w-[95%] max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-gray-900">
              Cancel Order
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-6 px-2">
            {(() => {
              const method = String(order?.payment?.method || order?.paymentMethod || "").toLowerCase()
              const status = String(order?.payment?.status || "").toLowerCase()
              const isRazorpayPaid =
                method === "razorpay" && ["paid", "authorized", "captured", "settled", "refunded"].includes(status)

              if (!isRazorpayPaid) return null

              return (
                <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm font-semibold text-gray-900">Refund preference</p>
                  <div className="space-y-2">
                    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 bg-white px-3 py-2">
                      <input
                        type="radio"
                        name="refund-destination"
                        value="source"
                        checked={refundDestination === "source"}
                        onChange={() => setRefundDestination("source")}
                        disabled={isCancelling}
                        className="mt-0.5"
                      />
                      <span className="text-sm text-gray-700">Refund to original payment method (5-7 working days)</span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 bg-white px-3 py-2">
                      <input
                        type="radio"
                        name="refund-destination"
                        value="wallet"
                        checked={refundDestination === "wallet"}
                        onChange={() => setRefundDestination("wallet")}
                        disabled={isCancelling}
                        className="mt-0.5"
                      />
                      <span className="text-sm text-gray-700">Refund to wallet (instant credit)</span>
                    </label>
                  </div>
                </div>
              )
            })()}

            <div className="space-y-2 w-full">
              <Textarea
                value={cancellationReason}
                onChange={(e) => setCancellationReason(e.target.value)}
                placeholder="e.g., Changed my mind, Wrong address, etc."
                className="w-full min-h-[100px] resize-none border-2 border-gray-300 rounded-lg px-4 py-3 text-sm focus:border-red-500 focus:ring-2 focus:ring-red-200 focus:outline-none transition-colors disabled:bg-gray-100 disabled:cursor-not-allowed disabled:border-gray-200"
                disabled={isCancelling}
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCancelDialog(false);
                  setCancellationReason("");
                  setRefundDestination("source");
                }}
                disabled={isCancelling}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmCancel}
                disabled={isCancelling || !cancellationReason.trim()}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
              >
                {isCancelling ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  'Confirm Cancellation'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Order Details Dialog */}
      <Dialog open={showOrderDetails} onOpenChange={setShowOrderDetails}>
        <DialogContent className="max-w-[calc(100vw-32px)] sm:max-w-md bg-white dark:bg-[#1a1a1a] rounded-2xl p-0 overflow-hidden border-none outline-none">
          <DialogHeader className="p-6 pb-4 border-b border-gray-100 dark:border-gray-800 pr-12">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-xl font-bold text-gray-900">Order Details</DialogTitle>
            </div>
          </DialogHeader>

          <div className="p-6 pt-4 space-y-6 max-h-[70vh] overflow-y-auto">
            {/* Order Meta Info */}
            <div className="flex flex-col gap-1 b">
              <div className="flex items-center gap-4 mt-2">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Date & Time</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {order?.createdAt ? new Date(order.createdAt).toLocaleString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true
                    }) : 'N/A'}
                  </p>
                </div>
                <div className="h-8 w-px bg-gray-100" />
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Status</p>
                  <span className="text-sm font-bold text-green-600 uppercase">
                    {order?.status === 'placed' ? 'order placed' : order?.status?.replace('_', ' ')}
                  </span>
                </div>
              </div>
            </div>

            {/* Delivery Instructions Section */}
            {order?.note && (
              <div className="bg-orange-50/50 rounded-xl p-4 border border-orange-100 flex gap-3">
                <MessageSquare className="w-5 h-5 text-[#DC2626] shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-[#DC2626] dark:text-red-400 font-bold uppercase tracking-wider mb-1">Delivery Instructions</p>
                  <p className="text-sm text-gray-800 leading-relaxed font-medium capitalize">
                    {order.note}
                  </p>
                </div>
              </div>
            )}

            {/* Items Section */}
            <div>
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">Order Items</p>
              <div className="space-y-4">
                {order?.items?.map((item, index) => (
                  <div key={index} className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="w-5 h-5 rounded border border-green-600 flex items-center justify-center mt-0.5 shrink-0">
                        <div className="w-2.5 h-2.5 rounded-full bg-green-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-gray-900 leading-tight">{item.name}</p>
                        {item.variantName ? (
                          <p className="text-sm text-gray-500 mt-0.5">{item.variantName}</p>
                        ) : null}
                        <p className="text-sm text-gray-500 mt-0.5">Quantity: {item.quantity}</p>
                      </div>
                    </div>
                    <p className="font-semibold text-gray-900">₹{((item?.price || 0) * (item?.quantity || 0)).toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Bill Summary */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <p className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-1">Bill Summary</p>
              
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">Item Total</span>
                <span className="text-gray-900 font-medium">₹{Number(order?.subtotal || 0).toFixed(2)}</span>
              </div>

              {Number(order?.packagingFee) > 0 && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">Packaging Charges</span>
                  <span className="text-gray-900 font-medium">₹{Number(order.packagingFee).toFixed(2)}</span>
                </div>
              )}

              {Number(order?.platformFee) > 0 && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">Platform Fee</span>
                  <span className="text-gray-900 font-medium">₹{Number(order.platformFee).toFixed(2)}</span>
                </div>
              )}

              {order?.orderType !== "takeaway" && order?.orderType !== "dining" && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">Delivery Fee</span>
                  <span className="text-gray-900 font-medium">₹{Number(order?.deliveryFee || 0).toFixed(2)}</span>
                </div>
              )}

              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-600">GST</span>
                <span className="text-gray-900 font-medium">₹{Number(order?.gst || 0).toFixed(2)}</span>
              </div>

              {Number(order?.discount) > 0 && (
                <div className="flex justify-between items-center text-sm text-green-600 font-medium">
                  <span>Discount Applied</span>
                  <span>-₹{Number(order.discount).toFixed(2)}</span>
                </div>
              )}

              <div className="pt-2 border-t border-gray-200 dark:border-gray-800 flex justify-between items-center">
                <span className="text-base font-bold text-gray-900 dark:text-white flex items-center">
                  Paid
                  {(() => {
                    const method = String(order?.payment?.method || order?.paymentMethod || "online").toLowerCase();
                    if (method === "cash" || method === "cod") {
                      return <span className="text-gray-500 dark:text-gray-400 font-bold ml-1.5">(COD)</span>;
                    }
                    return <span className="text-green-600 dark:text-green-400 font-bold ml-1.5">(Online)</span>;
                  })()}
                </span>
                <span className="text-lg font-bold text-gray-900 dark:text-white">₹{Number(order?.totalAmount || 0).toFixed(2)}</span>
              </div>
            </div>

            {/* Payment Method */}
            {order?.paymentMethod && (
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-gray-600">
                  <Shield className="w-4 h-4" />
                  <span className="text-sm font-medium">Payment Method</span>
                </div>
                <span className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                  {order.paymentMethod}
                </span>
              </div>
            )}
          </div>

          <div className="p-6 border-t border-gray-100">
            <Button
              onClick={() => setShowOrderDetails(false)}
              className="w-full bg-gray-900 text-white font-bold h-12 rounded-xl"
            >
              Okay
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delivery Instructions Modal */}
      <Dialog open={isInstructionsModalOpen} onOpenChange={setIsInstructionsModalOpen}>
        <DialogContent className="sm:max-w-md w-[95vw] rounded-3xl p-6 border-0 shadow-2xl bg-white dark:bg-[#1a1a1a] max-h-[90vh] overflow-y-auto z-[200]">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-xl font-bold text-gray-900 dark:text-white">
              Delivery Instructions
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Add instructions for the delivery partner to help them find your address or know where to leave your order.
            </p>
            <Textarea
              value={deliveryInstructions}
              onChange={(e) => setDeliveryInstructions(e.target.value)}
              placeholder="E.g. Ring the doorbell, leave at the front desk..."
              className="min-h-[120px] resize-none border-gray-200 focus:ring-[#DC2626] rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 text-base"
            />
            <Button 
              onClick={handleUpdateInstructions} 
              disabled={isUpdatingInstructions}
              className="w-full bg-[#DC2626] hover:bg-[#B91C1C] text-white font-bold h-12 rounded-xl border-none transition-colors"
            >
              {isUpdatingInstructions ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Save Instructions"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rating & Feedback Modal */}
      <Dialog open={showRatingModal} onOpenChange={setShowRatingModal}>
        <DialogContent className="sm:max-w-md w-[95vw] rounded-3xl p-6 border-0 shadow-2xl bg-white dark:bg-[#1a1a1a] max-h-[90vh] overflow-y-auto">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Star className="w-6 h-6 text-[#DC2626] fill-[#DC2626]" />
              Rate your Experience
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-2">
            {/* Restaurant Rating */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-gray-800 dark:text-gray-200">How was the food?</p>
                <span className="text-xs px-2 py-0.5 bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400 rounded-full font-medium">Restaurant</span>
              </div>
              <div className="flex justify-center gap-3">
                {[1, 2, 3, 4, 5].map((star) => (
                  <motion.button
                    key={`res-star-${star}`}
                    whileHover={{ scale: 1.15 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setSelectedRestaurantRating(star)}
                    className="p-1"
                  >
                    <Star
                      className={`w-10 h-10 transition-all duration-300 ${
                        star <= selectedRestaurantRating
                          ? "text-yellow-400 fill-yellow-400 drop-shadow-sm"
                          : "text-gray-200 dark:text-gray-800"
                      }`}
                    />
                  </motion.button>
                ))}
              </div>
              <Textarea
                placeholder="Write a quick review for the food (optional)"
                value={restaurantFeedbackText}
                onChange={(e) => setRestaurantFeedbackText(e.target.value)}
                className="min-h-[80px] text-sm bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-800 resize-none rounded-xl text-gray-800 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
              />
            </div>

            {/* Delivery Rating */}
            {hasDeliveryPartner && (
              <div className="space-y-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-gray-800 dark:text-gray-200">How was the delivery?</p>
                  <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400 rounded-full font-medium">Delivery</span>
                </div>
                <div className="flex justify-center gap-3">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <motion.button
                      key={`del-star-${star}`}
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setSelectedDeliveryRating(star)}
                      className="p-1"
                    >
                      <Star
                        className={`w-10 h-10 transition-all duration-300 ${
                          star <= selectedDeliveryRating
                            ? "text-yellow-400 fill-yellow-400 drop-shadow-sm"
                            : "text-gray-200 dark:text-gray-800"
                        }`}
                      />
                    </motion.button>
                  ))}
                </div>
                <Textarea
                  placeholder={`How was ${order?.deliveryPartnerName || 'the rider'}? (optional)`}
                  value={deliveryFeedbackText}
                  onChange={(e) => setDeliveryFeedbackText(e.target.value)}
                  className="min-h-[80px] text-sm bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-800 resize-none rounded-xl text-gray-800 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                />
              </div>
            )}

            <Button
              onClick={handleSubmitRating}
              disabled={submittingRating || selectedRestaurantRating === null || (hasDeliveryPartner && selectedDeliveryRating === null)}
              className="w-full bg-[#DC2626] hover:bg-[#991B1B] text-white font-bold h-14 rounded-2xl shadow-lg mt-4"
            >
              {submittingRating ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Submit Feedback"}
            </Button>
            
            <button
              onClick={() => setShowRatingModal(false)}
              className="w-full text-sm text-gray-400 dark:text-gray-500 font-medium hover:text-gray-600 dark:hover:text-gray-400 transition-colors py-2"
            >
              Maybe later
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}


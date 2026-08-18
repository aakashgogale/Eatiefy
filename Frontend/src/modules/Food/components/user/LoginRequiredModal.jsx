import { X, LogOut } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { useEffect } from "react"

const WarliBorder = () => (
  <svg width="100%" height="45" viewBox="0 0 350 45" preserveAspectRatio="none" className="opacity-[0.12] dark:opacity-20 text-[#DC2626]">
    {/* Chain of traditional Warli figures holding hands */}
    {Array.from({ length: 9 }).map((_, index) => {
      const x = 25 + index * 37;
      return (
        <g key={index} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
          {/* Head */}
          <circle cx={x} cy="11" r="3.5" fill="currentColor" />
          {/* Body (Hourglass shape) */}
          <path d={`M ${x - 5} 17 L ${x + 5} 17 L ${x} 23 Z`} fill="currentColor" />
          <path d={`M ${x - 5} 29 L ${x + 5} 29 L ${x} 23 Z`} fill="currentColor" />
          {/* Hands holding each other */}
          {index > 0 && (
            <path d={`M ${x - 5} 19 Q ${x - 18.5} 13 ${x - 32} 19`} />
          )}
          {/* Legs */}
          <path d={`M ${x - 2} 29 L ${x - 5} 37`} />
          <path d={`M ${x + 2} 29 L ${x + 5} 37`} />
        </g>
      );
    })}
  </svg>
);

export default function LoginRequiredModal({ isOpen, onClose }) {
  const navigate = useNavigate()

  // Prevent background scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = "unset"
    }
    return () => {
      document.body.style.overflow = "unset"
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleLoginClick = () => {
    // Navigate directly to the user login page to trigger instant transition
    navigate("/user/auth/login")
  }

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      />
      
      {/* Modal Container */}
      <div className="relative w-full max-w-[380px] bg-[#FCF9F2] dark:bg-[#1C1613] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-[#EBE1CD] dark:border-[#382D24] overflow-hidden transform transition-all duration-300 scale-100 flex flex-col items-center p-6 text-center animate-in fade-in zoom-in-95 duration-200">
        
        {/* Top-Right Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-[#EBE1CD]/40 dark:hover:bg-[#382D24]/40 text-[#DC2626] dark:text-[#EAE0D5] transition-colors"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Warli Art Top Border Decoration */}
        <div className="w-full absolute top-0 left-0 right-0 pointer-events-none select-none">
          <div className="h-[2px] w-full bg-[#DC2626] opacity-30" />
        </div>

        {/* Icon Container (rounded box with arrow pointing out of bracket) */}
        <div className="mt-6 mb-5 flex items-center justify-center w-16 h-16 rounded-2xl bg-[#EBE1CD]/30 dark:bg-[#382D24]/30 border border-[#EBE1CD] dark:border-[#382D24] shadow-sm">
          <LogOut className="w-7 h-7 text-[#DC2626] dark:text-[#E8AF9D]" />
        </div>

        {/* Heading */}
        <h3 className="text-xl font-black tracking-wider text-[#DC2626] dark:text-[#F3D7C9] uppercase mb-3 font-serif">
          LOGIN REQUIRED
        </h3>

        {/* Caption */}
        <p className="text-sm md:text-base text-[#615446] dark:text-[#C5B39E] font-medium leading-relaxed max-w-[280px] mb-6">
          Please login to continue your delicious journey
        </p>

        {/* Action Pill Button */}
        <button
          onClick={handleLoginClick}
          className="w-full py-3.5 px-6 rounded-full bg-[#DC2626] hover:bg-[#B91C1C] active:bg-[#991B1B] text-white font-bold tracking-widest text-sm shadow-md hover:shadow-lg transition-all transform active:scale-98 mb-6"
        >
          LOGIN / SIGN UP
        </button>

        {/* Bottom Warli Border Graphic */}
        <div className="w-full mt-2 pointer-events-none select-none">
          <WarliBorder />
        </div>
      </div>
    </div>
  )
}

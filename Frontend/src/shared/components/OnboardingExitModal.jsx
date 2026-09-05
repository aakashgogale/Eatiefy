import { useEffect } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { LogOut } from "lucide-react"

const THEMES = {
  delivery: {
    header: "bg-gradient-to-br from-[#0E4B9C] to-[#021024]",
    stay: "bg-[#00B761] hover:bg-[#00A055] shadow-[#00B761]/20",
  },
  restaurant: {
    header: "bg-gradient-to-br from-[#B80B3D] to-[#66001D]",
    stay: "bg-green-700 hover:bg-green-800 shadow-green-700/20",
  },
}

export default function OnboardingExitModal({
  open = false,
  onStay,
  onExit,
  title = "Exit Onboarding?",
  message = "Are you sure you want to exit? Your progress may not be saved.",
  stayLabel = "Stay Here",
  exitLabel = "Exit Anyway",
  theme = "delivery",
}) {
  const palette = THEMES[theme] || THEMES.delivery

  useEffect(() => {
    if (!open) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onStay}
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-[320px] bg-white dark:bg-[#1a1a1a] rounded-3xl shadow-2xl overflow-hidden border border-gray-100 dark:border-gray-800 relative z-10"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={`${palette.header} p-6 text-center relative`}>
              <div className="absolute top-[-20%] right-[-10%] w-28 h-28 bg-white/10 rounded-full blur-2xl pointer-events-none" />
              <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center mx-auto mb-3 border border-white/30">
                <LogOut className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
              <p className="text-white/85 text-[13px] leading-relaxed">{message}</p>
            </div>

            <div className="p-6 pt-5 space-y-3 bg-white dark:bg-[#1a1a1a]">
              <button
                type="button"
                onClick={onStay}
                className={`w-full h-12 text-white font-semibold text-[15px] rounded-2xl shadow-lg transition-all active:scale-[0.98] ${palette.stay}`}
              >
                {stayLabel}
              </button>
              <button
                type="button"
                onClick={onExit}
                className="w-full h-12 bg-red-600 hover:bg-red-700 text-white font-semibold text-[15px] rounded-2xl shadow-lg shadow-red-600/20 transition-all active:scale-[0.98]"
              >
                {exitLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

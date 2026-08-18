import React, { useState, useEffect } from 'react'
import AppRoutes from './routes'
import SplashScreen from '@/shared/components/SplashScreen.jsx'

function App() {
  const [showSplash, setShowSplash] = useState(() => {
    // sessionStorage persists across refreshes but clears when the tab/app is closed
    return !sessionStorage.getItem('ometto_session_splash_shown')
  })

  const [isLoading, setIsLoading] = useState(false)

  const handleSplashFinish = () => {
    sessionStorage.setItem('ometto_session_splash_shown', 'true')
    setShowSplash(false)
  }

  // Normal Loading Spinner (if needed in future)
  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-white dark:bg-[#0a0a0a]">
        <div className="relative w-16 h-16 flex items-center justify-center">
          <div className="absolute inset-0 border-4 border-[#DC2626]/10 rounded-full" />
          <div className="absolute inset-0 border-4 border-t-[#DC2626] rounded-full animate-spin" />
        </div>
        <h1 className="text-2xl font-black text-[#DC2626] italic uppercase tracking-tighter mt-6">OMETTO</h1>
      </div>
    )
  }

  return (
    <>
      {/* {showSplash && <SplashScreen onFinish={handleSplashFinish} />} */}
      <AppRoutes />
    </>
  )
}

export default App

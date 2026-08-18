import { useCallback, useEffect, useState } from "react"

/**
 * Guards onboarding exit on the first step only.
 * Later steps call onPreviousStep so saved progress is kept when navigating back.
 */
export default function useOnboardingExitGuard({
  isFirstStep,
  onPreviousStep,
  onExit,
  hasUnsavedProgress = () => true,
}) {
  const [showExitModal, setShowExitModal] = useState(false)

  const handleStay = useCallback(() => {
    setShowExitModal(false)
  }, [])

  const handleExit = useCallback(() => {
    onExit?.()
  }, [onExit])

  const requestExit = useCallback(() => {
    if (hasUnsavedProgress()) {
      setShowExitModal(true)
      return
    }

    onExit?.()
  }, [hasUnsavedProgress, onExit])

  const handleBack = useCallback(() => {
    if (isFirstStep) {
      requestExit()
      return
    }

    onPreviousStep?.()
  }, [isFirstStep, onPreviousStep, requestExit])

  useEffect(() => {
    window.history.pushState(null, "", window.location.href)

    const handlePopState = () => {
      window.history.pushState(null, "", window.location.href)

      if (isFirstStep) {
        requestExit()
        return
      }

      onPreviousStep?.()
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [isFirstStep, onPreviousStep, requestExit])

  return {
    showExitModal,
    handleBack,
    handleStay,
    handleExit,
    requestExit,
  }
}

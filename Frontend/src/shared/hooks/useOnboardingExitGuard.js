import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Guards onboarding exit on the first step only.
 * Later steps call onPreviousStep so saved progress is kept when navigating back.
 */
export default function useOnboardingExitGuard({
  isFirstStep,
  onPreviousStep,
  onExit,
  hasUnsavedProgress = () => true,
  enabled = true,
}) {
  const [showExitModal, setShowExitModal] = useState(false)
  const isFirstStepRef = useRef(isFirstStep)
  const onPreviousStepRef = useRef(onPreviousStep)
  const onExitRef = useRef(onExit)
  const hasUnsavedProgressRef = useRef(hasUnsavedProgress)
  const enabledRef = useRef(enabled)

  isFirstStepRef.current = isFirstStep
  onPreviousStepRef.current = onPreviousStep
  onExitRef.current = onExit
  hasUnsavedProgressRef.current = hasUnsavedProgress
  enabledRef.current = enabled

  const handleStay = useCallback(() => {
    setShowExitModal(false)
  }, [])

  const handleExit = useCallback(() => {
    setShowExitModal(false)
    onExitRef.current?.()
  }, [])

  const requestExit = useCallback(() => {
    if (hasUnsavedProgressRef.current?.()) {
      setShowExitModal(true)
      return
    }

    onExitRef.current?.()
  }, [])

  const handleBack = useCallback(() => {
    if (isFirstStepRef.current) {
      requestExit()
      return
    }

    onPreviousStepRef.current?.()
  }, [requestExit])

  useEffect(() => {
    if (!enabled) return undefined

    // Push initial guard state ONCE on mount so popstate is captured
    try {
      window.history.pushState({ onboardingGuard: true }, "", window.location.href)
    } catch {}

    const handlePopState = () => {
      if (!enabledRef.current) return

      // Maintain trap state while inside onboarding
      try {
        window.history.pushState({ onboardingGuard: true }, "", window.location.href)
      } catch {}

      if (isFirstStepRef.current) {
        requestExit()
        return
      }

      onPreviousStepRef.current?.()
    }

    window.addEventListener("popstate", handlePopState)
    return () => {
      window.removeEventListener("popstate", handlePopState)
    }
  }, [enabled, requestExit])

  return {
    showExitModal,
    handleBack,
    handleStay,
    handleExit,
    requestExit,
  }
}


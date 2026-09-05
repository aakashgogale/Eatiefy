import { useCallback } from "react"
import { useNavigate } from "react-router-dom"
import useOnboardingExitGuard from "@/shared/hooks/useOnboardingExitGuard"
import { clearDeliveryOnboardingData } from "../utils/deliveryOnboardingStorage"

export default function useDeliveryOnboardingExitGuard(step, hasUnsavedProgress) {
  const navigate = useNavigate()

  const onExit = useCallback(() => {
    clearDeliveryOnboardingData()
    navigate("/food/delivery/login", { replace: true })
  }, [navigate])

  const onPreviousStep = useCallback(() => {
    navigate("/food/delivery/signup/details")
  }, [navigate])

  return useOnboardingExitGuard({
    isFirstStep: step === "details",
    onPreviousStep,
    onExit,
    hasUnsavedProgress:
      step === "details" && typeof hasUnsavedProgress === "function"
        ? hasUnsavedProgress
        : () => false,
  })
}

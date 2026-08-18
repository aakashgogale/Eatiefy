import CMSPage from "@food/components/user/CMSPage"
import { API_ENDPOINTS } from "@food/api/config"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"

export default function TermsAndConditionsPage() {
  const goBack = useRestaurantBackNavigation()
  return (
    <CMSPage
      endpoint={API_ENDPOINTS.ADMIN.TERMS_PUBLIC}
      title="Terms of Service"
      module="RESTAURANT"
      goBack={goBack}
      fallbackPath="/food/restaurant"
    />
  )
}








import CMSPage from "@food/components/user/CMSPage"
import { API_ENDPOINTS } from "@food/api/config"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"

export default function PrivacyPolicyPage() {
  const goBack = useRestaurantBackNavigation()
  return (
    <CMSPage
      endpoint={API_ENDPOINTS.ADMIN.PRIVACY_PUBLIC}
      title="Privacy Policy"
      module="RESTAURANT"
      goBack={goBack}
      fallbackPath="/food/restaurant"
    />
  )
}








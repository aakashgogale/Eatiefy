import CMSPage from "@food/components/user/CMSPage"
import { API_ENDPOINTS } from "@food/api/config"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"

export default function RestaurantCMSHelpSupportPage() {
  const goBack = useRestaurantBackNavigation()
  return (
    <CMSPage
      endpoint={API_ENDPOINTS.ADMIN.SUPPORT_RESTAURANT_PUBLIC}
      title="Help & Support"
      module="RESTAURANT"
      goBack={goBack}
      fallbackPath="/food/restaurant"
    />
  )
}








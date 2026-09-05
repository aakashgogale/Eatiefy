import CMSPage from "@food/components/user/CMSPage"
import { API_ENDPOINTS } from "@food/api/config"
import useDeliveryBackNavigation from "../hooks/useDeliveryBackNavigation"

export default function PrivacyPolicyV2() {
  const goBack = useDeliveryBackNavigation()
  return (
    <CMSPage
      endpoint={API_ENDPOINTS.ADMIN.PRIVACY_PUBLIC}
      title="Privacy Policy"
      module="DELIVERY"
      goBack={goBack}
      fallbackPath="/food/delivery"
    />
  )
}

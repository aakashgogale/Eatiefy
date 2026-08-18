import CMSPage from "@food/components/user/CMSPage"
import { API_ENDPOINTS } from "@food/api/config"
import useDeliveryBackNavigation from "../hooks/useDeliveryBackNavigation"

export default function DeliveryCMSHelpSupportPage() {
  const goBack = useDeliveryBackNavigation()
  return (
    <CMSPage
      endpoint={API_ENDPOINTS.ADMIN.SUPPORT_DELIVERY_PUBLIC}
      title="Help & Support"
      module="DELIVERY"
      goBack={goBack}
      fallbackPath="/food/delivery"
    />
  )
}

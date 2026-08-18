import CMSPage from "@food/components/user/CMSPage"
import { API_ENDPOINTS } from "@food/api/config"
import useDeliveryBackNavigation from "../hooks/useDeliveryBackNavigation"

export default function TermsAndConditionsV2() {
  const goBack = useDeliveryBackNavigation()
  return (
    <CMSPage
      endpoint={API_ENDPOINTS.ADMIN.TERMS_PUBLIC}
      title="Terms of Service"
      module="DELIVERY"
      goBack={goBack}
      fallbackPath="/food/delivery"
    />
  )
}

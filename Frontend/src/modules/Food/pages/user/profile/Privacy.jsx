import CMSPage from "@food/components/user/CMSPage"
import { API_ENDPOINTS } from "@food/api/config"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"

export default function Privacy() {
  const goBack = useAppBackNavigation()
  return (
    <CMSPage
      endpoint={API_ENDPOINTS.ADMIN.PRIVACY_PUBLIC}
      title="Privacy Policy"
      module="USER"
      goBack={goBack}
      fallbackPath="/food/user/auth/login"
    />
  )
}

import CMSPage from "@food/components/user/CMSPage"
import { API_ENDPOINTS } from "@food/api/config"
import useAppBackNavigation from "@food/hooks/useAppBackNavigation"

export default function Terms() {
  const goBack = useAppBackNavigation()
  return (
    <CMSPage
      endpoint={API_ENDPOINTS.ADMIN.TERMS_PUBLIC}
      title="Terms of Service"
      module="USER"
      goBack={goBack}
      fallbackPath="/food/user/auth/login"
    />
  )
}

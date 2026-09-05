import CMSPage from "@food/components/user/CMSPage"
import { API_ENDPOINTS } from "@food/api/config"

import useAppBackNavigation from "@food/hooks/useAppBackNavigation"

export default function UserCMSHelpSupportPage() {
  const goBack = useAppBackNavigation()
  return (
    <CMSPage
      endpoint={API_ENDPOINTS.ADMIN.SUPPORT_USER_PUBLIC}
      title="Help & Support"
      module="USER"
      goBack={goBack}
      fallbackPath="/food/user/auth/login"
    />
  )
}

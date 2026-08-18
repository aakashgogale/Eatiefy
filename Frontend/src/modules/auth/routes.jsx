import React, { Suspense, lazy } from "react"
import { Routes, Route, Navigate } from "react-router-dom"
import Loader from "@food/components/Loader"
import AuthRedirect from "@food/components/AuthRedirect"

const Login = lazy(() => import("./pages/Login"))
const Portal = lazy(() => import("./pages/Portal"))

export default function AuthRoutes() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="login" element={<AuthRedirect module="user"><Login animate={false} /></AuthRedirect>} />
        <Route path="portal" element={<Navigate to="/food/user" replace />} />
        <Route path="*" element={<Navigate to="/user/auth/login" replace />} />
      </Routes>
    </Suspense>
  )
}

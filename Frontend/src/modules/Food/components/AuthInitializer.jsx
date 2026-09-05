import { getModuleToken } from '@food/utils/auth';

/**
 * AuthInitializer - Recovers auth state from localStorage on app initialization.
 * localStorage is synchronous — no async hydration needed.
 * We simply render children immediately. ProtectedRoute handles auth checks per-route.
 */
export default function AuthInitializer({ children }) {
  // localStorage is synchronous. Token reads in ProtectedRoute/isModuleAuthenticated
  // happen synchronously on first render — no "hydration" delay is needed.
  // Returning null here caused a white flash; just pass through immediately.
  return children;
}

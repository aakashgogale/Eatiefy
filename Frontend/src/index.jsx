import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './app/App.jsx'
import { isModuleAuthenticated } from './modules/Food/utils/auth.js'
import './shared/styles/global.css'

const NATIVE_LAST_ROUTE_KEY = 'native_last_route'

// ─── Quick-spicy Food Module Initialization ───────────────────────────────────

// Load food module business settings (favicon, title) — non-critical
import('./modules/Food/utils/businessSettings.js')
  .then(({ loadBusinessSettings }) => loadBusinessSettings())
  .catch(() => { /* Silently fail — settings load when admin authenticates */ })

// Apply saved theme
const savedTheme = localStorage.getItem('appTheme') || 'light'
if (savedTheme === 'dark') {
  document.documentElement.classList.add('dark')
} else {
  document.documentElement.classList.remove('dark')
}

// Track user interaction for navigator.vibrate / audio autoplay
if (typeof window !== 'undefined') {
  window.__userHasInteracted = false
  const handleInteraction = () => {
    window.__userHasInteracted = true
    window.removeEventListener('pointerdown', handleInteraction)
    window.removeEventListener('keydown', handleInteraction)
    window.removeEventListener('touchstart', handleInteraction)
    window.removeEventListener('click', handleInteraction)
  }
  window.addEventListener('pointerdown', handleInteraction, { passive: true })
  window.addEventListener('keydown', handleInteraction, { passive: true })
  window.addEventListener('touchstart', handleInteraction, { passive: true })
  window.addEventListener('click', handleInteraction, { passive: true })
}

function isNativeLikeShell() {
  if (typeof window === 'undefined') return false

  const protocol = String(window.location?.protocol || '').toLowerCase()
  const userAgent = String(window.navigator?.userAgent || '').toLowerCase()

  return (
    Boolean(window.flutter_inappwebview) ||
    Boolean(window.ReactNativeWebView) ||
    protocol === 'file:' ||
    userAgent.includes(' wv') ||
    userAgent.includes('; wv')
  )
}

function resolveNativeInitialRoute() {
  if (typeof window === 'undefined') return '/food/user'

  const rawPathname = String(window.location?.pathname || '')
  const pathname = rawPathname.replace(/\/index\.html$/i, '') || '/'
  const storedRoute = String(localStorage.getItem(NATIVE_LAST_ROUTE_KEY) || '').trim()

  if (pathname.startsWith('/food/')) return pathname
  if (pathname.startsWith('/restaurant')) return `/food${pathname}`
  if (pathname.startsWith('/delivery')) return `/food${pathname}`
  if (pathname.startsWith('/user')) return `/food${pathname}`
  if (pathname.startsWith('/admin')) return pathname
  if (storedRoute.startsWith('/food/') || storedRoute.startsWith('/admin')) {
    return storedRoute
  }

  if (isModuleAuthenticated('restaurant')) return '/food/restaurant'
  if (isModuleAuthenticated('delivery')) return '/food/delivery'
  if (isModuleAuthenticated('admin')) return '/admin'
  if (isModuleAuthenticated('user')) return '/food/user'

  return '/food/user'
}

function bootstrapNativeHashRoute() {
  if (!isNativeLikeShell() || typeof window === 'undefined') return

  const currentHash = String(window.location?.hash || '')
  if (currentHash.startsWith('#/')) return

  const targetPath = resolveNativeInitialRoute()
  const search = String(window.location?.search || '')
  window.history.replaceState(null, '', `#${targetPath}${search}`)
}

bootstrapNativeHashRoute()

// Standard web browser redirect for raw paths to prevent React Router unmounting crashes
if (typeof window !== 'undefined') {
  const rawPath = window.location.pathname
  const isRestaurant = rawPath === '/restaurant' || rawPath.startsWith('/restaurant/')
  const isDelivery = rawPath === '/delivery' || rawPath.startsWith('/delivery/')

  if ((isRestaurant || isDelivery) && !isNativeLikeShell()) {
    window.location.replace(`/food${rawPath}${window.location.search}`)
  }
}

// ─── DOM Node Safe Patch (Google Translate / Extension DOM Mutation Fix) ──────
if (typeof window !== 'undefined' && typeof Node !== 'undefined') {
  const originalRemoveChild = Node.prototype.removeChild
  Node.prototype.removeChild = function (child) {
    if (child && child.parentNode !== this) {
      if (child.parentNode) {
        return originalRemoveChild.call(child.parentNode, child)
      }
      return child
    }
    return originalRemoveChild.call(this, child)
  }

  const originalInsertBefore = Node.prototype.insertBefore
  Node.prototype.insertBefore = function (newNode, referenceNode) {
    if (referenceNode && referenceNode.parentNode !== this) {
      if (referenceNode.parentNode) {
        return originalInsertBefore.call(referenceNode.parentNode, newNode, referenceNode)
      }
      return this.appendChild(newNode)
    }
    return originalInsertBefore.call(this, newNode, referenceNode)
  }
}

// ─── Suppress known non-critical errors ──────────────────────────────────────

const originalError = console.error
console.error = (...args) => {
  const errorStr = args.join(' ')

  if (typeof args[0] === 'string' && (
    args[0].includes('chrome-extension://') ||
    args[0].includes('_$initialUrl') ||
    args[0].includes('_$onReInit') ||
    args[0].includes('_$bindListeners')
  )) return

  if (
    errorStr.includes('Timeout expired') ||
    errorStr.includes('GeolocationPositionError') ||
    errorStr.includes('Geolocation error') ||
    errorStr.includes('User denied Geolocation') ||
    errorStr.includes('permission denied') ||
    errorStr.includes("Failed to execute 'removeChild'") ||
    errorStr.includes("Failed to execute 'insertBefore'") ||
    errorStr.includes('The node to be removed is not a child of this node')
  ) return

  const hasNetworkError = args.some(arg =>
    arg && typeof arg === 'object' &&
    (arg.name === 'AxiosError') &&
    (arg.code === 'ERR_NETWORK' || arg.message === 'Network Error')
  )
  if (hasNetworkError) return

  if (
    errorStr.includes('🌐 Network Error') ||
    errorStr.includes('Network Error - Backend server may not be running') ||
    (errorStr.includes('ERR_NETWORK') && errorStr.includes('AxiosError'))
  ) return

  if (
    errorStr.includes('Restaurant Socket connection error') ||
    errorStr.includes('xhr poll error') ||
    (errorStr.includes('WebSocket connection to') && errorStr.includes('socket.io') && errorStr.includes('failed'))
  ) return

  originalError.apply(console, args)
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    const errorMsg = event?.error?.message || event?.message || ''
    if (
      errorMsg.includes("Failed to execute 'removeChild'") ||
      errorMsg.includes("Failed to execute 'insertBefore'") ||
      errorMsg.includes('The node to be removed is not a child of this node')
    ) {
      event.preventDefault()
      if (event.stopImmediatePropagation) event.stopImmediatePropagation()
    }
  }, true)

  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason || event
    const errorMsg = error?.message || String(error) || ''
    const errorName = error?.name || ''
    if (
      errorMsg.includes('Timeout expired') ||
      errorMsg.includes('User denied Geolocation') ||
      errorMsg.includes('permission denied') ||
      errorMsg.includes("Failed to execute 'removeChild'") ||
      errorMsg.includes("Failed to execute 'insertBefore'") ||
      errorMsg.includes('The node to be removed is not a child of this node') ||
      errorName === 'GeolocationPositionError'
    ) {
      event.preventDefault()
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────

import { AppProviders } from './app/providers.jsx'
import { installNativeApiErrorBridge } from './shared/utils/apiError.js'

installNativeApiErrorBridge()

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

createRoot(rootElement).render(
  <AppProviders>
    <App />
  </AppProviders>
)

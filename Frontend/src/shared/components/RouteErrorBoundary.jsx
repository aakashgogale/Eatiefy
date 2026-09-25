import React from "react"
import { Link } from "react-router-dom"
import { reportError, isChunkLoadError } from "@/shared/utils/errorReporter"

/**
 * Catches runtime errors from the routes it wraps.
 *
 * Without a boundary anywhere above the routes, a single thrown error unmounts
 * the whole React tree and the app goes blank — which is what "the app crashes"
 * looks like to a user. This keeps the shell alive, shows a recoverable error
 * state, and reports the actual error so the underlying bug is identifiable
 * instead of invisible.
 *
 * Optional props (all backwards compatible with the bare usage):
 * - scope       tag used when the error is reported
 * - resetKey    clears the error when it changes (pass the pathname, so leaving
 *               a broken screen does not keep showing the fallback everywhere)
 * - title / message   fallback copy
 * - actions     [{ label, to }] links shown instead of the default "Go back"
 * - showDetails show the raw error text (default true)
 */
export default class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    reportError(error, {
      scope: this.props.scope || "RouteErrorBoundary",
      componentStack: info?.componentStack,
      path: typeof window !== "undefined" ? window.location.pathname : undefined,
    })
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  handleRetry = () => {
    // React.lazy caches a failed chunk import, so re-rendering would only fail
    // again - a reload downloads the chunk afresh.
    if (isChunkLoadError(this.state.error)) {
      window.location.reload()
      return
    }
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const {
      title = "Something went wrong",
      message = "This screen could not be opened. You can try again, or go back and open it once more.",
      actions,
      showDetails = true,
    } = this.props
    const hasActions = Array.isArray(actions) && actions.length > 0
    const secondaryClass =
      "flex-1 rounded-xl border border-slate-300 dark:border-zinc-700 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 text-center active:scale-[0.98]"

    return (
      <div role="alert" className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#141414] px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{message}</p>

          {showDetails ? (
            <p className="mt-3 break-words rounded-lg bg-slate-50 dark:bg-zinc-800 p-3 text-left text-xs font-mono text-slate-500 dark:text-slate-400">
              {String(error?.message || error)}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={this.handleRetry}
              className="flex-1 rounded-xl bg-slate-900 dark:bg-white py-3 text-sm font-semibold text-white dark:text-slate-900 active:scale-[0.98]"
            >
              Try again
            </button>
            {hasActions ? (
              actions.map((action) => (
                <Link key={action.to} to={action.to} replace className={secondaryClass}>
                  {action.label}
                </Link>
              ))
            ) : (
              <button type="button" onClick={() => window.history.back()} className={secondaryClass}>
                Go back
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }
}

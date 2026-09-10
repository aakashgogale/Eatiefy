import React from "react"

/**
 * Catches runtime errors from the routes it wraps.
 *
 * Without a boundary anywhere above the routes, a single thrown error unmounts
 * the whole React tree and the app goes blank — which is what "the app crashes"
 * looks like to a user. This keeps the shell alive, shows a recoverable error
 * state, and surfaces the actual message so the underlying bug is identifiable
 * instead of invisible.
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
    // eslint-disable-next-line no-console
    console.error("[RouteErrorBoundary]", error, info?.componentStack)
  }

  handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-600">
            This screen could not be opened. You can try again, or go back and open it once more.
          </p>

          <p className="mt-3 break-words rounded-lg bg-slate-50 p-3 text-left text-xs font-mono text-slate-500">
            {String(error?.message || error)}
          </p>

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={this.handleRetry}
              className="flex-1 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white active:scale-[0.98]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.history.back()}
              className="flex-1 rounded-xl border border-slate-300 py-3 text-sm font-semibold text-slate-700 active:scale-[0.98]"
            >
              Go back
            </button>
          </div>
        </div>
      </div>
    )
  }
}

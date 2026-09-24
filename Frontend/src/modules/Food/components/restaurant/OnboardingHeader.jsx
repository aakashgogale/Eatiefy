import { ArrowLeft, X } from "lucide-react"

/**
 * The one header for every restaurant onboarding screen.
 *
 * Each screen used to carry its own markup, so the bar changed height
 * (py-4 vs py-3), the back control changed shape (a 36px circle vs a bare
 * icon) and the title changed size (text-sm vs text-lg) as the user moved
 * from a step to the payment page. Every screen now renders this instead, so
 * spacing, the safe-area inset, the back button and the title alignment are
 * defined once.
 *
 * `variant="close"` shows an X (leaving onboarding altogether) instead of the
 * back arrow; `actions` holds anything that belongs on the right, such as the
 * Edit button on the review step.
 */
export default function OnboardingHeader({
  title = "Restaurant onboarding",
  subtitle = "",
  onBack,
  variant = "back",
  backLabel,
  actions = null,
  className = "",
}) {
  const Icon = variant === "close" ? X : ArrowLeft
  const label = backLabel || (variant === "close" ? "Close onboarding" : "Go back")

  return (
    <header
      className={`sticky top-0 z-40 bg-white border-b border-gray-200 px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:py-5 sm:pt-[max(1.25rem,env(safe-area-inset-top))] ${className}`}
    >
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={label}
              className="w-9 h-9 shrink-0 flex items-center justify-center bg-gray-50 hover:bg-gray-100 border border-gray-200/80 rounded-full shadow-sm transition-all duration-200 active:scale-90 hover:shadow"
            >
              <Icon className="w-[18px] h-[18px] text-gray-700 stroke-[2.5]" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-black">{title}</h1>
            {subtitle ? (
              <p className="truncate text-xs text-gray-500">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  )
}

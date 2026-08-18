"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"

import { cn } from "@food/utils/utils"

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "border-input bg-background text-foreground data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "popper",
  align = "center",
  scrollToTopOnOpen = false,
  onOpenAutoFocus,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
  /** Start list at top instead of jumping/scrolling to the selected option */
  scrollToTopOnOpen?: boolean
}) {
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  // Keep menu invisible until Radix's post-open scroll-to-selected is neutralized
  const [revealed, setRevealed] = React.useState(!scrollToTopOnOpen)

  const resetScrollToTop = React.useCallback((node?: HTMLDivElement | null) => {
    const content = node ?? contentRef.current
    if (!content) return
    content.querySelectorAll('[role="option"]').forEach((el) => {
      const option = el as HTMLElement
      option.scrollIntoView = () => {}
      if (!(option as HTMLElement & { __rgFocusPatched?: boolean }).__rgFocusPatched) {
        const nativeFocus = option.focus.bind(option)
        option.focus = ((opts?: FocusOptions) => {
          nativeFocus({ ...opts, preventScroll: true })
        }) as typeof option.focus
        ;(option as HTMLElement & { __rgFocusPatched?: boolean }).__rgFocusPatched = true
      }
    })
    content.scrollTop = 0
    const viewport = content.querySelector(
      "[data-radix-select-viewport]"
    ) as HTMLElement | null
    if (viewport) viewport.scrollTop = 0
  }, [])

  React.useLayoutEffect(() => {
    if (!scrollToTopOnOpen) return
    resetScrollToTop()
  }, [scrollToTopOnOpen, resetScrollToTop])

  // Child (Radix) effects run first and may scroll to selected — reset then reveal
  React.useEffect(() => {
    if (!scrollToTopOnOpen) {
      setRevealed(true)
      return
    }
    resetScrollToTop()
    setRevealed(true)
  }, [scrollToTopOnOpen, resetScrollToTop])

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={(node) => {
          contentRef.current = node
          if (scrollToTopOnOpen && node) resetScrollToTop(node)
        }}
        data-slot="select-content"
        className={cn(
          "select-menu-scroll z-50 max-h-48 overflow-y-scroll rounded-md border border-border bg-popover text-popover-foreground shadow-lg",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          scrollToTopOnOpen && !revealed && "opacity-0 pointer-events-none",
          className
        )}
        position={position}
        align={align}
        {...props}
        onOpenAutoFocus={(event) => {
          if (scrollToTopOnOpen) {
            event.preventDefault()
            resetScrollToTop(event.currentTarget as HTMLDivElement)
          }
          onOpenAutoFocus?.(event)
        }}
      >
        <SelectPrimitive.Viewport
          className={cn(
            "h-auto max-h-none w-full p-1",
            position === "popper" &&
              "min-w-[var(--radix-select-trigger-width)]",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2 border-b border-border last:border-b-0",
        className
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}

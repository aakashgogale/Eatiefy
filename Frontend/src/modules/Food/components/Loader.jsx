import { Loader2 } from "lucide-react"

export default function Loader() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-[#0a0a0a]">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 border-4 border-[#DC2626]/10 rounded-full" />
        <div className="absolute inset-0 border-4 border-t-[#DC2626] rounded-full animate-spin" />
      </div>
    </div>
  )
}

import { LogOut } from 'lucide-react'

/** Always in the same corner, on every screen behind the calculator. One tap returns to it. */
export function QuickExit({ onExit }: { onExit: () => void }) {
  return (
    <button
      type="button"
      onClick={onExit}
      aria-label="Quick exit to calculator"
      className="fixed right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[1100] inline-flex min-h-11 items-center gap-2 rounded-full bg-ink px-4 text-[15px] font-semibold text-white shadow-raised transition-[filter] duration-150 hover:brightness-125"
    >
      <LogOut size={18} aria-hidden="true" />
      Exit
    </button>
  )
}

export function QuickExit({ onExit }: { onExit: () => void }) {
  return (
    <button type="button" className="quick-exit" onClick={onExit} aria-label="Quick exit to calculator">
      Exit
    </button>
  )
}

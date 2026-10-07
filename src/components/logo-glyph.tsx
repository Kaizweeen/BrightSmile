/** The DentaSync check-smile. Draws in currentColor; the caller supplies the tile and size. */
export function LogoGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="42 42 176 176" fill="none" stroke="currentColor" strokeWidth={26} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M64 120C76 172 112 192 140 168L196 88" />
    </svg>
  );
}

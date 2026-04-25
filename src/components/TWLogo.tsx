export function TWLogo({ size = 96 }: { size?: number }) {
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <div
        className="absolute inset-0 rounded-full blur-2xl opacity-60"
        style={{ background: "radial-gradient(circle, oklch(0.92 0.21 122 / 0.6), transparent 70%)" }}
      />
      <svg viewBox="0 0 100 100" width={size} height={size} className="relative">
        <defs>
          <linearGradient id="twg" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#E0FF6B" />
            <stop offset="100%" stopColor="#9CD200" />
          </linearGradient>
        </defs>
        <text x="50%" y="58%" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="900" fontSize="48" fill="url(#twg)" letterSpacing="-3">
          TW
        </text>
      </svg>
    </div>
  );
}

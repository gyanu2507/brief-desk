export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0, borderRadius: 8 }}
    >
      <defs>
        <linearGradient id="bdg" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1d4ed8" />
          <stop offset="1" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#bdg)" />
      <path
        d="M18 14h20l8 8v28a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z"
        fill="#fff"
        opacity={0.96}
      />
      <path d="M38 14v8h8" fill="none" stroke="#bfdbfe" strokeWidth="2.5" strokeLinejoin="round" />
      <path
        d="M22 30h16M22 36h12M22 42h14"
        stroke="#1d4ed8"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <rect x="16" y="50" width="32" height="3.5" rx="1.75" fill="#fff" opacity={0.55} />
    </svg>
  );
}

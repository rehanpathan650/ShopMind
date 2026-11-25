export const Logo = ({ compact = false }) => (
  <span className="logo">
    <span className="logo-mark" aria-hidden>
      <svg viewBox="0 0 24 24" width="22" height="22">
        <rect x="1" y="1" width="22" height="22" rx="6" fill="currentColor" />
        <path d="M7 9.5h10M7 14.5h6" stroke="var(--logo-ink)" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="17" cy="14.5" r="1.6" fill="var(--accent)" />
      </svg>
    </span>
    {!compact && <span className="logo-word">ShopMind</span>}
  </span>
);

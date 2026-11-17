// Simple placeholders with the same props as the real art in src/ui/art/.
const EMOTION_COLOR: Record<string, string> = {
  calm: '#15803d',
  worried: '#d97706',
  panicked: '#dc2626',
  pain: '#dc2626',
  neutral: '#6b7280',
};

export function Scene({ scene, casualty, className }: { scene: string; casualty: string; className?: string }) {
  return (
    <div
      className={`scene-fallback ${className ?? ''}`}
      role="img"
      aria-label={`Scene ${scene}, casualty ${casualty}`}
      data-testid="scene-art"
    >
      <svg viewBox="0 0 320 140" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="320" height="140" fill="#bbf7d0" />
        <rect y="100" width="320" height="40" fill="#86efac" />
        <circle cx="270" cy="30" r="16" fill="#facc15" />
        <rect x="60" y="85" width="80" height="14" rx="7" fill="#1f2937" opacity="0.8" />
        <circle cx="150" cy="88" r="9" fill="#92400e" />
      </svg>
      <span className="scene-fallback-label">
        {scene} / {casualty}
      </span>
    </div>
  );
}

export function Avatar({ role, emotion, size = 44 }: { role: string; emotion: string; size?: number }) {
  const ring = EMOTION_COLOR[emotion] ?? EMOTION_COLOR.neutral;
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '9999px',
        border: `4px solid ${ring}`,
        background: '#fef9c3',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize: size * 0.4,
        flex: 'none',
      }}
    >
      {role.slice(0, 1).toUpperCase()}
    </span>
  );
}

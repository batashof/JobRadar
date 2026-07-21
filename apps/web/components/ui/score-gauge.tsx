import { cn } from '@/lib/utils';

/** Color band for a resume-fit score: red < 40% < amber < 70% < green. */
export function scoreColor(value: number): string {
  if (value >= 0.7) return '#16a34a';
  if (value >= 0.4) return '#d97706';
  return '#dc2626';
}

/**
 * Circular resume-fit gauge (ADR-012). `value` is in [0, 1]; the ring fills
 * proportionally and is colored by band so the fit reads at a glance.
 */
export function ScoreGauge({
  value,
  size = 72,
  strokeWidth = 7,
  className,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const clamped = Math.min(1, Math.max(0, value));
  const percent = Math.round(clamped * 100);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * clamped;
  const color = scoreColor(clamped);

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Resume fit ${percent} percent`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
        />
      </svg>
      <span className="absolute text-sm font-semibold tabular-nums" style={{ color }}>
        {percent}%
      </span>
    </div>
  );
}

import { useId } from 'react';

import { APP_NAME } from '@jobradar/shared';

import { cn } from '@/lib/utils';

type LogoMarkProps = {
  /** Rendered width/height in pixels. Defaults to 28. */
  size?: number;
  className?: string;
};

/**
 * The JobRadar mark: a radar sweep detecting a blip (the found vacancy).
 * Self-contained gradient badge, so it reads the same on light and dark
 * backgrounds. Gradient ids are scoped per instance to stay unique when the
 * mark appears more than once on a page.
 */
export function LogoMark({ size = 28, className }: LogoMarkProps) {
  const id = useId();
  const bg = `${id}-bg`;
  const sweep = `${id}-sweep`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`${APP_NAME} logo`}
      className={className}
    >
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366F1" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
        <linearGradient id={sweep} x1="7" y1="25" x2="20" y2="11" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${bg})`} />
      <path d="M7 25 L22 25 A15 15 0 0 0 7 10 Z" fill={`url(#${sweep})`} />
      <g fill="none" stroke="#FFFFFF" strokeLinecap="round">
        <path d="M13 25 A6 6 0 0 0 7 19" strokeOpacity="0.5" strokeWidth="1.5" />
        <path d="M17.5 25 A10.5 10.5 0 0 0 7 14.5" strokeOpacity="0.7" strokeWidth="1.5" />
        <path d="M22 25 A15 15 0 0 0 7 10" strokeOpacity="0.9" strokeWidth="1.5" />
        <path d="M7 25 L18.6 13.4" strokeWidth="1.75" />
      </g>
      <circle cx="7" cy="25" r="1.6" fill="#FFFFFF" />
      <circle cx="18.5" cy="13.2" r="3.6" fill="#FFFFFF" fillOpacity="0.25" />
      <circle cx="18.5" cy="13.2" r="2" fill="#FFFFFF" />
    </svg>
  );
}

type LogoProps = LogoMarkProps & {
  /** Hide the wordmark and render the mark only. */
  markOnly?: boolean;
};

/** The mark paired with the "JobRadar" wordmark, for headers and auth screens. */
export function Logo({ size = 28, markOnly = false, className }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark size={size} />
      {markOnly ? null : (
        <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
      )}
    </span>
  );
}

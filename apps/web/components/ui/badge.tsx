import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)]',
        primary:
          'border-transparent bg-[var(--color-primary)] text-[var(--color-primary-foreground)]',
        outline: 'border-[var(--color-border)] text-[var(--color-foreground)]',
        muted:
          'border-transparent bg-[var(--color-muted)] text-[var(--color-muted-foreground)]',
        destructive:
          'border-transparent bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

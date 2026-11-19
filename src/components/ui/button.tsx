import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "focus-ring group relative isolate inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-full px-4 text-[13px] font-semibold transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-200 ease-out hover:-translate-y-px active:translate-y-px active:scale-[.985] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:translate-y-0 disabled:active:scale-100 [&_svg]:shrink-0 [&_svg]:transition-transform [&_svg]:duration-200 group-hover:[&_svg]:scale-105",
  {
    variants: {
      variant: {
        primary: "border border-transparent bg-brand-500 text-on-accent shadow-sm hover:bg-brand-600 hover:shadow-md",
        secondary: "border border-contrast/10 bg-surface text-zinc-200 shadow-sm hover:border-brand-400/30 hover:bg-brand-50 hover:text-brand-600 hover:shadow-md",
        ghost: "text-zinc-300 hover:bg-brand-50 hover:text-brand-600",
        danger: "border border-red-400/15 bg-red-500/8 text-red-300 hover:border-red-400/25 hover:bg-red-500/14 hover:shadow-[0_8px_20px_rgba(194,59,74,.12)]",
      },
      size: {
        sm: "min-h-8 rounded-full px-3 text-xs",
        md: "min-h-10 px-4",
        icon: "size-10 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";

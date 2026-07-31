import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "focus-ring group relative isolate inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl px-4 text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-200 ease-out hover:-translate-y-px active:translate-y-px active:scale-[.985] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:translate-y-0 disabled:active:scale-100 [&_svg]:shrink-0 [&_svg]:transition-transform [&_svg]:duration-200 group-hover:[&_svg]:scale-105",
  {
    variants: {
      variant: {
        primary: "bg-gradient-to-r from-brand-500 to-orange-400 text-on-accent shadow-[0_9px_24px_rgba(249,115,79,.22)] hover:-translate-y-0.5 hover:from-brand-600 hover:to-orange-500 hover:shadow-[0_14px_32px_rgba(249,115,79,.3)]",
        secondary: "border border-white/10 bg-ink-900/80 text-zinc-200 shadow-sm hover:border-brand-400/30 hover:bg-brand-50 hover:text-brand-600 hover:shadow-[0_9px_22px_rgba(78,64,120,.1)]",
        ghost: "text-zinc-300 hover:bg-brand-50 hover:text-brand-600",
        danger: "border border-red-400/15 bg-red-500/8 text-red-300 hover:border-red-400/25 hover:bg-red-500/14 hover:shadow-[0_8px_20px_rgba(194,59,74,.12)]",
      },
      size: {
        sm: "min-h-8 rounded-lg px-3 text-xs",
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

import { forwardRef } from "react";
import clsx from "clsx";

const VARIANTS = {
  primary: "bg-brand-orange text-white hover:bg-brand-orange-dark",
  secondary: "bg-white text-brand-black border border-brand-border hover:bg-brand-cream",
  ghost: "bg-transparent text-brand-muted hover:bg-brand-border",
  danger: "bg-red-600 text-white hover:bg-red-700",
} as const;

const SIZES = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
} as const;

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
};

/** Defaults to type="button" so it never submits a form by accident. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
});

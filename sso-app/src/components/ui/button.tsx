import { ButtonHTMLAttributes, forwardRef } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", loading, children, className = "", disabled, ...props }, ref) => {
    const base =
      "inline-flex items-center justify-center font-bold transition-transform active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none select-none";

    const variants = {
      primary: "bg-accent text-accent-foreground hover:opacity-90",
      secondary: "bg-surface-lighter text-foreground border border-border hover:border-border-light",
      // Fixed white text: --danger is a mid/dark red in both themes, but
      // text-foreground flips to near-black in light mode, giving black-on-
      // dark-red. White stays high-contrast against --danger in both themes.
      danger: "bg-danger text-white hover:brightness-110",
      ghost: "bg-transparent text-muted hover:text-foreground",
    };

    const sizes = {
      sm: "text-xs px-3 py-1.5 rounded-md gap-1.5",
      md: "text-sm px-5 py-2.5 rounded-lg gap-2",
      lg: "text-base px-6 py-3 rounded-lg gap-2.5",
    };

    return (
      <button
        ref={ref}
        className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
export { Button };

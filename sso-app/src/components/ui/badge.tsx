interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "danger" | "warning";
  className?: string;
}

export function Badge({ children, variant = "default", className = "" }: BadgeProps) {
  const variants = {
    default: "bg-surface-lighter text-muted border-border",
    success: "bg-success/10 text-success border-success/20",
    danger: "bg-danger/10 text-danger border-danger/20",
    warning: "bg-warning/10 text-warning border-warning/20",
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-xs font-bold border rounded-full ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

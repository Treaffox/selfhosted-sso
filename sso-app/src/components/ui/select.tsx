import { SelectHTMLAttributes, forwardRef, useId } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(({ label, hint, className = "", children, id, ...props }, ref) => {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className="w-full">
      {label && <label htmlFor={selectId} className="block text-xs text-muted mb-1.5 uppercase tracking-wider">{label}</label>}
      <select
        ref={ref}
        id={selectId}
        className={`w-full bg-surface-light border border-border text-foreground px-4 py-3 rounded-lg text-sm font-semibold transition-colors focus:outline-none focus:border-foreground ${className}`}
        {...props}
      >
        {children}
      </select>
      {hint && <p className="text-xs text-muted mt-1.5 font-semibold">{hint}</p>}
    </div>
  );
});

Select.displayName = "Select";
export { Select };

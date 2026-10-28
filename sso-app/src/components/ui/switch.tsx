"use client";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}

/** On/off toggle. `label` is the accessible name. */
export function Switch({ checked, onChange, disabled, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-40 disabled:pointer-events-none ${
        checked ? "bg-accent border-accent" : "bg-surface-lighter border-border-light"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full transition-transform ${
          checked ? "translate-x-[22px] bg-accent-foreground" : "translate-x-[3px] bg-muted"
        }`}
      />
    </button>
  );
}

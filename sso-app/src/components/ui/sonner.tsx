"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/** Themed wrapper around sonner's <Toaster/> — matches our CSS variables instead of shadcn's. */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "!bg-surface-light !border !border-border !rounded-xl !shadow-lg !text-foreground !font-semibold",
          title: "!text-foreground !text-sm !font-semibold",
          description: "!text-muted !text-xs",
          closeButton:
            "!bg-surface-lighter !border !border-border !text-muted hover:!text-foreground",
          success: "!border-success/40",
          error: "!border-danger/40",
          warning: "!border-warning/40",
        },
      }}
      {...props}
    />
  );
}

"use client";

import { useEffect, useRef } from "react";
import { useT } from "@/components/i18n-provider";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  const t = useT();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="bg-transparent p-0 m-auto backdrop:bg-black/60 max-w-lg w-[calc(100%-2rem)] sm:w-full"
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="bg-surface-light border border-border rounded-xl animate-scale-in">
        {title && <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-base font-extrabold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors p-1"
            aria-label={t("Schließen")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>}
        <div className="p-5">{children}</div>
      </div>
    </dialog>
  );
}

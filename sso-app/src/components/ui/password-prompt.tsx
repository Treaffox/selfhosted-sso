"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useT } from "@/components/i18n-provider";

/**
 * Asks for the current password before a sensitive change (step-up).
 *
 *   const { askPassword, passwordPrompt } = usePasswordPrompt();
 *   const pw = await askPassword("Passkey hinzufügen");   // null if cancelled
 *   ...render {passwordPrompt} once in the page
 */
export function usePasswordPrompt() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const resolver = useRef<((password: string | null) => void) | null>(null);

  const askPassword = useCallback((reason: string) => {
    setTitle(reason);
    setValue("");
    setOpen(true);
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = (password: string | null) => {
    setOpen(false);
    setValue("");
    resolver.current?.(password);
    resolver.current = null;
  };

  const passwordPrompt = (
    <Modal open={open} onClose={() => finish(null)} title={t("Passwort bestätigen")}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value) finish(value);
        }}
        className="space-y-4"
      >
        <p className="text-sm text-muted">
          {title ? `${title}: ` : ""}{t("Aus Sicherheitsgründen brauchen wir dafür noch einmal dein aktuelles Passwort.")}
        </p>
        <Input
          label={t("Aktuelles Passwort")}
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="current-password"
          autoFocus
        />
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={!value}>
            {t("Bestätigen")}
          </Button>
          <Button type="button" variant="secondary" className="flex-1" onClick={() => finish(null)}>
            {t("Abbrechen")}
          </Button>
        </div>
      </form>
    </Modal>
  );

  return { askPassword, passwordPrompt };
}

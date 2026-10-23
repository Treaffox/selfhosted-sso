"use client";

import { useEffect } from "react";

/** Sets document.title to "<title> | <site name>" for client-rendered pages (name from the layout's application-name meta tag). */
export function PageTitle({ title }: { title: string }) {
  useEffect(() => {
    const siteName = document.querySelector('meta[name="application-name"]')?.getAttribute("content");
    document.title = siteName ? `${title} | ${siteName}` : title;
  }, [title]);

  return null;
}

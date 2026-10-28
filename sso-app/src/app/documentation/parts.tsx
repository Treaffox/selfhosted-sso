import type { ReactNode } from "react";
import { TriangleAlertIcon } from "@/components/ui/icons";

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-extrabold text-foreground mb-4">{title}</h2>
      <div className="space-y-4 text-[15px] leading-relaxed text-muted [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  );
}

export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4">
      <span className="mt-0.5 shrink-0 text-warning">
        <TriangleAlertIcon size={18} />
      </span>
      <div>
        <p className="text-sm font-extrabold text-foreground mb-1">{title}</p>
        <p className="text-sm leading-relaxed text-muted">{children}</p>
      </div>
    </div>
  );
}

export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="bg-surface-lighter border border-border rounded px-1.5 py-0.5 text-[13px] font-mono text-foreground/90 whitespace-nowrap">
      {children}
    </code>
  );
}

export function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-surface-lighter border border-border rounded-lg p-4 overflow-x-auto text-[13px] leading-relaxed font-mono text-foreground/90">
      <code>{children}</code>
    </pre>
  );
}

export function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto border border-border rounded-lg">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-surface-lighter">
            {head.map((h) => (
              <th
                key={h}
                className="text-left font-bold text-foreground px-4 py-2.5 border-b border-border whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2.5 text-muted align-top">
                  {j === 0 ? <InlineCode>{cell}</InlineCode> : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

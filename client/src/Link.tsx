import type { MouseEvent, ReactNode } from "react";
import { navigate, shouldHandleClick } from "./router";

// A link to a path inside the SPA, moved to without reloading the page.
export function Link({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!shouldHandleClick(event, event.currentTarget.getAttribute("target") ?? undefined)) return;
    event.preventDefault();
    navigate(to);
  }

  return (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  );
}

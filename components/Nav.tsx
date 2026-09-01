"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/logs", label: "Trading Logs" },
  { href: "/gallery", label: "Gallery" },
  { href: "/strategy", label: "Strategy" },
  { href: "/calculator", label: "Calculator" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="site-header">
      <Link href="/" className="brand">
        <span className="brand__mark" aria-hidden />
        <span className="brand__name">TradeAgent</span>
      </Link>
      <div className="site-header__end">
        <nav className="site-nav" aria-label="Primary">
          {links.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`site-nav__link${active ? " is-active" : ""}`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}

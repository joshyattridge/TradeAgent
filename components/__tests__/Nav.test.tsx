/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUsePathname = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { Nav } from "../Nav";

describe("Nav", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockUsePathname.mockReset();
  });

  function expectActive(label: string) {
    expect(screen.getByRole("link", { name: label })).toHaveClass("is-active");
  }

  function expectInactive(label: string) {
    expect(screen.getByRole("link", { name: label })).not.toHaveClass(
      "is-active",
    );
  }

  it("marks Dashboard active on /", () => {
    mockUsePathname.mockReturnValue("/");
    render(<Nav />);

    expectActive("Dashboard");
    expectInactive("Trading Logs");
    expectInactive("Gallery");
    expectInactive("Strategy");
    expectInactive("Calculator");
    expectInactive("Settings");
  });

  it("marks Trading Logs active on /logs", () => {
    mockUsePathname.mockReturnValue("/logs");
    render(<Nav />);

    expectInactive("Dashboard");
    expectActive("Trading Logs");
    expectInactive("Gallery");
    expectInactive("Strategy");
    expectInactive("Calculator");
    expectInactive("Settings");
  });

  it("marks Gallery active on /gallery", () => {
    mockUsePathname.mockReturnValue("/gallery");
    render(<Nav />);

    expectInactive("Dashboard");
    expectInactive("Trading Logs");
    expectActive("Gallery");
    expectInactive("Strategy");
    expectInactive("Calculator");
    expectInactive("Settings");
  });

  it("marks Strategy active on /strategy", () => {
    mockUsePathname.mockReturnValue("/strategy");
    render(<Nav />);

    expectInactive("Dashboard");
    expectInactive("Trading Logs");
    expectInactive("Gallery");
    expectActive("Strategy");
    expectInactive("Calculator");
    expectInactive("Settings");
  });

  it("marks Calculator active on /calculator", () => {
    mockUsePathname.mockReturnValue("/calculator");
    render(<Nav />);

    expectInactive("Dashboard");
    expectInactive("Trading Logs");
    expectInactive("Gallery");
    expectInactive("Strategy");
    expectActive("Calculator");
    expectInactive("Settings");
  });

  it("marks Settings active on /settings", () => {
    mockUsePathname.mockReturnValue("/settings");
    render(<Nav />);

    expectInactive("Dashboard");
    expectInactive("Trading Logs");
    expectInactive("Gallery");
    expectInactive("Strategy");
    expectInactive("Calculator");
    expectActive("Settings");
  });

  it("marks Trading Logs active for nested /logs/foo paths", () => {
    mockUsePathname.mockReturnValue("/logs/foo");
    render(<Nav />);

    expectInactive("Dashboard");
    expectActive("Trading Logs");
    expectInactive("Gallery");
    expectInactive("Strategy");
    expectInactive("Calculator");
    expectInactive("Settings");
  });

  it("marks Gallery active for nested /gallery/foo paths", () => {
    mockUsePathname.mockReturnValue("/gallery/foo");
    render(<Nav />);

    expectInactive("Dashboard");
    expectInactive("Trading Logs");
    expectActive("Gallery");
    expectInactive("Strategy");
    expectInactive("Calculator");
    expectInactive("Settings");
  });

  it("does not mark Dashboard active on nested paths", () => {
    mockUsePathname.mockReturnValue("/settings/profile");
    render(<Nav />);

    expectInactive("Dashboard");
    expectInactive("Gallery");
    expectActive("Settings");
  });

  it("includes an appearance switcher", () => {
    mockUsePathname.mockReturnValue("/");
    render(<Nav />);

    expect(screen.getByRole("radiogroup", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Light" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Dark" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "System" })).toBeInTheDocument();
  });
});

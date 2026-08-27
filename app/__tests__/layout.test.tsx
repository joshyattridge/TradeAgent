/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Syne: () => ({ variable: "--font-syne" }),
  Instrument_Serif: () => ({ variable: "--font-instrument" }),
  IBM_Plex_Mono: () => ({ variable: "--font-ibm" }),
}));

vi.mock("@/components/Nav", () => ({
  Nav: () => <nav data-testid="nav">Nav</nav>,
}));

vi.mock("@/components/ChatWidget", () => ({
  ChatWidget: () => <div data-testid="chat-widget">Chat</div>,
}));

vi.mock("@/components/ProposalReview", () => ({
  ProposalReview: () => <div data-testid="proposal-review">Proposals</div>,
}));

vi.mock("@/components/Providers", () => ({
  Providers: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="providers">{children}</div>
  ),
}));

vi.mock("../globals.css", () => ({}));

import RootLayout, { metadata, viewport } from "../layout";

describe("RootLayout", () => {
  it("exports metadata", () => {
    expect(metadata).toEqual({
      title: "TradeAgent",
      description:
        "Minimalist AI dashboard for day trading — plan, logs, and chat.",
    });
  });

  it("exports a system-aware color scheme", () => {
    expect(viewport.colorScheme).toBe("light dark");
  });

  it("renders children within the app shell", () => {
    render(
      <RootLayout>
        <p>Page content</p>
      </RootLayout>,
    );

    expect(screen.getByText("Page content")).toBeInTheDocument();
    expect(screen.getByTestId("providers")).toBeInTheDocument();
    expect(screen.getByTestId("nav")).toBeInTheDocument();
    expect(screen.getByTestId("chat-widget")).toBeInTheDocument();
    expect(screen.getByTestId("proposal-review")).toBeInTheDocument();
    expect(document.querySelector(".app-shell")).toBeInTheDocument();
    expect(document.querySelector("main")).toContainElement(
      screen.getByText("Page content"),
    );
    expect(document.documentElement.querySelector("script")).toBeTruthy();
  });
});

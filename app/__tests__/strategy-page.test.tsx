/**
 * @vitest-environment jsdom
 */
import "fake-indexeddb/auto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StrategyPage from "@/app/strategy/page";
import { seedStrategy } from "@/lib/seed-data";
import { useTradingStore } from "@/lib/store";

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

vi.mock("remark-gfm", () => ({
  default: vi.fn(),
}));

vi.mock("@/lib/images", () => ({
  fileToChatImage: vi.fn(),
}));

import { fileToChatImage } from "@/lib/images";

const mockFileToChatImage = vi.mocked(fileToChatImage);

function resetStore(overrides: Partial<ReturnType<typeof useTradingStore.getState>> = {}) {
  useTradingStore.setState({
    strategy: seedStrategy,
    hydrated: true,
    ...overrides,
  });
}

describe("StrategyPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockFileToChatImage.mockClear();
    mockFileToChatImage.mockResolvedValue("data:image/png;base64,abc");
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    resetStore();
  });

  it("shows loading state when not hydrated", () => {
    resetStore({ hydrated: false });
    render(<StrategyPage />);
    expect(screen.getByText("Loading strategy…")).toBeInTheDocument();
  });

  it("renders markdown view mode", () => {
    render(<StrategyPage />);
    expect(screen.getByRole("heading", { name: "Strategy" })).toBeInTheDocument();
    expect(screen.getByTestId("markdown")).toHaveTextContent(
      "1H Fair Value Gap Continuation",
    );
    expect(screen.getByText(seedStrategy.name)).toBeInTheDocument();
  });

  it("shows empty note when strategy markdown is blank", () => {
    resetStore({
      strategy: {
        ...seedStrategy,
        markdown: "   ",
      },
    });
    render(<StrategyPage />);
    expect(
      screen.getByText(/No strategy yet\. Click Edit/),
    ).toBeInTheDocument();
  });

  it("enters edit mode, tracks dirty state, saves and cancels", async () => {
    const user = userEvent.setup();
    render(<StrategyPage />);

    await user.click(screen.getByRole("button", { name: "Edit" }));

    const textarea = screen.getByLabelText("Strategy markdown");
    expect(textarea).toHaveValue(seedStrategy.markdown);

    const saveBtn = screen.getByRole("button", { name: "Save" });
    expect(saveBtn).toBeDisabled();

    await user.clear(textarea);
    await user.type(textarea, "# Updated Strategy\n\nNew rules.");

    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    expect(saveBtn).toBeEnabled();

    await user.click(saveBtn);

    await waitFor(() => {
      expect(useTradingStore.getState().strategy.markdown).toContain(
        "# Updated Strategy",
      );
    });
    expect(screen.queryByLabelText("Strategy markdown")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(screen.getByLabelText("Strategy markdown"), " extra");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
    expect(useTradingStore.getState().strategy.markdown).toContain(
      "# Updated Strategy",
    );
  });

  it("opens image picker via Add image button", async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");

    render(<StrategyPage />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Add image" }));

    expect(clickSpy).toHaveBeenCalled();
  });

  it("inserts image via file picker", async () => {
    const user = userEvent.setup();
    render(<StrategyPage />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const textarea = screen.getByLabelText("Strategy markdown") as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 0);

    const file = new File(["img"], "chart.png", { type: "image/png" });
    const input = document.querySelector(
      'input[type="file"][accept="image/*"]',
    ) as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(mockFileToChatImage).toHaveBeenCalledWith(file, 1400, 0.78);
      expect(textarea.value).toContain("![chart](data:image/png;base64,abc)");
    });
  });

  it("inserts image via drag and drop on textarea", async () => {
    render(<StrategyPage />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const textarea = screen.getByLabelText("Strategy markdown");
    const file = new File(["img"], "drop.png", { type: "image/png" });

    fireEvent.dragOver(textarea);
    fireEvent.drop(textarea, {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => {
      expect(mockFileToChatImage).toHaveBeenCalledWith(file, 1400, 0.78);
    });
  });

  it("shows image error when fileToChatImage fails", async () => {
    mockFileToChatImage.mockRejectedValue(new Error("Image too large"));
    const user = userEvent.setup();
    render(<StrategyPage />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const file = new File(["img"], "bad.png", { type: "image/png" });
    const input = document.querySelector(
      'input[type="file"][accept="image/*"]',
    ) as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText("Image too large")).toBeInTheDocument();
    });
  });

  it("shows generic image error for non-Error throws", async () => {
    mockFileToChatImage.mockRejectedValue("nope");
    const user = userEvent.setup();
    render(<StrategyPage />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const file = new File(["img"], "bad.png", { type: "image/png" });
    const input = document.querySelector(
      'input[type="file"][accept="image/*"]',
    ) as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText("Could not add image")).toBeInTheDocument();
    });
  });

  it("ignores non-image drops", async () => {
    render(<StrategyPage />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const textarea = screen.getByLabelText("Strategy markdown");
    const file = new File(["txt"], "notes.txt", { type: "text/plain" });

    fireEvent.drop(textarea, {
      dataTransfer: { files: [file] },
    });

    expect(mockFileToChatImage).not.toHaveBeenCalled();
  });

  it("uses default alt text for extension-only filenames and ignores empty picks", async () => {
    const user = userEvent.setup();
    render(<StrategyPage />);
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const input = document.querySelector(
      'input[type="file"][accept="image/*"]',
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { files: null } });
    expect(mockFileToChatImage).not.toHaveBeenCalled();

    const textarea = screen.getByLabelText(
      "Strategy markdown",
    ) as HTMLTextAreaElement;
    Object.defineProperty(textarea, "selectionStart", {
      configurable: true,
      get: () => null,
    });

    const file = new File(["img"], ".png", { type: "image/png" });
    await user.upload(input, file);

    await waitFor(() => {
      expect(textarea.value).toContain(
        "![strategy image](data:image/png;base64,abc)",
      );
    });
  });
});

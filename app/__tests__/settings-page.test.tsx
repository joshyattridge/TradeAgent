/**
 * @vitest-environment jsdom
 */
import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/app/settings/page";
import { ThemeProvider } from "@/components/ThemeProvider";
import {
  buildJournalBackup,
  gzipUtf8,
  serializeJournalBackup,
} from "@/lib/backup";
import {
  CUSTOM_MODEL_OPTION,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_REASONING_EFFORT,
} from "@/lib/models";
import { seedStrategy, seedTrades } from "@/lib/seed-data";
import { useTradingStore } from "@/lib/store";
import type { Trade } from "@/lib/types";

function sampleTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    date: "2026-07-01",
    symbol: "EURUSD",
    side: "long",
    entry: 1.1682,
    stop: 1.1658,
    target: 1.173,
    rMultiple: 1.5,
    result: "win",
    ...overrides,
  };
}

function resetStore(overrides: Partial<ReturnType<typeof useTradingStore.getState>> = {}) {
  useTradingStore.setState({
    trades: [sampleTrade()],
    strategy: seedStrategy,
    hydrated: true,
    openaiApiKey: "",
    openaiModel: DEFAULT_OPENAI_MODEL,
    openaiReasoningEffort: DEFAULT_REASONING_EFFORT,
    ...overrides,
  });
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    resetStore();
  });

  it("shows loading state when not hydrated", () => {
    resetStore({ hydrated: false });
    const { container } = render(<SettingsPage />);
    expect(screen.getByText("Loading settings…")).toBeInTheDocument();
    expect(container.querySelector(".page--settings")).toBeInTheDocument();
  });

  it("saves preset model and API key", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.type(screen.getByPlaceholderText("sk-..."), "sk-test-key");
    await user.selectOptions(screen.getByLabelText("Model"), "gpt-5.6-sol");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(useTradingStore.getState().openaiApiKey).toBe("sk-test-key");
    expect(useTradingStore.getState().openaiModel).toBe("gpt-5.6-sol");
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(
      screen.getByText(/Connected · GPT-5.6 Sol · Medium reasoning/),
    ).toBeInTheDocument();
  });

  it("saves reasoning effort from the dropdown", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.type(screen.getByPlaceholderText("sk-..."), "sk-test-key");
    await user.selectOptions(screen.getByLabelText("Reasoning effort"), "max");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(useTradingStore.getState().openaiReasoningEffort).toBe("max");
    expect(
      screen.getByText(/Connected · GPT-5.6 Luna · Max reasoning/),
    ).toBeInTheDocument();
  });

  it("hydrates invalid saved reasoning effort to the default", async () => {
    resetStore({ openaiReasoningEffort: "not-a-real-effort" });
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByLabelText("Reasoning effort")).toHaveValue(
        DEFAULT_REASONING_EFFORT,
      );
    });
  });

  it("saves the default reasoning effort when the select value is invalid", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    const select = screen.getByLabelText("Reasoning effort");
    // Force an invalid controlled value before save (covers onSave fallback).
    fireEvent.change(select, { target: { value: "bogus-effort" } });
    await user.type(screen.getByPlaceholderText("sk-..."), "sk-test-key");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(useTradingStore.getState().openaiReasoningEffort).toBe(
      DEFAULT_REASONING_EFFORT,
    );
  });

  it("saves custom model id", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.selectOptions(screen.getByLabelText("Model"), CUSTOM_MODEL_OPTION);
    await user.type(
      screen.getByPlaceholderText("e.g. gpt-5.6-sol or ft:…"),
      "my-custom-model",
    );
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(useTradingStore.getState().openaiModel).toBe("my-custom-model");
  });

  it("does not save custom model when id is blank", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.selectOptions(screen.getByLabelText("Model"), CUSTOM_MODEL_OPTION);
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(useTradingStore.getState().openaiModel).toBe(DEFAULT_OPENAI_MODEL);
  });

  it("hydrates default model when saved model is empty", async () => {
    resetStore({ openaiModel: "" });
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByLabelText("Model")).toHaveValue(DEFAULT_OPENAI_MODEL);
    });
  });

  it("hydrates custom model from store", () => {
    resetStore({ openaiModel: "ft:custom-123" });
    render(<SettingsPage />);

    expect(screen.getByLabelText("Model")).toHaveValue(CUSTOM_MODEL_OPTION);
    expect(screen.getByPlaceholderText("e.g. gpt-5.6-sol or ft:…")).toHaveValue(
      "ft:custom-123",
    );
  });

  it("clears API key", async () => {
    const user = userEvent.setup();
    resetStore({ openaiApiKey: "sk-existing" });
    render(<SettingsPage />);

    await user.click(screen.getByRole("button", { name: "Clear key" }));

    expect(useTradingStore.getState().openaiApiKey).toBe("");
    expect(screen.getByPlaceholderText("sk-...")).toHaveValue("");
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("toggles show/hide API key", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    const input = screen.getByPlaceholderText("sk-...");
    expect(input).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(input).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Hide" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("downloads a gzip backup", async () => {
    const user = userEvent.setup();
    let blob: Blob | undefined;
    let filename = "";
    const createObjectURL = vi.fn((value: Blob | MediaSource) => {
      blob = value as Blob;
      return "blob:backup";
    });
    const revokeObjectURL = vi.fn();
    vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function click(this: HTMLAnchorElement) {
        filename = this.download;
      },
    );

    render(<SettingsPage />);
    await user.click(screen.getByRole("button", { name: "Download backup" }));

    await waitFor(() => {
      expect(
        screen.getByText(/Downloaded gzip backup with 1 trade/),
      ).toBeInTheDocument();
    });
    expect(filename).toMatch(/\.json\.gz$/);
    expect(blob?.type).toBe("application/gzip");
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:backup");
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);
  });

  it("imports backup in replace mode after confirm", async () => {
    const user = userEvent.setup();
    const backup = buildJournalBackup(
      [sampleTrade({ id: "imported", symbol: "GBPUSD" })],
      { ...seedStrategy, name: "Imported Plan" },
    );
    const file = new File([serializeJournalBackup(backup)], "backup.json", {
      type: "application/json",
    });

    render(<SettingsPage />);
    const input = document.getElementById("backup-import") as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(useTradingStore.getState().trades).toHaveLength(1);
      expect(useTradingStore.getState().trades[0]?.symbol).toBe("GBPUSD");
      expect(useTradingStore.getState().strategy.name).toBe("Imported Plan");
    });
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByText(/Restored 1 trade/)).toBeInTheDocument();
  });

  it("cancels replace import when confirm is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    const backup = buildJournalBackup(
      [sampleTrade({ id: "imported" })],
      seedStrategy,
    );
    const file = new File([serializeJournalBackup(backup)], "backup.json", {
      type: "application/json",
    });

    render(<SettingsPage />);
    const input = document.getElementById("backup-import") as HTMLInputElement;
    await user.upload(input, file);

    expect(useTradingStore.getState().trades[0]?.symbol).toBe("EURUSD");
    expect(screen.queryByText(/Restored/)).not.toBeInTheDocument();
  });

  it("imports backup in merge mode", async () => {
    const user = userEvent.setup();
    const backup = buildJournalBackup(
      [sampleTrade({ id: "t2", symbol: "GBPJPY" })],
      seedStrategy,
    );
    const file = new File([serializeJournalBackup(backup)], "backup.json", {
      type: "application/json",
    });

    render(<SettingsPage />);
    await user.selectOptions(screen.getByLabelText("Import mode"), "merge");
    const input = document.getElementById("backup-import") as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(useTradingStore.getState().trades).toHaveLength(2);
    });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(screen.getByText(/Merged 1 trade/)).toBeInTheDocument();
  });

  it("shows error for invalid backup file", async () => {
    const user = userEvent.setup();
    const file = new File(["not json"], "bad.json", { type: "application/json" });

    render(<SettingsPage />);
    const input = document.getElementById("backup-import") as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText("File is not valid JSON")).toBeInTheDocument();
    });
  });

  it("shows error when file read fails", async () => {
    const user = userEvent.setup();
    const file = new File(["{}"], "broken.json", { type: "application/json" });
    vi.spyOn(file, "arrayBuffer").mockRejectedValue(new Error("read failed"));

    render(<SettingsPage />);
    const input = document.getElementById("backup-import") as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText("Could not read that file.")).toBeInTheDocument();
    });
  });

  it("shows error when file read rejects a non-Error", async () => {
    const user = userEvent.setup();
    const file = new File(["{}"], "broken.json", { type: "application/json" });
    vi.spyOn(file, "arrayBuffer").mockRejectedValue("nope");

    render(<SettingsPage />);
    const input = document.getElementById("backup-import") as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText("Could not read that file.")).toBeInTheDocument();
    });
  });

  it("imports a gzip backup", async () => {
    const user = userEvent.setup();
    const backup = buildJournalBackup(
      [sampleTrade({ id: "gz", symbol: "NAS100" })],
      { ...seedStrategy, name: "Gzip Plan" },
    );
    const gz = await gzipUtf8(serializeJournalBackup(backup));
    const file = new File([gz], "backup.json.gz", { type: "application/gzip" });

    render(<SettingsPage />);
    const input = document.getElementById("backup-import") as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(useTradingStore.getState().trades[0]?.symbol).toBe("NAS100");
      expect(useTradingStore.getState().strategy.name).toBe("Gzip Plan");
    });
    expect(screen.getByText(/Restored 1 trade/)).toBeInTheDocument();
  });

  it("shows error for corrupt gzip backup", async () => {
    const user = userEvent.setup();
    const file = new File([new Uint8Array([0x1f, 0x8b, 0x00])], "bad.json.gz", {
      type: "application/gzip",
    });

    render(<SettingsPage />);
    const input = document.getElementById("backup-import") as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(
        screen.getByText("Could not decompress gzip backup"),
      ).toBeInTheDocument();
    });
  });

  it("shows gzip-unsupported error on import", async () => {
    const user = userEvent.setup();
    const original = globalThis.DecompressionStream;
    const gz = await gzipUtf8(
      serializeJournalBackup(buildJournalBackup([sampleTrade()], seedStrategy)),
    );
    const file = new File([gz], "backup.json.gz", { type: "application/gzip" });
    try {
      // @ts-expect-error -- delete for the missing-API branch
      delete globalThis.DecompressionStream;
      render(<SettingsPage />);
      const input = document.getElementById("backup-import") as HTMLInputElement;
      await user.upload(input, file);
      await waitFor(() => {
        expect(
          screen.getByText("Gzip is not supported in this browser"),
        ).toBeInTheDocument();
      });
    } finally {
      globalThis.DecompressionStream = original;
    }
  });

  it("shows error when gzip export is unsupported", async () => {
    const user = userEvent.setup();
    const original = globalThis.CompressionStream;
    try {
      // @ts-expect-error -- delete for the missing-API branch
      delete globalThis.CompressionStream;
      render(<SettingsPage />);
      await user.click(screen.getByRole("button", { name: "Download backup" }));
      await waitFor(() => {
        expect(
          screen.getByText("Could not compress backup."),
        ).toBeInTheDocument();
      });
    } finally {
      globalThis.CompressionStream = original;
    }
  });

  it("shows plural trade count on export with multiple trades", async () => {
    const user = userEvent.setup();
    resetStore({ trades: seedTrades });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<SettingsPage />);
    await user.click(screen.getByRole("button", { name: "Download backup" }));

    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`${seedTrades.length} trades \\+ strategy`)),
      ).toBeInTheDocument();
    });
  });

  it("shows plural restore message for multi-trade replace import", async () => {
    const user = userEvent.setup();
    const backup = buildJournalBackup(
      [
        sampleTrade({ id: "t1" }),
        sampleTrade({ id: "t2", symbol: "GBPJPY" }),
      ],
      seedStrategy,
    );
    const file = new File([serializeJournalBackup(backup)], "backup.json", {
      type: "application/json",
    });

    render(<SettingsPage />);
    const input = document.getElementById("backup-import") as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText(/Restored 2 trades/)).toBeInTheDocument();
    });
  });

  it("clears Saved flash after timeout", async () => {
    const pending: Array<() => void> = [];
    const realSetTimeout = window.setTimeout.bind(window);
    vi.spyOn(window, "setTimeout").mockImplementation(((
      fn: TimerHandler,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms === 1800 && typeof fn === "function") {
        pending.push(fn as () => void);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(fn as never, ms as never, ...(args as never[]));
    }) as typeof setTimeout);

    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.type(screen.getByPlaceholderText("sk-..."), "sk-test-key");
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(screen.getByText("Saved")).toBeInTheDocument();

    act(() => {
      pending.forEach((fn) => fn());
    });
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("clears Saved flash after clearing key", async () => {
    const pending: Array<() => void> = [];
    const realSetTimeout = window.setTimeout.bind(window);
    vi.spyOn(window, "setTimeout").mockImplementation(((
      fn: TimerHandler,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms === 1800 && typeof fn === "function") {
        pending.push(fn as () => void);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(fn as never, ms as never, ...(args as never[]));
    }) as typeof setTimeout);

    const user = userEvent.setup();
    resetStore({ openaiApiKey: "sk-existing" });
    render(<SettingsPage />);

    await user.click(screen.getByRole("button", { name: "Clear key" }));
    expect(screen.getByText("Saved")).toBeInTheDocument();
    act(() => {
      pending.forEach((fn) => fn());
    });
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("ignores empty custom model submits and empty import file events", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.selectOptions(
      screen.getByLabelText("Model"),
      CUSTOM_MODEL_OPTION,
    );
    const form = screen
      .getByRole("button", { name: "Save settings" })
      .closest("form")!;
    const customInput = screen.getByPlaceholderText("e.g. gpt-5.6-sol or ft:…");
    customInput.removeAttribute("required");
    fireEvent.submit(form);
    expect(useTradingStore.getState().openaiModel).toBe(DEFAULT_OPENAI_MODEL);

    const input = document.getElementById("backup-import") as HTMLInputElement;
    fireEvent.change(input, { target: { files: null } });
    expect(screen.queryByText(/Restored|Merged/)).not.toBeInTheDocument();
  });

  it("lets the user pick a dark theme", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <SettingsPage />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

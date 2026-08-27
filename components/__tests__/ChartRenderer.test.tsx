/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChartRenderer } from "@/components/ChartRenderer";
import type { ChartPoint, ChartSpec } from "@/lib/types";

type Captured = {
  yTickFormatter?: (v: unknown) => string;
  xTickFormatter?: (v: unknown, index: number) => string;
  tooltipFormatter?: (...args: unknown[]) => unknown;
  labelFormatter?: (...args: unknown[]) => unknown;
  tooltipContentStyle?: Record<string, unknown>;
  tooltipItemStyle?: Record<string, unknown>;
  tooltipLabelStyle?: Record<string, unknown>;
  xAxisLabel?: unknown;
  yAxisLabel?: unknown;
  xAxisDataKey?: unknown;
  barMinPointSize?: unknown;
};

let captured: Captured = {};

vi.mock("recharts", () => {
  const passthrough =
    (tag: string) =>
    ({
      children,
      tickFormatter,
      label,
      formatter,
      labelFormatter,
      dataKey,
      minPointSize,
      ...rest
    }: Record<string, unknown>) => {
      if (tickFormatter) {
        if (tag === "XAxis") {
          captured.xTickFormatter = tickFormatter as (
            v: unknown,
            index: number,
          ) => string;
        } else {
          captured.yTickFormatter = tickFormatter as (v: unknown) => string;
        }
      }
      if (formatter) captured.tooltipFormatter = formatter as (...args: unknown[]) => unknown;
      if (labelFormatter) captured.labelFormatter = labelFormatter as (...args: unknown[]) => unknown;
      if (tag === "Tooltip") {
        if (rest.contentStyle) {
          captured.tooltipContentStyle = rest.contentStyle as Record<string, unknown>;
        }
        if (rest.itemStyle) {
          captured.tooltipItemStyle = rest.itemStyle as Record<string, unknown>;
        }
        if (rest.labelStyle) {
          captured.tooltipLabelStyle = rest.labelStyle as Record<string, unknown>;
        }
      }
      if (tag === "XAxis") {
        if (label) captured.xAxisLabel = label;
        if (dataKey != null) captured.xAxisDataKey = dataKey;
      }
      if (tag === "YAxis" && label) captured.yAxisLabel = label;
      if (tag === "Bar" && minPointSize != null) captured.barMinPointSize = minPointSize;
      return (
        <div data-testid={`recharts-${tag.toLowerCase()}`} data-props={JSON.stringify(Object.keys(rest))}>
          {children as React.ReactNode}
        </div>
      );
    };

  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container">{children}</div>
    ),
    ComposedChart: passthrough("ComposedChart"),
    AreaChart: passthrough("AreaChart"),
    Area: () => <div data-testid="recharts-area" />,
    BarChart: passthrough("BarChart"),
    Bar: ({
      children,
      minPointSize,
    }: {
      children?: React.ReactNode;
      minPointSize?: number;
    }) => {
      if (minPointSize != null) captured.barMinPointSize = minPointSize;
      return <div data-testid="recharts-bar">{children}</div>;
    },
    LineChart: passthrough("LineChart"),
    Line: () => <div data-testid="recharts-line" />,
    PieChart: passthrough("PieChart"),
    Pie: ({ children }: { children?: React.ReactNode }) => <div data-testid="recharts-pie">{children}</div>,
    ScatterChart: passthrough("ScatterChart"),
    Scatter: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="recharts-scatter">{children}</div>
    ),
    Cell: ({ fill }: { fill?: string }) => <div data-testid="recharts-cell" data-fill={fill} />,
    CartesianGrid: () => null,
    XAxis: passthrough("XAxis"),
    YAxis: passthrough("YAxis"),
    ZAxis: () => null,
    Tooltip: passthrough("Tooltip"),
  };
});

function chart(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    id: "c1",
    title: "Test chart",
    type: "bar",
    ...overrides,
  };
}

const sampleData: ChartPoint[] = [
  { label: "A", value: 2 },
  { label: "B", value: -1 },
];

describe("ChartRenderer", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    captured = {};
  });

  it("shows empty state when data is missing or empty", () => {
    const { rerender } = render(<ChartRenderer chart={chart({ data: [] })} />);
    expect(screen.getByText("No data yet.")).toBeInTheDocument();

    rerender(<ChartRenderer chart={chart({ data: undefined })} />);
    expect(screen.getByText("No data yet.")).toBeInTheDocument();
  });

  it("renders title and optional description", () => {
    render(
      <ChartRenderer
        chart={chart({ description: "Performance overview", data: sampleData })}
      />,
    );
    expect(screen.getByRole("heading", { name: "Test chart" })).toBeInTheDocument();
    expect(screen.getByText("Performance overview")).toBeInTheDocument();
  });

  it("renders winLoss pie with Wins, Losses, and other cell colors", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "winLoss",
          data: [
            { label: "Wins", value: 5 },
            { label: "Losses", value: 2 },
            { label: "Other", value: 1 },
          ],
        })}
      />,
    );
    const cells = screen.getAllByTestId("recharts-cell");
    expect(cells[0]).toHaveAttribute("data-fill", "#0d9488");
    expect(cells[1]).toHaveAttribute("data-fill", "#e11d48");
    expect(cells[2]).toHaveAttribute("data-fill", "#78716c");
    expect(screen.getByTestId("recharts-piechart")).toBeInTheDocument();
  });

  it("renders equity area chart and formats usd axis values", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "equity",
          id: "eq-usd",
          valueUnit: "usd",
          data: [{ id: "t1", label: "Jul 1", value: 150.5, x: 0 }],
        })}
      />,
    );
    expect(screen.getByTestId("recharts-areachart")).toBeInTheDocument();
    expect(captured.xAxisDataKey).toBe("id");
    expect(captured.yTickFormatter!("150.5")).toBe("+$151");
    expect(captured.yTickFormatter!("-25.12")).toBe("$-25.12");
    expect(captured.tooltipFormatter!(50, "value", { payload: { label: "Jul 1" } })).toEqual([
      "+$50.00",
      "Value",
    ]);
  });

  it("equity tooltip marks estimated $ points and labels from payload", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "equity",
          valueUnit: "usd",
          data: [
            { id: "a", label: "Jul 1 10:00", value: 150, x: 0, estimated: true },
            { id: "b", label: "Jul 1 14:00", value: 200, x: 1 },
          ],
        })}
      />,
    );
    expect(
      captured.tooltipFormatter!(150, "value", {
        payload: { label: "Jul 1 10:00", estimated: true },
      }),
    ).toEqual(["+$150 (est.)", "Value"]);
    expect(
      captured.labelFormatter!("ignored", [
        { payload: { label: "Jul 1 10:00", id: "a" } },
      ]),
    ).toBe("Jul 1 10:00");
    expect(captured.xTickFormatter!("a", 0)).toBe("Jul 1 10:00");
    expect(captured.xTickFormatter!("missing", 99)).toBe("missing");
    expect(captured.xTickFormatter!(undefined, 99)).toBe("");
  });

  it("falls back to label dataKey when equity points lack ids", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "equity",
          data: [{ label: "Only label", value: 1 }],
        })}
      />,
    );
    expect(captured.xAxisDataKey).toBe("label");
  });

  it("renders equity with $ unit formatting", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "equity",
          valueUnit: "usd",
          data: [{ id: "t1", label: "Jul 1", value: 1.234, x: 0 }],
        })}
      />,
    );
    expect(captured.yTickFormatter!(1.234)).toBe("+$1.23");
    expect(captured.tooltipFormatter!("not-a-number", "value", {})).toEqual([
      "not-a-number",
      "Value",
    ]);
  });

  it("renders line chart with yLabel and $ formatters", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "line",
          yLabel: "P&L",
          valueUnit: "usd",
          data: sampleData,
        })}
      />,
    );
    expect(screen.getByTestId("recharts-linechart")).toBeInTheDocument();
    expect(captured.yAxisLabel).toMatchObject({ value: "P&L" });
    expect(captured.yTickFormatter!(2)).toBe("+$2.00");
    expect(captured.tooltipFormatter!(2, "value")).toEqual(["+$2.00", "P&L"]);
  });

  it("uses theme tokens for tooltip chrome and text so dark mode stays readable", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "line",
          yLabel: "P&L",
          valueUnit: "usd",
          data: sampleData,
        })}
      />,
    );
    expect(captured.tooltipContentStyle).toMatchObject({
      backgroundColor: "var(--paper-2)",
      color: "var(--ink)",
    });
    expect(captured.tooltipContentStyle).not.toHaveProperty("background");
    expect(captured.tooltipItemStyle).toMatchObject({ color: "var(--ink)" });
    expect(captured.tooltipLabelStyle).toMatchObject({ color: "var(--ink)" });
  });

  it("renders bar chart with colored cells for positive and negative values", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "bar",
          valueUnit: "usd",
          yLabel: "P&L",
          data: sampleData,
        })}
      />,
    );
    const cells = screen.getAllByTestId("recharts-cell");
    expect(cells[0]).toHaveAttribute("data-fill", "#0d9488");
    expect(cells[1]).toHaveAttribute("data-fill", "#e11d48");
    expect(captured.barMinPointSize).toBe(4);
    expect(captured.tooltipFormatter!(100, "value", { payload: {} })).toEqual([
      "+$100",
      "P&L",
    ]);
  });

  it("keeps estimated $0 symbol bars visible with muted fill", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "bySymbol",
          valueUnit: "usd",
          yLabel: "$",
          data: [
            { id: "EURUSD", label: "EURUSD", value: 100, count: 1 },
            { id: "AUDUSD", label: "AUDUSD", value: 0, estimated: true, count: 1 },
          ],
        })}
      />,
    );
    const cells = screen.getAllByTestId("recharts-cell");
    expect(cells).toHaveLength(2);
    expect(cells[1]).toHaveAttribute("data-fill", "#78716c");
    expect(captured.barMinPointSize).toBe(4);
    expect(
      captured.tooltipFormatter!(0, "value", {
        payload: { estimated: true, label: "AUDUSD", count: 1 },
      }),
    ).toEqual(["$0.00 (est.) · 1 trade", "Net $"]);
  });

  it("shows net label and trade count for by-symbol bars", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "bySymbol",
          valueUnit: "usd",
          yLabel: "$",
          data: [{ id: "GBPJPY", label: "GBPJPY", value: 1.97, count: 3 }],
        })}
      />,
    );
    expect(
      captured.tooltipFormatter!(1.97, "value", {
        payload: { label: "GBPJPY", count: 3 },
      }),
    ).toEqual(["+$1.97 · 3 trades", "Net $"]);
  });

  it("defaults net tooltip series label when yLabel is omitted", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "bySymbol",
          data: [{ id: "X", label: "X", value: 1, count: 2 }],
        })}
      />,
    );
    expect(
      captured.tooltipFormatter!(1, "value", { payload: { count: 2 } }),
    ).toEqual(["1 · 2 trades", "Net value"]);
  });

  it("equity labelFormatter falls back when payload has no label", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "equity",
          data: [{ id: "a", label: "Jul 1", value: 1, x: 0 }],
        })}
      />,
    );
    expect(captured.labelFormatter!("ignored", [{ payload: {} }])).toBe("");
  });

  it("renders scatter chart with axis labels and tooltip formatters", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "scatter",
          xLabel: "Risk",
          yLabel: "Reward",
          data: [
            { label: "T1", x: 10, y: 20 },
            { label: "T2", value: 5, secondary: -3 },
          ],
        })}
      />,
    );
    expect(screen.getByTestId("recharts-scatterchart")).toBeInTheDocument();
    expect(captured.xAxisLabel).toMatchObject({ value: "Risk" });
    expect(captured.yAxisLabel).toMatchObject({ value: "Reward" });

    expect(captured.tooltipFormatter!(10, "x")).toEqual([10, "Risk"]);
    expect(captured.tooltipFormatter!(-3, "y")).toEqual([-3, "Reward"]);
    expect(captured.tooltipFormatter!("bad", "size")).toEqual(["bad", "size"]);

    expect(
      captured.labelFormatter!("ignored", [{ payload: { label: "T1" } }]),
    ).toBe("T1");
    expect(captured.labelFormatter!("ignored", [])).toBe("");
  });

  it("renders scatter without optional axis labels", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "scatter",
          data: [{ label: "Pt", x: 1, y: 2 }],
        })}
      />,
    );
    expect(captured.xAxisLabel).toBeUndefined();
    expect(captured.yAxisLabel).toBeUndefined();
    expect(captured.tooltipFormatter!(1, "x")).toEqual([1, "X"]);
    expect(captured.tooltipFormatter!(2, "y")).toEqual([2, "Y"]);
  });

  it("renders lossStreak bars in coral with percent formatting and x label", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "lossStreak",
          valueUnit: "percent",
          xLabel: "Losses in a row",
          yLabel: "Probability %",
          data: [
            { id: "streak-1", label: "1", value: 30 },
            { id: "streak-2", label: "2", value: 12.5 },
            { id: "streak-3", label: "3", value: 0.81 },
            { id: "streak-4", label: "4", value: 0 },
          ],
        })}
      />,
    );
    const cells = screen.getAllByTestId("recharts-cell");
    expect(cells).toHaveLength(4);
    expect(cells[0]).toHaveAttribute("data-fill", "#e11d48");
    expect(captured.xAxisLabel).toMatchObject({ value: "Losses in a row" });
    expect(captured.yTickFormatter!(30)).toBe("30%");
    expect(captured.yTickFormatter!(12.5)).toBe("12.5%");
    expect(captured.yTickFormatter!(0.81)).toBe("0.81%");
    expect(captured.yTickFormatter!(0)).toBe("0%");
    expect(captured.tooltipFormatter!(30, "value")).toEqual([
      "30%",
      "Probability %",
    ]);
  });

  it("highlights the current losing-streak bar and labels the tooltip", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "lossStreak",
          valueUnit: "percent",
          yLabel: "Probability %",
          data: [
            { id: "streak-1", label: "1", value: 30 },
            { id: "streak-2", label: "2 · now", value: 9, current: true },
          ],
        })}
      />,
    );
    const cells = screen.getAllByTestId("recharts-cell");
    expect(cells[0]).toHaveAttribute("data-fill", "rgba(225, 29, 72, 0.32)");
    expect(cells[1]).toHaveAttribute("data-fill", "#e11d48");
    expect(
      captured.tooltipFormatter!(9, "value", {
        payload: { current: true, label: "2 · now" },
      }),
    ).toEqual(["9% · you are here", "Probability %"]);
  });

  it("renders winWithin bars in teal and highlights the next-trade bar", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "winWithin",
          valueUnit: "percent",
          xLabel: "Trades from now",
          yLabel: "Probability %",
          data: [
            { id: "wait-1", label: "this one", value: 30, current: true },
            { id: "wait-2", label: "2", value: 51 },
          ],
        })}
      />,
    );
    const cells = screen.getAllByTestId("recharts-cell");
    expect(cells[0]).toHaveAttribute("data-fill", "#0d9488");
    expect(cells[1]).toHaveAttribute("data-fill", "rgba(13, 148, 136, 0.32)");
    expect(captured.xAxisLabel).toMatchObject({ value: "Trades from now" });
    expect(
      captured.tooltipFormatter!(30, "value", {
        payload: { current: true, label: "this one" },
      }),
    ).toEqual(["30% · you are here", "Probability %"]);
  });

  it("keeps winWithin bars fully teal when none are marked current", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "winWithin",
          data: [{ id: "wait-1", label: "this one", value: 40 }],
        })}
      />,
    );
    expect(screen.getAllByTestId("recharts-cell")[0]).toHaveAttribute(
      "data-fill",
      "#0d9488",
    );
  });

  it("renders bar chart without value unit using plain numeric formatting", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "bar",
          data: [{ label: "Setup A", value: 3 }],
        })}
      />,
    );
    expect(captured.yTickFormatter!(3)).toBe("3");
    expect(captured.tooltipFormatter!(3, "value")).toEqual(["3", "Value"]);
  });

  it("formats non-finite and zero usd values", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "line",
          valueUnit: "usd",
          data: [{ label: "A", value: 0 }],
        })}
      />,
    );
    expect(captured.yTickFormatter!("bad")).toBe("bad");
    expect(captured.yTickFormatter!(undefined)).toBe("");
    expect(captured.yTickFormatter!(0)).toBe("$0.00");
    expect(captured.tooltipFormatter!(0, "value")).toEqual(["$0.00", "Value"]);
  });

  it("formats positive $ tick values with a plus sign", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "line",
          valueUnit: "usd",
          data: [{ label: "A", value: 1.5 }],
        })}
      />,
    );
    expect(captured.yTickFormatter!(1.5)).toBe("+$1.50");
    expect(captured.yTickFormatter!(-0.5)).toBe("$-0.50");
  });

  it("maps scatter points without y or secondary to zero", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "scatter",
          data: [{ label: "Lonely", value: 4 }],
        })}
      />,
    );
    expect(screen.getByTestId("recharts-scatter")).toBeInTheDocument();
  });

  it("renders an equity fan with percentile tooltip and sparse x ticks", () => {
    const data: ChartPoint[] = [
      { id: "start", label: "Start", value: 0, lo: 0, hi: 0, x: 0 },
      { id: "t0", label: "Jun 30", value: 10, lo: 10, hi: 10, x: 1 },
      { id: "t1", label: "Jul 1", value: 20, lo: 20, hi: 20, x: 2, current: true },
      { id: "fan-3", label: "3", value: 30, lo: 10, hi: 50, x: 2, estimated: true },
      { id: "fan-5", label: "5", value: 40, lo: 15, hi: 70, x: 3, estimated: true },
      { id: "fan-10", label: "10", value: 55, lo: 5, hi: 90, x: 4, estimated: true },
    ];
    render(
      <ChartRenderer
        chart={chart({
          type: "equityFan",
          valueUnit: "usd",
          data,
        })}
      />,
    );
    expect(screen.getByTestId("recharts-composedchart")).toBeInTheDocument();
    expect(captured.yTickFormatter!(150.5)).toBe("+$151");
    expect(captured.xTickFormatter!("start", 0)).toBe("Start");
    expect(captured.xTickFormatter!("t0", 1)).toBe("");
    expect(captured.xTickFormatter!("t1", 2)).toBe("Now");
    expect(captured.xTickFormatter!("fan-3", 3)).toBe("");
    expect(captured.xTickFormatter!("fan-5", 4)).toBe("+5");
    expect(captured.xTickFormatter!("fan-10", 5)).toBe("+10");
    expect(captured.xTickFormatter!("missing", 99)).toBe("");
    expect(
      captured.labelFormatter!("ignored", [{ payload: { label: "Jul 1" } }]),
    ).toBe("Jul 1");
    expect(
      captured.labelFormatter!("ignored", [
        { payload: { label: "Jul 1", current: true } },
      ]),
    ).toBe("Jul 1 · now");
    expect(
      captured.labelFormatter!("ignored", [
        { payload: { label: "3", estimated: true } },
      ]),
    ).toBe("+3 trades");
    expect(captured.labelFormatter!("ignored", [])).toBe("");
    expect(
      captured.tooltipFormatter!(20, "actual", { payload: { value: 20 } }),
    ).toEqual(["+$20.00", "Equity"]);
    expect(
      captured.tooltipFormatter!(40, "forecast", {
        payload: { value: 40, lo: 15, hi: 70, estimated: true },
      }),
    ).toEqual(["+$40.00  ·  10–90: +$15.00 to +$70.00", "Median"]);
    expect(
      captured.tooltipFormatter!(20, "forecast", {
        payload: { value: 20, lo: 20, hi: 20, current: true },
      }),
    ).toEqual(["+$20.00", "Median"]);
    expect(captured.tooltipFormatter!(20, "band", { payload: {} })).toEqual([
      null,
      null,
    ]);
  });

  it("falls back to a median-only fan tooltip when the band is missing", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "equityFan",
          valueUnit: "usd",
          data: [{ id: "fan-0", label: "Now", value: 0 }],
        })}
      />,
    );
    expect(
      captured.tooltipFormatter!(0, "forecast", { payload: { value: 0 } }),
    ).toEqual(["$0.00", "Median"]);
  });

  it("defaults unknown chart kinds to bar body", () => {
    render(
      <ChartRenderer
        chart={chart({
          type: "bySetup",
          data: [{ label: "Setup A", value: 3 }],
        })}
      />,
    );
    expect(screen.getByTestId("recharts-barchart")).toBeInTheDocument();
  });
});

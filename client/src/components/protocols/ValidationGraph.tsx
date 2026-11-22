/**
 * Renders one GraphData object (built by shared/protocols/graphs.ts from the
 * actual readings). Nothing is interpolated or invented: points are the
 * recorded values, lines are the identity line / least-squares regression of
 * those points, guides are zero / mean / mean ± SD of the same data.
 */
import { CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import type { GraphData } from "@shared/protocols/graphs";
import { fmt } from "@shared/protocols/graphs";

const COLORS = ["#0C5A4C", "#B4532A", "#3B5B8C", "#7A4E9C"];
const MAX_COLOR = "#C81E1E";
/** Points series get their own colour; a "(connected)" line reuses the colour of its points; other lines (identity / regression) a distinct one. */
export function seriesColor(graph: GraphData, index: number) {
  const s = graph.series[index];
  if (s.kind === "line" && s.name.endsWith("(connected)")) {
    const base = graph.series.findIndex(x => x.name === s.name.replace(/ \(connected\)$/, ""));
    if (base >= 0) return seriesColor(graph, base);
  }
  const pointsBefore = graph.series.slice(0, index).filter(x => x.kind === "points" && !x.name.startsWith("Maximum")).length;
  if (s.kind === "points") return COLORS[pointsBefore % COLORS.length];
  return s.name.startsWith("Ideal") ? "#6B7280" : COLORS[(pointsBefore + 1) % COLORS.length];
}
const GUIDE_COLORS: Record<string, string> = { Zero: "#6B7280", Mean: "#0C5A4C", Reference: "#B4532A" };

export function ValidationGraph({ graph, height = 300 }: { graph: GraphData; height?: number }) {
  return (
    <figure className="pm-card" style={{ margin: 0 }}>
      <figcaption style={{ fontWeight: 600, marginBottom: 6 }}>{graph.title}</figcaption>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 10, right: 24, bottom: 34, left: 18 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" dataKey="x" name={graph.xLabel} domain={["auto", "auto"]} tickFormatter={v => fmt(Number(v))} label={{ value: graph.xLabel, position: "insideBottom", offset: -18 }} />
            <YAxis type="number" dataKey="y" name={graph.yLabel} domain={["auto", "auto"]} tickFormatter={v => fmt(Number(v))} width={80} label={{ value: graph.yLabel, angle: -90, position: "insideLeft", offset: -6, style: { textAnchor: "middle" } }} />
            <Tooltip formatter={(v: number) => fmt(Number(v))} labelFormatter={() => ""} />
            <Legend verticalAlign="top" height={28} />
            {graph.guides.map(g => (
              <ReferenceLine key={g.name} y={g.y} stroke={GUIDE_COLORS[g.name] ?? "#9CA3AF"} strokeDasharray={g.name.includes("SD") ? "4 4" : "6 3"} label={{ value: `${g.name} ${fmt(g.y)}`, position: "right", fontSize: 10 }} />
            ))}
            {graph.series.map((s, i) => {
              const color = seriesColor(graph, i);
              if (s.name.startsWith("Maximum")) return <Scatter key={s.name} name={s.name} data={s.points} fill={MAX_COLOR} shape="star" isAnimationActive={false} />;
              return s.kind === "line" ? (
                <Scatter key={s.name} name={s.name} data={s.points} line={{ stroke: color, strokeWidth: 1.6, strokeDasharray: s.name.startsWith("Ideal") ? "5 4" : undefined }} shape={() => <g />} legendType={s.name.endsWith("(connected)") ? "none" : "line"} fill={color} isAnimationActive={false} />
              ) : (
                <Scatter key={s.name} name={s.name} data={s.points} fill={color} isAnimationActive={false} />
              );
            })}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {graph.notes.length > 0 && <div className="pm-muted" style={{ fontSize: 12 }}>{graph.notes.join(" · ")}</div>}
    </figure>
  );
}

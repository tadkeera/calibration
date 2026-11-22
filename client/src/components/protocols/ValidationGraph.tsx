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
            {graph.series.map((s, i) =>
              s.kind === "line" ? (
                <Scatter key={s.name} name={s.name} data={s.points} line={{ stroke: COLORS[(i + 1) % COLORS.length], strokeWidth: 1.6 }} shape={() => <g />} legendType="line" fill={COLORS[(i + 1) % COLORS.length]} isAnimationActive={false} />
              ) : (
                <Scatter key={s.name} name={s.name} data={s.points} fill={COLORS[i % COLORS.length]} isAnimationActive={false} />
              )
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {graph.notes.length > 0 && <div className="pm-muted" style={{ fontSize: 12 }}>{graph.notes.join(" · ")}</div>}
    </figure>
  );
}

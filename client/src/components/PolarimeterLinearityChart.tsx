import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import type { PolarimeterV2 } from "@shared/polarimeter";

export function PolarimeterLinearityChart({ data, title = "Concentration vs. Optical Rotation" }: { data: PolarimeterV2; title?: string }) {
  const points = data.linearity.points.map(point => {
    const x = data.protocolSnapshot.linearity.useActualConcentration
      ? Number(point.actualConcentration)
      : point.nominalConcentration;
    const y = Number(point.measuredOpticalRotation);
    return {
      x,
      y,
      fit: data.calculatedMetrics.regressionSlope * x + data.calculatedMetrics.regressionIntercept,
      pointNumber: point.pointNumber,
    };
  }).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.fit));
  const metrics = data.calculatedMetrics;
  return (
    <section className="chart-panel polarimeter-chart-panel" aria-label={title}>
      <div className="chart-heading">
        <div>
          <span className="eyebrow">Least-squares regression</span>
          <h3>{title}</h3>
        </div>
        <div className="polarimeter-chart-legend"><span><i className="point" />Measured points</span><span><i />Regression line</span></div>
      </div>
      <div className="polarimeter-chart-metrics">
        <span>y = {metrics.regressionSlope.toFixed(data.protocolSnapshot.linearity.displayPrecision)}x {metrics.regressionIntercept < 0 ? "−" : "+"} {Math.abs(metrics.regressionIntercept).toFixed(data.protocolSnapshot.linearity.displayPrecision)}</span>
        <span>r = {metrics.correlationCoefficient?.toFixed(data.protocolSnapshot.linearity.displayPrecision) ?? "Not defined"}</span>
        <span>R² = {metrics.coefficientOfDetermination?.toFixed(data.protocolSnapshot.linearity.displayPrecision) ?? "Not defined"}</span>
      </div>
      <div className="polarimeter-chart-area" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 12, right: 14, bottom: 24, left: 6 }}>
            <CartesianGrid vertical={false} stroke="#D7E0D9" strokeDasharray="2 6" />
            <XAxis type="number" dataKey="x" name="Concentration" domain={["dataMin", "dataMax"]} tickLine={false} axisLine={{ stroke: "#9BAAA0" }} tick={{ fill: "#6A756F", fontSize: 10 }} label={{ value: "Concentration (g/100ml)", position: "insideBottom", offset: -16, fill: "#586B61", fontSize: 10 }} />
            <YAxis type="number" dataKey="y" name="Optical rotation" domain={["auto", "auto"]} tickLine={false} axisLine={{ stroke: "#9BAAA0" }} tick={{ fill: "#6A756F", fontSize: 10 }} width={48} label={{ value: "Optical rotation (°)", angle: -90, position: "insideLeft", fill: "#586B61", fontSize: 10 }} />
            <Tooltip cursor={{ stroke: "#B88238", strokeDasharray: "3 3" }} formatter={(value: number, name: string) => [value.toFixed(6), name]} labelFormatter={value => `Concentration: ${Number(value).toFixed(6)} g/100ml`} contentStyle={{ borderRadius: 10, border: "1px solid #D5DED7", boxShadow: "0 10px 24px rgba(20,50,42,.12)" }} />
            <Line type="linear" dataKey="fit" name="Calculated regression line" stroke="#B88238" strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} />
            <Scatter dataKey="y" name="Measured optical-rotation points" fill="#0C5A4C" shape="circle" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/** Design reminder: charts follow the "دفتر المختبر الأخضر" ethos—measured, legible, and visually subordinate to the acceptance decision. */
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { label: string; value: number; reference?: number };

export function QCChart({ title, data }: { title: string; data: Point[] }) {
  return (
    <section className="chart-panel" aria-label={title}>
      <div className="chart-heading">
        <div>
          <span className="eyebrow">Measurement chart</span>
          <h3>{title}</h3>
        </div>
        <span className="chart-key"><i /> Actual reading</span>
      </div>
      <div className="h-[230px] w-full" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 14, right: 10, bottom: 4, left: -18 }}>
            <CartesianGrid vertical={false} stroke="#D7E0D9" strokeDasharray="2 6" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#6A756F", fontSize: 11 }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: "#6A756F", fontSize: 11 }} width={42} />
            <Tooltip cursor={{ stroke: "#B88238", strokeDasharray: "3 3" }} contentStyle={{ borderRadius: 12, border: "1px solid #D5DED7", boxShadow: "0 14px 30px rgba(20,50,42,.12)" }} />
            <Line type="monotone" dataKey="reference" stroke="#B88238" strokeDasharray="5 5" strokeWidth={1.5} dot={false} name="Reference value" connectNulls />
            <Line type="monotone" dataKey="value" stroke="#0C5A4C" strokeWidth={3} dot={{ r: 4, fill: "#FCFCF8", strokeWidth: 2.5 }} activeDot={{ r: 6 }} name="Actual reading" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

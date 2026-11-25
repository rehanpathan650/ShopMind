import { useState } from "react";
import { rupees, rupeesShort } from "../lib/format.js";

/**
 * Daily revenue bars. One series → no legend (the card title names it).
 * Hover/focus any day for an exact tooltip; a table view sits behind a toggle.
 */
export function RevenueChart({ data = [] }) {
  const [hover, setHover] = useState(null);
  const [table, setTable] = useState(false);

  if (!data.length) return <p className="muted">No sales yet.</p>;

  const W = 640, H = 220, padL = 44, padB = 24, padT = 10;
  const max = Math.max(...data.map((d) => d.revenue), 1);
  const nice = Math.ceil(max / 10 ** Math.floor(Math.log10(max))) * 10 ** Math.floor(Math.log10(max));
  const plotW = W - padL - 8;
  const plotH = H - padB - padT;
  const step = plotW / data.length;
  const barW = Math.max(Math.min(step - 2, 22), 2);
  const y = (v) => padT + plotH - (v / nice) * plotH;
  const ticks = [0, nice / 2, nice];
  const labelEvery = Math.ceil(data.length / 8);

  if (table) {
    return (
      <div>
        <button className="link-btn small" onClick={() => setTable(false)}>Show chart</button>
        <div className="table-wrap compact">
          <table className="table">
            <thead><tr><th>Day</th><th className="num">Bills</th><th className="num">Revenue</th></tr></thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day}><td>{d.day}</td><td className="num">{d.bills}</td><td className="num">{rupees(d.revenue)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const h = hover !== null ? data[hover] : null;

  return (
    <div className="chart">
      <button className="link-btn small chart-toggle" onClick={() => setTable(true)}>View as table</button>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily revenue, last 30 days" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} className="grid" />
            <text x={padL - 8} y={y(t) + 4} className="axis" textAnchor="end">{rupeesShort(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * step + (step - barW) / 2;
          const top = y(d.revenue);
          const hgt = Math.max(padT + plotH - top, d.revenue > 0 ? 2 : 0);
          const r = Math.min(4, barW / 2, hgt);
          return (
            <g key={d.day}>
              {hgt > 0 && (
                <path
                  className={`bar ${hover === i ? "on" : ""}`}
                  d={`M${x},${padT + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${padT + plotH} Z`}
                />
              )}
              {/* Hit target taller and wider than the mark */}
              <rect
                x={padL + i * step}
                y={padT}
                width={step}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${d.day}: ${rupees(d.revenue)}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
              {i % labelEvery === 0 && (
                <text x={padL + i * step + step / 2} y={H - 6} className="axis" textAnchor="middle">
                  {new Date(d.day).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </text>
              )}
            </g>
          );
        })}
        <line x1={padL} x2={W - 8} y1={padT + plotH} y2={padT + plotH} className="baseline" />
      </svg>
      {h && (
        <div className="tooltip" style={{ left: `${((padL + hover * step + step / 2) / W) * 100}%` }}>
          <span>{new Date(h.day).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</span>
          <strong>{rupees(h.revenue)}</strong>
          <span>{h.bills} bill{h.bills === 1 ? "" : "s"}</span>
        </div>
      )}
    </div>
  );
}

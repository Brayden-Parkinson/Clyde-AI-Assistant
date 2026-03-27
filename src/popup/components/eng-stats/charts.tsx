import React, { useState } from "react";
import { OS } from "@shared/tokens";
import { dk, predictPoints, linearRegression, type WeekBucket } from "./shared";

// ─── Sub-components ───

export function Sparkline({
  data,
  width = 64,
  height = 26,
  color = OS.blue,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;
  const points = data
    .map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (width - pad * 2);
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block", flexShrink: 0 }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface KPICardProps {
  label: string;
  value: string;
  sparklineData?: number[];
  deltaPercent?: number | null;
  deltaPeriodLabel?: string;
  detailSub?: string;
  alertBorder?: boolean;
  trendPositive?: boolean; // true = up is good (volume metrics), false = down is good (time metrics)
  dark: boolean;
  showDelta?: boolean;
  showSparkline?: boolean;
  showSubtitle?: boolean;
}

export function KPICard({
  label,
  value,
  sparklineData,
  deltaPercent,
  deltaPeriodLabel,
  detailSub,
  alertBorder,
  trendPositive = true,
  dark,
  showDelta = true,
  showSparkline = true,
  showSubtitle = true,
}: KPICardProps) {
  const deltaUp = deltaPercent != null && deltaPercent > 0;
  const deltaDown = deltaPercent != null && deltaPercent < 0;
  const deltaGreen = trendPositive ? deltaUp : deltaDown;
  const deltaRed = trendPositive ? deltaDown : deltaUp;
  const deltaColor = deltaGreen
    ? OS.green
    : deltaRed
      ? OS.red
      : dk(dark, "#888", OS.muted);
  const deltaArrow = deltaUp ? "↑" : deltaDown ? "↓" : "";
  const absDelta = deltaPercent != null ? Math.abs(Math.round(deltaPercent)) : null;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 120,
        padding: "14px 16px 12px",
        borderRadius: 10,
        border: alertBorder
          ? "1px solid rgba(232, 93, 93, 0.2)"
          : `1px solid ${dk(dark, "rgba(255,255,255,0.08)", OS.border)}`,
        borderTop: alertBorder
          ? "2px solid rgba(232, 93, 93, 0.3)"
          : undefined,
        background: dk(dark, "#1c1c22", OS.white),
      }}
    >
      <div
        style={{
          fontFamily: OS.mono,
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: dk(dark, "rgba(255,255,255,0.45)", OS.muted),
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: OS.mono,
            fontSize: 24,
            fontWeight: 700,
            color: dk(dark, "#fff", OS.text),
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        {showSparkline && sparklineData && sparklineData.length >= 2 && (
          <Sparkline
            data={sparklineData}
            color={dk(dark, "rgba(255,255,255,0.5)", OS.blue)}
          />
        )}
      </div>

      {showDelta && deltaPercent != null && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: detailSub ? 6 : 0,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              fontSize: 11,
              fontFamily: OS.mono,
              fontWeight: 600,
              color: deltaColor,
              background: deltaGreen
                ? "rgba(59,140,95,0.1)"
                : deltaRed
                  ? "rgba(209,67,67,0.1)"
                  : "transparent",
              borderRadius: 4,
              padding: "1px 5px",
            }}
          >
            {deltaArrow} {absDelta != null ? `${absDelta}%` : "—"}
          </span>
          {deltaPeriodLabel && (
            <span
              style={{
                fontSize: 10,
                color: dk(dark, "rgba(255,255,255,0.25)", OS.faint),
                fontFamily: OS.mono,
              }}
            >
              {deltaPeriodLabel}
            </span>
          )}
        </div>
      )}

      {showSubtitle && detailSub && (
        <div
          style={{
            fontSize: 11,
            color: dk(dark, "rgba(255,255,255,0.3)", OS.muted),
            fontFamily: OS.font,
          }}
        >
          {detailSub}
        </div>
      )}
    </div>
  );
}

// ─── Cycle Time Area Chart (pure SVG) ───

export function CycleTimeChart({
  buckets,
  dark,
  annotations,
  fullWidth,
  height: heightOverride,
}: {
  buckets: WeekBucket[];
  dark: boolean;
  annotations?: Record<string, string>;
  fullWidth?: boolean;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = fullWidth ? 900 : 640;
  const H = heightOverride ?? 240;
  const PAD = { top: 24, right: 16, bottom: 32, left: 44 };

  const days = buckets.map((b) => b.avgHours / 24);
  const predCount = Math.max(1, Math.ceil(buckets.length * 0.25));
  const predicted = predictPoints(days, predCount);
  const totalPts = days.length + predCount;

  const allVals = [...days, ...predicted];
  const maxDay = Math.max(...allVals, 1);
  const gridStep = Math.max(2, Math.ceil(maxDay / 3) * 2);
  const yMax = Math.ceil(maxDay / gridStep) * gridStep || gridStep;
  const gridLines: number[] = [];
  for (let g = 0; g <= yMax; g += gridStep) gridLines.push(g);

  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const toX = (i: number) =>
    PAD.left + (totalPts > 1 ? (i / (totalPts - 1)) * chartW : chartW / 2);
  const toY = (d: number) => PAD.top + chartH - (Math.max(0, d) / yMax) * chartH;

  // Actual data path
  const pathD = days
    .map((d, i) => `${i === 0 ? "M" : "L"} ${toX(i)} ${toY(d)}`)
    .join(" ");
  const areaD = `${pathD} L ${toX(days.length - 1)} ${toY(0)} L ${toX(0)} ${toY(0)} Z`;

  // Prediction path (from last real point through predicted)
  const predPathD = [days[days.length - 1], ...predicted]
    .map((d, i) => `${i === 0 ? "M" : "L"} ${toX(days.length - 1 + i)} ${toY(d)}`)
    .join(" ");

  // Trend line (regression across full range)
  const { slope, intercept } = linearRegression(days);
  const trendStart = intercept;
  const trendEnd = intercept + slope * (totalPts - 1);

  const gridColor = dk(dark, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.06)");
  const textColor = dk(dark, "rgba(255,255,255,0.4)", OS.muted);
  const predColor = dk(dark, "rgba(91,156,246,0.4)", "rgba(94,106,210,0.4)");
  const gradId = `ctAreaGrad_${fullWidth ? "fw" : "sm"}`;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      style={{ display: "block" }}
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={OS.blue} stopOpacity={0.25} />
          <stop offset="100%" stopColor={OS.blue} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* Grid lines + y-axis labels */}
      {gridLines.map((g) => (
        <g key={g}>
          <line x1={PAD.left} x2={W - PAD.right} y1={toY(g)} y2={toY(g)} stroke={gridColor} strokeWidth={1} />
          <text x={PAD.left - 6} y={toY(g) + 3} textAnchor="end" fontSize={9} fill={textColor} fontFamily={OS.mono}>{g}d</text>
        </g>
      ))}

      {/* Trend line (full range — subtle) */}
      {days.length >= 3 && (
        <line
          x1={toX(0)} y1={toY(trendStart)} x2={toX(totalPts - 1)} y2={toY(trendEnd)}
          stroke={dk(dark, "rgba(255,255,255,0.12)", "rgba(0,0,0,0.08)")}
          strokeWidth={1} strokeDasharray="6,4"
        />
      )}

      {/* Area fill (actual data only) */}
      {days.length >= 2 && <path d={areaD} fill={`url(#${gradId})`} />}

      {/* Actual data line */}
      {days.length >= 2 && (
        <path d={pathD} fill="none" stroke={OS.blue} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      )}

      {/* Prediction separator — vertical dotted line */}
      {days.length >= 3 && (
        <line
          x1={toX(days.length - 1)} y1={PAD.top} x2={toX(days.length - 1)} y2={PAD.top + chartH}
          stroke={dk(dark, "rgba(255,255,255,0.15)", "rgba(0,0,0,0.12)")}
          strokeWidth={1} strokeDasharray="3,3"
        />
      )}

      {/* Prediction line (dashed, faded) */}
      {days.length >= 3 && (
        <path d={predPathD} fill="none" stroke={predColor} strokeWidth={2} strokeDasharray="4,3" strokeLinejoin="round" />
      )}

      {/* Prediction data points (hollow) */}
      {days.length >= 3 && predicted.map((d, i) => (
        <circle key={`pred_${i}`} cx={toX(days.length + i)} cy={toY(d)} r={2.5}
          fill="none" stroke={predColor} strokeWidth={1.5} />
      ))}

      {/* Annotation lines */}
      {annotations && buckets.map((b, i) => {
        const anno = annotations[b.label];
        if (!anno) return null;
        const x = toX(i);
        const y = toY(days[i]);
        return (
          <g key={`anno_${i}`}>
            <line x1={x} y1={y - 4} x2={x} y2={PAD.top} stroke={OS.warning} strokeWidth={1} strokeDasharray="3,2" opacity={0.6} />
            <text x={x} y={PAD.top - 4} textAnchor="middle" fill={OS.warning} fontSize={8} fontFamily={OS.mono} opacity={0.8}>{anno}</text>
          </g>
        );
      })}

      {/* Actual data points */}
      {days.map((d, i) => {
        const hasAnno = annotations?.[buckets[i].label];
        return (
          <circle key={i} cx={toX(i)} cy={toY(d)}
            r={hover === i ? 4 : hasAnno ? 3.5 : 3}
            fill={hasAnno ? OS.warning : OS.blue}
            stroke={dk(dark, "#1c1c22", OS.white)} strokeWidth={1.5} />
        );
      })}

      {/* Hover zones (actual data only) */}
      {days.map((_, i) => (
        <rect key={`hz_${i}`} x={toX(i) - chartW / totalPts / 2} y={PAD.top}
          width={chartW / totalPts} height={chartH} fill="transparent"
          onMouseEnter={() => setHover(i)} />
      ))}

      {/* Tooltip */}
      {hover !== null && days[hover] !== undefined && (
        <g>
          <line x1={toX(hover)} y1={PAD.top} x2={toX(hover)} y2={PAD.top + chartH}
            stroke={dk(dark, "rgba(255,255,255,0.15)", "rgba(0,0,0,0.1)")} strokeWidth={1} />
          <rect x={toX(hover) - 30} y={toY(days[hover]) - 22} width={60} height={18} rx={3}
            fill={dk(dark, "rgba(0,0,0,0.85)", "rgba(0,0,0,0.75)")} stroke={dk(dark, "rgba(255,255,255,0.1)", "rgba(0,0,0,0.2)")} />
          <text x={toX(hover)} y={toY(days[hover]) - 10} textAnchor="middle"
            fill="#e2e8f0" fontSize={10} fontFamily={OS.mono}>{days[hover].toFixed(1)}d</text>
        </g>
      )}

      {/* X labels (actual data) */}
      {buckets.map((b, i) => {
        const step = buckets.length > 8 ? Math.ceil(buckets.length / 6) : 1;
        if (i % step !== 0 && i !== buckets.length - 1) return null;
        return (
          <text key={i} x={toX(i)} y={H - 6} textAnchor="middle" fontSize={9} fill={textColor} fontFamily={OS.mono}>{b.label}</text>
        );
      })}

      {/* Prediction label */}
      {days.length >= 3 && (
        <text x={toX(days.length + Math.floor(predCount / 2))} y={H - 6} textAnchor="middle"
          fontSize={8} fill={predColor} fontFamily={OS.mono} fontStyle="italic">
          forecast
        </text>
      )}
    </svg>
  );
}

// ─── Projection Chart (historical + forecast) ───

export function ProjectionChart({
  history,
  forecast,
  dark,
  height = 180,
}: {
  /** Weekly historical open-PR counts, oldest first. Each entry: { label, count } */
  history: { label: string; count: number }[];
  /** Weekly projected counts, starting from "now". Each entry: { label, count } */
  forecast: { label: string; count: number }[];
  dark: boolean;
  height?: number;
}) {
  if (history.length === 0 && forecast.length === 0) return null;

  const W = 480;
  const H = height;
  const pad = { top: 14, right: 16, bottom: 30, left: 42 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  // Merge into a single series; the divider is at history.length - 1 (last history point = first forecast point)
  const allPoints = [
    ...history.map((h, i) => ({ idx: i, count: h.count, label: h.label, isHistory: true })),
    ...forecast.slice(1).map((f, i) => ({ idx: history.length + i, count: f.count, label: f.label, isHistory: false })),
  ];
  const totalPts = allPoints.length;
  if (totalPts < 2) return null;

  const dividerIdx = history.length - 1; // index of "Today" point

  const counts = allPoints.map((p) => p.count);
  const minY = Math.min(...counts);
  const maxY = Math.max(...counts);
  const padding = Math.max(Math.round((maxY - minY) * 0.15), 3);
  const yMin = Math.max(0, minY - padding);
  const yMax = maxY + padding;
  const rangeY = yMax - yMin || 1;

  const x = (idx: number) => pad.left + (idx / (totalPts - 1)) * chartW;
  const y = (count: number) => pad.top + chartH - ((count - yMin) / rangeY) * chartH;

  // Colors
  const blue = dark ? "#60A5FA" : "#2563EB";
  const amber = dark ? "#FB923C" : "#EA580C";
  const amberFaint = dark ? "rgba(251,146,60,0.10)" : "rgba(234,88,12,0.06)";
  const blueFaint = dark ? "rgba(96,165,250,0.10)" : "rgba(37,99,235,0.06)";
  const gridColor = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const labelColor = dark ? "rgba(255,255,255,0.4)" : OS.muted;
  const textColor = dark ? "rgba(255,255,255,0.7)" : OS.secondary;

  // Y-axis ticks (4 ticks)
  const yTicks = Array.from({ length: 4 }, (_, i) => Math.round(yMin + (rangeY * i) / 3));

  // History path (solid blue)
  const histPts = allPoints.filter((_, i) => i <= dividerIdx);
  const histLine = histPts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.idx).toFixed(1)},${y(p.count).toFixed(1)}`).join(" ");
  const histArea = histPts.length > 1
    ? `${histLine} L${x(histPts[histPts.length - 1].idx).toFixed(1)},${(pad.top + chartH).toFixed(1)} L${x(0).toFixed(1)},${(pad.top + chartH).toFixed(1)} Z`
    : "";

  // Forecast path (dashed amber) — starts from divider point
  const fcPts = allPoints.filter((_, i) => i >= dividerIdx);
  const fcLine = fcPts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.idx).toFixed(1)},${y(p.count).toFixed(1)}`).join(" ");
  const fcArea = fcPts.length > 1
    ? `${fcLine} L${x(fcPts[fcPts.length - 1].idx).toFixed(1)},${(pad.top + chartH).toFixed(1)} L${x(fcPts[0].idx).toFixed(1)},${(pad.top + chartH).toFixed(1)} Z`
    : "";

  // X-axis labels — show a subset to avoid crowding
  const xLabels: { idx: number; label: string }[] = [];
  if (totalPts <= 8) {
    allPoints.forEach((p) => xLabels.push({ idx: p.idx, label: p.label }));
  } else {
    // Always show first, divider ("Now"), and last; fill evenly between
    xLabels.push({ idx: 0, label: allPoints[0].label });
    // Show a midpoint in history if there's room
    if (dividerIdx > 2) {
      const mid = Math.round(dividerIdx / 2);
      xLabels.push({ idx: mid, label: allPoints[mid].label });
    }
    xLabels.push({ idx: dividerIdx, label: "Now" });
    // Show midpoint in forecast if there's room
    const fcMid = dividerIdx + Math.round((totalPts - 1 - dividerIdx) / 2);
    if (fcMid > dividerIdx && fcMid < totalPts - 1) {
      xLabels.push({ idx: fcMid, label: allPoints[fcMid].label });
    }
    if (totalPts - 1 !== dividerIdx) {
      xLabels.push({ idx: totalPts - 1, label: allPoints[totalPts - 1].label });
    }
  }

  const todayPt = allPoints[dividerIdx];
  const lastPt = allPoints[totalPts - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {/* Grid lines */}
      {yTicks.map((tick) => (
        <g key={tick}>
          <line x1={pad.left} x2={W - pad.right} y1={y(tick)} y2={y(tick)} stroke={gridColor} strokeWidth={1} />
          <text x={pad.left - 6} y={y(tick) + 3} textAnchor="end" fill={labelColor} fontSize={9} fontFamily={OS.mono}>{tick}</text>
        </g>
      ))}

      {/* History area + line */}
      {histArea && <path d={histArea} fill={blueFaint} />}
      {histLine && <path d={histLine} fill="none" stroke={blue} strokeWidth={2} />}

      {/* Forecast area + line */}
      {fcArea && <path d={fcArea} fill={amberFaint} />}
      {fcLine && <path d={fcLine} fill="none" stroke={amber} strokeWidth={2} strokeDasharray="6 3" />}

      {/* "Now" divider */}
      <line x1={x(dividerIdx)} x2={x(dividerIdx)} y1={pad.top} y2={pad.top + chartH} stroke={labelColor} strokeWidth={1} strokeDasharray="3 3" />

      {/* History dots */}
      {histPts.map((p) => (
        <circle key={`h${p.idx}`} cx={x(p.idx)} cy={y(p.count)} r={3} fill={blue} />
      ))}

      {/* Forecast dots */}
      {fcPts.slice(1).map((p) => (
        <circle key={`f${p.idx}`} cx={x(p.idx)} cy={y(p.count)} r={3} fill={amber} />
      ))}

      {/* Today value label */}
      <text x={x(dividerIdx)} y={y(todayPt.count) - 8} textAnchor="middle" fill={textColor} fontSize={10} fontWeight={600} fontFamily={OS.mono}>{todayPt.count}</text>

      {/* Final projected value label */}
      {lastPt.idx !== dividerIdx && (
        <text x={x(lastPt.idx)} y={y(lastPt.count) - 8} textAnchor="end" fill={amber} fontSize={10} fontWeight={700} fontFamily={OS.mono}>{lastPt.count}</text>
      )}

      {/* X-axis labels */}
      {xLabels.map(({ idx, label }) => (
        <text key={idx} x={x(idx)} y={H - 8} textAnchor="middle" fill={idx === dividerIdx ? textColor : labelColor} fontSize={9} fontWeight={idx === dividerIdx ? 600 : 400} fontFamily={OS.mono}>{label}</text>
      ))}
    </svg>
  );
}

// ─── PR Size Donut Chart ───

export function PRSizeChart({
  small,
  medium,
  large,
  dark,
}: {
  small: number;
  medium: number;
  large: number;
  dark: boolean;
}) {
  const total = small + medium + large || 1;
  const smallPct = Math.round((small / total) * 100);
  const isGood = smallPct >= 60;

  const segments = [
    { value: small, color: OS.green, label: "Small", range: "<100 lines" },
    { value: medium, color: OS.warning, label: "Medium", range: "100–499" },
    { value: large, color: OS.red, label: "Large", range: "500+ lines" },
  ];

  const r = 38;
  const sw = 14;
  const cx = 50;
  const cy = 50;
  const circumference = 2 * Math.PI * r;
  let cumulative = 0;

  return (
    <div>
      {/* Headline insight */}
      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: dk(dark, "#fff", OS.text),
          }}
        >
          {smallPct}% of PRs are small
        </div>
        <div
          style={{
            fontSize: 11,
            color: dk(dark, "rgba(255,255,255,0.35)", OS.muted),
            marginTop: 2,
          }}
        >
          {isGood ? "keeping reviews fast" : "room to break PRs down further"}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {/* Donut */}
        <svg width={100} height={100} style={{ flexShrink: 0 }}>
          {segments.map((seg, i) => {
            const pct = seg.value / total;
            const dash = pct * circumference;
            const gap = circumference - dash;
            const offset =
              -cumulative * circumference + circumference * 0.25;
            cumulative += pct;
            return pct > 0 ? (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={sw}
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={offset}
                strokeLinecap="butt"
              />
            ) : null;
          })}
          <text
            x={cx}
            y={cy - 2}
            textAnchor="middle"
            dominantBaseline="auto"
            fontSize={16}
            fontWeight={700}
            fontFamily={OS.mono}
            fill={dk(dark, "#fff", OS.text)}
          >
            {smallPct}%
          </text>
          <text
            x={cx}
            y={cy + 11}
            textAnchor="middle"
            dominantBaseline="auto"
            fontSize={9}
            fontFamily={OS.mono}
            fill={dk(dark, "rgba(255,255,255,0.35)", OS.muted)}
          >
            small
          </text>
        </svg>

        {/* Legend */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {segments.map((seg) => (
            <div
              key={seg.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: seg.color,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  color: dk(dark, "rgba(255,255,255,0.7)", OS.secondary),
                  fontWeight: 500,
                  minWidth: 48,
                }}
              >
                {seg.label}
              </span>
              <span
                style={{
                  fontFamily: OS.mono,
                  color: dk(dark, "#fff", OS.text),
                  fontWeight: 600,
                  minWidth: 24,
                }}
              >
                {seg.value}
              </span>
              <span
                style={{
                  color: dk(dark, "rgba(255,255,255,0.25)", OS.faint),
                  fontFamily: OS.mono,
                  fontSize: 10,
                }}
              >
                {seg.range}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Catmull-Rom → cubic Bézier smooth path ───

export function smoothPath(pts: { x: number; y: number }[], tension = 0.3): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    const cp1x = p1.x + (p2.x - p0.x) * tension / 3;
    const cp1y = p1.y + (p2.y - p0.y) * tension / 3;
    const cp2x = p2.x - (p3.x - p1.x) * tension / 3;
    const cp2y = p2.y - (p3.y - p1.y) * tension / 3;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export function smoothArea(pts: { x: number; y: number }[], baseY: number, tension = 0.3): string {
  const line = smoothPath(pts, tension);
  if (!line || pts.length < 2) return "";
  return `${line} L ${pts[pts.length - 1].x} ${baseY} L ${pts[0].x} ${baseY} Z`;
}

// ─── AI Adoption Line Chart with target (pure SVG) ───

export function AIAdoptionChart({
  weeklyPcts,
  dark,
  annotations,
  fullWidth,
  height: heightOverride,
}: {
  weeklyPcts: { label: string; pct: number }[];
  dark: boolean;
  annotations?: Record<string, string>;
  fullWidth?: boolean;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = fullWidth ? 900 : 640;
  const H = heightOverride ?? 220;
  const PAD = { top: 24, right: 16, bottom: 32, left: 36 };

  if (weeklyPcts.length < 2) return null;

  const pcts = weeklyPcts.map((w) => w.pct);
  const predCount = Math.max(1, Math.ceil(weeklyPcts.length * 0.25));
  const predicted = predictPoints(pcts, predCount);
  const totalPts = pcts.length + predCount;

  const allVals = [...pcts, ...predicted];
  const dataMax = Math.max(...allVals);
  const maxPct = Math.max(dataMax * 1.25, 5);

  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const toX = (i: number) =>
    PAD.left + (totalPts > 1 ? (i / (totalPts - 1)) * chartW : chartW / 2);
  const toY = (v: number) => PAD.top + chartH - (Math.max(0, v) / maxPct) * chartH;

  const points = weeklyPcts.map((w, i) => ({
    x: toX(i), y: toY(w.pct), label: w.label, pct: w.pct,
  }));

  const pathD = smoothPath(points, 0.3);
  const areaD = smoothArea(points, PAD.top + chartH, 0.3);

  // Prediction path
  const predPathD = [pcts[pcts.length - 1], ...predicted]
    .map((v, i) => `${i === 0 ? "M" : "L"} ${toX(pcts.length - 1 + i)} ${toY(v)}`)
    .join(" ");

  // Trend line
  const { slope, intercept } = linearRegression(pcts);
  const trendStart = intercept;
  const trendEnd = intercept + slope * (totalPts - 1);

  const textColor = dk(dark, "rgba(255,255,255,0.4)", OS.muted);
  const predColor = dk(dark, "rgba(91,156,246,0.4)", "rgba(94,106,210,0.4)");

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      style={{ display: "block" }}
      onMouseLeave={() => setHover(null)}
    >
      {/* Y-axis grid + labels */}
      {[0, 1, 2, 3, 4].map((i) => {
        const y = PAD.top + (i / 4) * chartH;
        const val = maxPct - (i / 4) * maxPct;
        return (
          <g key={`ygrid_${i}`}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
              stroke={dk(dark, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.06)")} />
            <text x={PAD.left - 6} y={y + 3} textAnchor="end" fill={textColor} fontSize={9} fontFamily={OS.mono}>
              {Math.round(val)}%
            </text>
          </g>
        );
      })}

      {/* Trend line (full range — subtle) */}
      {pcts.length >= 3 && (
        <line
          x1={toX(0)} y1={toY(trendStart)} x2={toX(totalPts - 1)} y2={toY(trendEnd)}
          stroke={dk(dark, "rgba(255,255,255,0.12)", "rgba(0,0,0,0.08)")}
          strokeWidth={1} strokeDasharray="6,4"
        />
      )}

      {/* Area fill (actual data only) */}
      <path d={areaD} fill={`${OS.blue}15`} />

      {/* Actual data line */}
      <path d={pathD} fill="none" stroke={OS.blue} strokeWidth={1.5} />

      {/* Prediction separator */}
      {pcts.length >= 3 && (
        <line
          x1={toX(pcts.length - 1)} y1={PAD.top} x2={toX(pcts.length - 1)} y2={PAD.top + chartH}
          stroke={dk(dark, "rgba(255,255,255,0.15)", "rgba(0,0,0,0.12)")}
          strokeWidth={1} strokeDasharray="3,3"
        />
      )}

      {/* Prediction line (dashed, faded) */}
      {pcts.length >= 3 && (
        <path d={predPathD} fill="none" stroke={predColor} strokeWidth={1.5} strokeDasharray="4,3" strokeLinejoin="round" />
      )}

      {/* Prediction points (hollow) */}
      {pcts.length >= 3 && predicted.map((v, i) => (
        <circle key={`pred_${i}`} cx={toX(pcts.length + i)} cy={toY(v)} r={2.5}
          fill="none" stroke={predColor} strokeWidth={1.5} />
      ))}

      {/* Annotation lines */}
      {annotations && points.map((p, i) => {
        const anno = annotations[p.label];
        if (!anno) return null;
        return (
          <g key={`anno_${i}`}>
            <line x1={p.x} y1={p.y - 4} x2={p.x} y2={PAD.top} stroke={OS.warning} strokeWidth={1} strokeDasharray="3,2" opacity={0.6} />
            <text x={p.x} y={PAD.top - 4} textAnchor="middle" fill={OS.warning} fontSize={8} fontFamily={OS.mono} opacity={0.8}>{anno}</text>
          </g>
        );
      })}

      {/* Data points — hidden by default, visible on hover + annotations */}
      {points.map((p, i) => {
        const hasAnno = annotations?.[p.label];
        const isHovered = hover === i;
        if (!hasAnno && !isHovered) return null;
        return (
          <circle key={i} cx={p.x} cy={p.y} r={isHovered ? 4 : 3.5}
            fill={hasAnno ? OS.warning : OS.blue} />
        );
      })}

      {/* Hover zones (actual data only) */}
      {points.map((_, i) => (
        <rect key={`hz_${i}`} x={points[i].x - chartW / totalPts / 2} y={PAD.top}
          width={chartW / totalPts} height={chartH} fill="transparent"
          onMouseEnter={() => setHover(i)} />
      ))}

      {/* Tooltip */}
      {hover !== null && points[hover] && (
        <g>
          <line x1={points[hover].x} y1={PAD.top} x2={points[hover].x} y2={PAD.top + chartH}
            stroke={dk(dark, "rgba(255,255,255,0.15)", "rgba(0,0,0,0.1)")} strokeWidth={1} />
          <rect x={points[hover].x - 42} y={points[hover].y - 22} width={84} height={18} rx={3}
            fill={dk(dark, "rgba(0,0,0,0.85)", "rgba(0,0,0,0.75)")} stroke={dk(dark, "rgba(255,255,255,0.1)", "rgba(0,0,0,0.2)")} />
          <text x={points[hover].x} y={points[hover].y - 10} textAnchor="middle"
            fill="#e2e8f0" fontSize={10} fontFamily={OS.mono}>{points[hover].pct}% AI-assisted</text>
        </g>
      )}

      {/* X labels (actual data) */}
      {points.filter((_, i) => i % Math.max(1, Math.floor(weeklyPcts.length / 6)) === 0 || i === weeklyPcts.length - 1).map((p, i) => (
        <text key={`x${i}`} x={p.x} y={H - 6} textAnchor="middle" fill={textColor} fontSize={9} fontFamily={OS.mono}>
          {p.label}
        </text>
      ))}

      {/* Prediction label */}
      {pcts.length >= 3 && (
        <text x={toX(pcts.length + Math.floor(predCount / 2))} y={H - 6} textAnchor="middle"
          fontSize={8} fill={predColor} fontFamily={OS.mono} fontStyle="italic">
          forecast
        </text>
      )}
    </svg>
  );
}

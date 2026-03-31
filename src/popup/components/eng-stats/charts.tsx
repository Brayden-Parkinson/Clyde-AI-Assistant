import React, { useState, useRef, useEffect } from "react";
import { OS } from "@shared/tokens";
import { dk, predictPoints, linearRegression, fmtHours, type WeekBucket, type MatrixPoint } from "./shared";

// ─── InfoTip ───

export function InfoTip({ text, dark }: { text: string; dark: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [alignRight, setAlignRight] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Check if tooltip would overflow right edge — align right if so
  useEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setAlignRight(rect.left + 240 > window.innerWidth - 20);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <div
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          border: `1.5px solid ${dk(dark, "rgba(255,255,255,0.35)", "rgba(0,0,0,0.3)")}`,
          background: dk(dark, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.04)"),
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, fontFamily: OS.mono, color: dk(dark, "rgba(255,255,255,0.6)", OS.muted), lineHeight: 1 }}>i</span>
      </div>
      {open && (
        <div
          style={{
            position: "fixed",
            top: ref.current ? ref.current.getBoundingClientRect().bottom + 6 : 0,
            left: alignRight ? undefined : (ref.current ? ref.current.getBoundingClientRect().left : 0),
            right: alignRight ? 16 : undefined,
            width: 260,
            padding: "10px 12px",
            borderRadius: 8,
            background: dk(dark, "rgba(30,30,38,0.97)", "rgba(255,255,255,0.98)"),
            border: `1px solid ${dk(dark, "rgba(255,255,255,0.12)", OS.border)}`,
            boxShadow: dk(dark, "0 4px 16px rgba(0,0,0,0.5)", "0 4px 16px rgba(0,0,0,0.12)"),
            zIndex: 9999,
            fontSize: 11,
            lineHeight: 1.5,
            color: dk(dark, "rgba(255,255,255,0.7)", OS.secondary),
            fontFamily: OS.font,
            fontWeight: 400,
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

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
  const dataMax = Math.max(...allVals, 1);
  const maxVal = Math.max(dataMax * 1.25, 1);

  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const toX = (i: number) =>
    PAD.left + (totalPts > 1 ? (i / (totalPts - 1)) * chartW : chartW / 2);
  const toY = (d: number) => PAD.top + chartH - (Math.max(0, d) / maxVal) * chartH;

  // Smooth actual data path (Catmull-Rom)
  const pts = days.map((d, i) => ({ x: toX(i), y: toY(d) }));
  const pathD = smoothPath(pts, 0.3);
  const areaD = smoothArea(pts, PAD.top + chartH, 0.3);

  // Prediction path (from last real point through predicted)
  const predPathD = [days[days.length - 1], ...predicted]
    .map((d, i) => `${i === 0 ? "M" : "L"} ${toX(days.length - 1 + i)} ${toY(d)}`)
    .join(" ");

  // Trend line (regression across full range)
  const { slope, intercept } = linearRegression(days);
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
      {/* Y-axis grid + labels (5 evenly-spaced lines like AI adoption) */}
      {[0, 1, 2, 3, 4].map((i) => {
        const y = PAD.top + (i / 4) * chartH;
        const val = maxVal - (i / 4) * maxVal;
        return (
          <g key={`ygrid_${i}`}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
              stroke={dk(dark, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.06)")} />
            <text x={PAD.left - 6} y={y + 3} textAnchor="end" fill={textColor} fontSize={9} fontFamily={OS.mono}>
              {val < 10 ? val.toFixed(1) : Math.round(val)}d
            </text>
          </g>
        );
      })}

      {/* Trend line (full range — subtle) */}
      {days.length >= 3 && (
        <line
          x1={toX(0)} y1={toY(trendStart)} x2={toX(totalPts - 1)} y2={toY(trendEnd)}
          stroke={dk(dark, "rgba(255,255,255,0.12)", "rgba(0,0,0,0.08)")}
          strokeWidth={1} strokeDasharray="6,4"
        />
      )}

      {/* Area fill (flat transparent — matches AI adoption) */}
      {days.length >= 2 && <path d={areaD} fill={`${OS.blue}15`} />}

      {/* Actual data line (smooth Catmull-Rom) */}
      {days.length >= 2 && (
        <path d={pathD} fill="none" stroke={OS.blue} strokeWidth={1.5} />
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
        <path d={predPathD} fill="none" stroke={predColor} strokeWidth={1.5} strokeDasharray="4,3" strokeLinejoin="round" />
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
        const px = toX(i);
        const py = toY(days[i]);
        return (
          <g key={`anno_${i}`}>
            <line x1={px} y1={py - 4} x2={px} y2={PAD.top} stroke={OS.warning} strokeWidth={1} strokeDasharray="3,2" opacity={0.6} />
            <text x={px} y={PAD.top - 4} textAnchor="middle" fill={OS.warning} fontSize={8} fontFamily={OS.mono} opacity={0.8}>{anno}</text>
          </g>
        );
      })}

      {/* Data points — hidden by default, visible on hover + annotations */}
      {days.map((d, i) => {
        const hasAnno = annotations?.[buckets[i].label];
        const isHovered = hover === i;
        if (!hasAnno && !isHovered) return null;
        return (
          <circle key={i} cx={toX(i)} cy={toY(d)}
            r={isHovered ? 4 : 3.5}
            fill={hasAnno ? OS.warning : OS.blue} />
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

// ─── PR Flow Chart (opened vs closed per week, with trend lines) ───

export function PRFlowChart({
  weeks,
  dark,
}: {
  /** Weekly opened/closed counts, oldest first */
  weeks: { label: string; opened: number; closed: number }[];
  dark: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (weeks.length < 2) return null;

  const W = 640;
  const H = 140;
  const PAD = { top: 20, right: 16, bottom: 28, left: 32 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const opened = weeks.map((w) => w.opened);
  const closed = weeks.map((w) => w.closed);
  const allVals = [...opened, ...closed];
  const dataMax = Math.max(...allVals, 1);
  const maxVal = Math.max(dataMax * 1.25, 1);

  const toX = (i: number) =>
    PAD.left + (weeks.length > 1 ? (i / (weeks.length - 1)) * chartW : chartW / 2);
  const toY = (v: number) => PAD.top + chartH - (Math.max(0, v) / maxVal) * chartH;

  // Smooth paths
  const openPts = opened.map((v, i) => ({ x: toX(i), y: toY(v) }));
  const closePts = closed.map((v, i) => ({ x: toX(i), y: toY(v) }));
  const openPath = smoothPath(openPts, 0.3);
  const closePath = smoothPath(closePts, 0.3);

  // Trend lines
  const openTrend = linearRegression(opened);
  const closeTrend = linearRegression(closed);

  const textColor = dk(dark, "rgba(255,255,255,0.4)", OS.muted);
  const openColor = dark ? "#F87171" : "#DC2626"; // red for opened
  const closeColor = OS.green;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      style={{ display: "block" }}
      onMouseLeave={() => setHover(null)}
    >
      {/* Y-axis grid + labels */}
      {[0, 1, 2, 3].map((i) => {
        const y = PAD.top + (i / 3) * chartH;
        const val = maxVal - (i / 3) * maxVal;
        return (
          <g key={`ygrid_${i}`}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
              stroke={dk(dark, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.06)")} />
            <text x={PAD.left - 6} y={y + 3} textAnchor="end" fill={textColor} fontSize={9} fontFamily={OS.mono}>
              {Math.round(val)}
            </text>
          </g>
        );
      })}

      {/* Opened trend line (dashed) */}
      {opened.length >= 3 && (
        <line
          x1={toX(0)} y1={toY(openTrend.intercept)}
          x2={toX(weeks.length - 1)} y2={toY(openTrend.intercept + openTrend.slope * (weeks.length - 1))}
          stroke={openColor} strokeWidth={1} strokeDasharray="4,3" opacity={0.3}
        />
      )}

      {/* Closed trend line (dashed) */}
      {closed.length >= 3 && (
        <line
          x1={toX(0)} y1={toY(closeTrend.intercept)}
          x2={toX(weeks.length - 1)} y2={toY(closeTrend.intercept + closeTrend.slope * (weeks.length - 1))}
          stroke={closeColor} strokeWidth={1} strokeDasharray="4,3" opacity={0.3}
        />
      )}

      {/* Opened line */}
      <path d={openPath} fill="none" stroke={openColor} strokeWidth={1.5} />

      {/* Closed line */}
      <path d={closePath} fill="none" stroke={closeColor} strokeWidth={1.5} />

      {/* Data points — visible on hover only */}
      {hover !== null && weeks[hover] && (
        <>
          <circle cx={toX(hover)} cy={toY(opened[hover])} r={3.5} fill={openColor} />
          <circle cx={toX(hover)} cy={toY(closed[hover])} r={3.5} fill={closeColor} />
        </>
      )}

      {/* Hover zones */}
      {weeks.map((_, i) => (
        <rect key={`hz_${i}`} x={toX(i) - chartW / weeks.length / 2} y={PAD.top}
          width={chartW / weeks.length} height={chartH} fill="transparent"
          onMouseEnter={() => setHover(i)} />
      ))}

      {/* Tooltip */}
      {hover !== null && weeks[hover] && (
        <g>
          <line x1={toX(hover)} y1={PAD.top} x2={toX(hover)} y2={PAD.top + chartH}
            stroke={dk(dark, "rgba(255,255,255,0.15)", "rgba(0,0,0,0.1)")} strokeWidth={1} />
          <rect x={toX(hover) - 52} y={Math.min(toY(opened[hover]), toY(closed[hover])) - 34} width={104} height={30} rx={3}
            fill={dk(dark, "rgba(0,0,0,0.85)", "rgba(0,0,0,0.75)")} stroke={dk(dark, "rgba(255,255,255,0.1)", "rgba(0,0,0,0.2)")} />
          <text x={toX(hover) - 44} y={Math.min(toY(opened[hover]), toY(closed[hover])) - 20} fill={openColor} fontSize={9} fontFamily={OS.mono}>
            +{opened[hover]} opened
          </text>
          <text x={toX(hover) - 44} y={Math.min(toY(opened[hover]), toY(closed[hover])) - 9} fill={closeColor} fontSize={9} fontFamily={OS.mono}>
            -{closed[hover]} closed
          </text>
        </g>
      )}

      {/* X labels */}
      {weeks.map((w, idx) => {
        const step = Math.max(1, Math.floor(weeks.length / 6));
        if (idx % step !== 0 && idx !== weeks.length - 1) return null;
        return (
          <text key={`x${idx}`} x={toX(idx)} y={H - 4} textAnchor="middle" fill={textColor} fontSize={9} fontFamily={OS.mono}>
            {w.label}
          </text>
        );
      })}

      {/* Legend */}
      <circle cx={W - PAD.right - 100} cy={8} r={3} fill={openColor} />
      <text x={W - PAD.right - 94} y={11} fill={textColor} fontSize={9} fontFamily={OS.mono}>Opened</text>
      <circle cx={W - PAD.right - 46} cy={8} r={3} fill={closeColor} />
      <text x={W - PAD.right - 40} y={11} fill={textColor} fontSize={9} fontFamily={OS.mono}>Closed</text>
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

// ─── Weekly Trend Line Chart (unified style — replaces bar charts) ───

export function WeeklyTrendChart({
  data,
  dark,
  height: heightOverride,
  tooltipSuffix = "",
  color = OS.blue,
}: {
  data: { label: string; count: number }[];
  dark: boolean;
  height?: number;
  tooltipSuffix?: string;
  color?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length < 2) return null;

  const W = 640;
  const H = heightOverride ?? 160;
  const PAD = { top: 24, right: 16, bottom: 32, left: 36 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const counts = data.map((d) => d.count);
  const dataMax = Math.max(...counts, 1);
  const maxVal = Math.max(dataMax * 1.25, 1);

  const toX = (i: number) =>
    PAD.left + (data.length > 1 ? (i / (data.length - 1)) * chartW : chartW / 2);
  const toY = (v: number) => PAD.top + chartH - (Math.max(0, v) / maxVal) * chartH;

  const points = data.map((d, i) => ({ x: toX(i), y: toY(d.count) }));
  const pathD = smoothPath(points, 0.3);
  const areaD = smoothArea(points, PAD.top + chartH, 0.3);

  const textColor = dk(dark, "rgba(255,255,255,0.4)", OS.muted);

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
        const val = maxVal - (i / 4) * maxVal;
        return (
          <g key={`ygrid_${i}`}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
              stroke={dk(dark, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.06)")} />
            <text x={PAD.left - 6} y={y + 3} textAnchor="end" fill={textColor} fontSize={9} fontFamily={OS.mono}>
              {Math.round(val)}
            </text>
          </g>
        );
      })}

      {/* Area fill */}
      <path d={areaD} fill={`${color}15`} />

      {/* Smooth line */}
      <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} />

      {/* Data points — visible on hover only */}
      {data.map((d, i) => {
        if (hover !== i) return null;
        return (
          <circle key={i} cx={toX(i)} cy={toY(d.count)} r={4} fill={color} />
        );
      })}

      {/* Hover zones */}
      {data.map((_, i) => (
        <rect key={`hz_${i}`} x={toX(i) - chartW / data.length / 2} y={PAD.top}
          width={chartW / data.length} height={chartH} fill="transparent"
          onMouseEnter={() => setHover(i)} />
      ))}

      {/* Tooltip */}
      {hover !== null && data[hover] && (
        <g>
          <line x1={toX(hover)} y1={PAD.top} x2={toX(hover)} y2={PAD.top + chartH}
            stroke={dk(dark, "rgba(255,255,255,0.15)", "rgba(0,0,0,0.1)")} strokeWidth={1} />
          <rect x={toX(hover) - 36} y={toY(data[hover].count) - 22} width={72} height={18} rx={3}
            fill={dk(dark, "rgba(0,0,0,0.85)", "rgba(0,0,0,0.75)")} stroke={dk(dark, "rgba(255,255,255,0.1)", "rgba(0,0,0,0.2)")} />
          <text x={toX(hover)} y={toY(data[hover].count) - 10} textAnchor="middle"
            fill="#e2e8f0" fontSize={10} fontFamily={OS.mono}>{data[hover].count}{tooltipSuffix}</text>
        </g>
      )}

      {/* X labels */}
      {data.map((d, idx) => {
        const step = Math.max(1, Math.floor(data.length / 6));
        if (idx % step !== 0 && idx !== data.length - 1) return null;
        return (
          <text key={`x${idx}`} x={toX(idx)} y={H - 6} textAnchor="middle" fill={textColor} fontSize={9} fontFamily={OS.mono}>
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}

// ─── Score Gauge ───

const GAUGE_COLORS = {
  utilization: "#3B82F6", // blue
  impact: "#22C55E",      // green
  quality: "#F59E0B",     // amber
};

export function ScoreGauge({
  score,
  tier,
  pillars,
  dark,
}: {
  score: number;
  tier: string;
  pillars: { utilization: number; impact: number; quality: number };
  dark: boolean;
}) {
  const size = 120;
  const cx = size / 2;
  const cy = size / 2;
  const r = 46;
  const strokeW = 10;

  // 270-degree arc: starts at 135deg (bottom-left), sweeps 270deg clockwise
  const startAngle = 135;
  const totalArc = 270;
  const scoreArc = (score / 100) * totalArc;

  // Pillar arcs proportional to their contribution
  const pillarTotal = pillars.utilization + pillars.impact + pillars.quality;
  const uArc = pillarTotal > 0 ? (pillars.utilization / pillarTotal) * scoreArc : 0;
  const iArc = pillarTotal > 0 ? (pillars.impact / pillarTotal) * scoreArc : 0;
  const qArc = pillarTotal > 0 ? (pillars.quality / pillarTotal) * scoreArc : 0;

  function arcPath(startDeg: number, sweepDeg: number): string {
    if (sweepDeg <= 0) return "";
    const s = (startDeg * Math.PI) / 180;
    const e = ((startDeg + sweepDeg) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(s);
    const y1 = cy + r * Math.sin(s);
    const x2 = cx + r * Math.cos(e);
    const y2 = cy + r * Math.sin(e);
    const large = sweepDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  }

  const trackColor = dk(dark, "rgba(255,255,255,0.08)", "rgba(0,0,0,0.06)");
  const textColor = dk(dark, "#fff", OS.text);
  const subColor = dk(dark, "rgba(255,255,255,0.5)", OS.muted);

  let cursor = startAngle;
  const segments = [
    { arc: uArc, color: GAUGE_COLORS.utilization },
    { arc: iArc, color: GAUGE_COLORS.impact },
    { arc: qArc, color: GAUGE_COLORS.quality },
  ];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      {/* Track */}
      <path d={arcPath(startAngle, totalArc)} fill="none" stroke={trackColor} strokeWidth={strokeW} strokeLinecap="round" />

      {/* Pillar segments */}
      {segments.map((seg, idx) => {
        if (seg.arc <= 0) return null;
        const path = arcPath(cursor, seg.arc);
        const el = (
          <path key={idx} d={path} fill="none" stroke={seg.color} strokeWidth={strokeW}
            strokeLinecap={idx === 0 && score > 0 ? "round" : "butt"} />
        );
        cursor += seg.arc;
        return el;
      })}
      {/* Round cap on last segment */}
      {scoreArc > 0 && (
        <path d={arcPath(startAngle + scoreArc - 0.5, 0.5)} fill="none" stroke={segments.filter(s => s.arc > 0).pop()?.color ?? GAUGE_COLORS.utilization}
          strokeWidth={strokeW} strokeLinecap="round" />
      )}

      {/* Score number */}
      <text x={cx} y={cy - 4} textAnchor="middle" dominantBaseline="central"
        fill={textColor} fontSize={28} fontWeight={700} fontFamily={OS.mono}>
        {score}
      </text>

      {/* Tier label */}
      <text x={cx} y={cy + 18} textAnchor="middle" dominantBaseline="central"
        fill={subColor} fontSize={10} fontWeight={600}>
        {tier}
      </text>
    </svg>
  );
}

// ─── LOC Bar Chart ───

export function LOCBarChart({
  data,
  dark,
  height = 160,
}: {
  data: { label: string; additions: number; deletions: number }[];
  dark: boolean;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return null;

  const W = 600;
  const H = height;
  const PAD = { top: 16, bottom: 24, left: 48, right: 12 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const maxVal = Math.max(...data.map((d) => Math.max(d.additions, d.deletions)), 1);
  const barW = Math.max(8, Math.min(28, chartW / data.length * 0.7));
  const gap = (chartW - barW * data.length) / Math.max(data.length - 1, 1);

  const toX = (i: number) => PAD.left + i * (barW + gap);
  const toH = (v: number) => (v / maxVal) * chartH;

  const textColor = dk(dark, "rgba(255,255,255,0.45)", OS.muted);
  const gridColor = dk(dark, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.06)");

  // Y-axis labels
  const yTicks = 4;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => Math.round((maxVal / yTicks) * i));

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {/* Grid lines */}
      {yLabels.map((v, i) => (
        <line key={i} x1={PAD.left} x2={W - PAD.right}
          y1={PAD.top + chartH - toH(v)} y2={PAD.top + chartH - toH(v)}
          stroke={gridColor} strokeWidth={1} />
      ))}

      {/* Y-axis labels */}
      {yLabels.map((v, i) => (
        <text key={`y${i}`} x={PAD.left - 6} y={PAD.top + chartH - toH(v) + 3}
          textAnchor="end" fill={textColor} fontSize={9} fontFamily={OS.mono}>
          {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}
        </text>
      ))}

      {/* Bars */}
      {data.map((d, i) => {
        const x = toX(i);
        const addH = toH(d.additions);
        const delH = toH(d.deletions);
        return (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {/* Additions bar (grows up from baseline) */}
            <rect x={x} y={PAD.top + chartH - addH} width={barW * 0.45}
              height={addH} rx={2} fill="#10B981" opacity={hover === i ? 1 : 0.8} />
            {/* Deletions bar (next to additions) */}
            <rect x={x + barW * 0.5} y={PAD.top + chartH - delH} width={barW * 0.45}
              height={delH} rx={2} fill="#EF4444" opacity={hover === i ? 1 : 0.8} />
          </g>
        );
      })}

      {/* X labels */}
      {data.map((d, i) => {
        const step = Math.max(1, Math.floor(data.length / 8));
        if (i % step !== 0 && i !== data.length - 1) return null;
        return (
          <text key={`x${i}`} x={toX(i) + barW / 2} y={H - 6}
            textAnchor="middle" fill={textColor} fontSize={9} fontFamily={OS.mono}>
            {d.label}
          </text>
        );
      })}

      {/* Hover tooltip */}
      {hover !== null && data[hover] && (
        <g>
          <rect x={toX(hover) - 10} y={PAD.top - 2} width={barW + 20} height={14} rx={3}
            fill={dk(dark, "rgba(0,0,0,0.85)", "rgba(0,0,0,0.75)")} />
          <text x={toX(hover) + barW / 2} y={PAD.top + 9} textAnchor="middle"
            fill="#e2e8f0" fontSize={9} fontFamily={OS.mono}>
            +{data[hover].additions} −{data[hover].deletions}
          </text>
        </g>
      )}

      {/* Legend */}
      <rect x={W - PAD.right - 100} y={4} width={8} height={8} rx={2} fill="#10B981" />
      <text x={W - PAD.right - 88} y={12} fill={textColor} fontSize={9}>Additions</text>
      <rect x={W - PAD.right - 48} y={4} width={8} height={8} rx={2} fill="#EF4444" />
      <text x={W - PAD.right - 36} y={12} fill={textColor} fontSize={9}>Deletions</text>
    </svg>
  );
}

// ─── Productivity Matrix (Bubble Scatter) ───

export function ProductivityMatrixChart({
  points,
  dark,
  height = 280,
}: {
  points: MatrixPoint[];
  dark: boolean;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 3) return null;

  const W = 600;
  const H = height;
  const PAD = { top: 24, bottom: 32, left: 56, right: 20 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const maxX = Math.max(...xs) * 1.15 || 1;
  const maxY = Math.max(...ys) * 1.15 || 1;

  const toX = (v: number) => PAD.left + (v / maxX) * chartW;
  const toY = (v: number) => PAD.top + chartH - (v / maxY) * chartH;

  const medX = [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const medY = [...ys].sort((a, b) => a - b)[Math.floor(ys.length / 2)];

  const textColor = dk(dark, "rgba(255,255,255,0.45)", OS.muted);
  const gridColor = dk(dark, "rgba(255,255,255,0.06)", "rgba(0,0,0,0.06)");
  const dashColor = dk(dark, "rgba(255,255,255,0.15)", "rgba(0,0,0,0.12)");
  const labelColor = dk(dark, "rgba(255,255,255,0.08)", "rgba(0,0,0,0.04)");

  // Bubble color: gray→blue based on AI %
  function bubbleColor(aiPct: number): string {
    const t = Math.min(aiPct / 100, 1);
    const r = Math.round(150 * (1 - t) + 94 * t);
    const g = Math.round(150 * (1 - t) + 106 * t);
    const b = Math.round(150 * (1 - t) + 210 * t);
    return `rgb(${r},${g},${b})`;
  }

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {/* Grid */}
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={`gy${f}`} x1={PAD.left} x2={W - PAD.right}
          y1={toY(maxY * f)} y2={toY(maxY * f)} stroke={gridColor} />
      ))}
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={`gx${f}`} y1={PAD.top} y2={PAD.top + chartH}
          x1={toX(maxX * f)} x2={toX(maxX * f)} stroke={gridColor} />
      ))}

      {/* Median dividers */}
      <line x1={toX(medX)} x2={toX(medX)} y1={PAD.top} y2={PAD.top + chartH}
        stroke={dashColor} strokeWidth={1} strokeDasharray="4,3" />
      <line x1={PAD.left} x2={W - PAD.right} y1={toY(medY)} y2={toY(medY)}
        stroke={dashColor} strokeWidth={1} strokeDasharray="4,3" />

      {/* Quadrant labels */}
      <text x={toX(medX / 2)} y={toY(medY + (maxY - medY) / 2)} textAnchor="middle"
        fill={labelColor} fontSize={11} fontWeight={600}>Deep Work</text>
      <text x={toX(medX + (maxX - medX) / 2)} y={toY(medY + (maxY - medY) / 2)} textAnchor="middle"
        fill={labelColor} fontSize={11} fontWeight={600}>High Output</text>
      <text x={toX(medX / 2)} y={toY(medY / 2)} textAnchor="middle"
        fill={labelColor} fontSize={11} fontWeight={600}>Ramping Up</text>
      <text x={toX(medX + (maxX - medX) / 2)} y={toY(medY / 2)} textAnchor="middle"
        fill={labelColor} fontSize={11} fontWeight={600}>High Volume</text>

      {/* Bubbles */}
      {points.map((p, i) => (
        <circle key={i} cx={toX(p.x)} cy={toY(p.y)} r={p.size}
          fill={bubbleColor(p.aiPct)} opacity={hover === i ? 1 : 0.7}
          stroke={hover === i ? dk(dark, "#fff", OS.text) : "none"} strokeWidth={1.5}
          style={{ cursor: "pointer", transition: "opacity 0.15s" }}
          onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
      ))}

      {/* Hover tooltip */}
      {hover !== null && points[hover] && (() => {
        const p = points[hover];
        const tx = toX(p.x);
        const ty = toY(p.y) - p.size - 8;
        const lines = [
          p.author,
          `${p.x.toFixed(1)} PRs/wk`,
          `${fmtHours(1 / p.y * 24)} cycle`,
          `${p.aiPct}% AI`,
        ];
        const boxW = 120;
        const boxH = lines.length * 14 + 8;
        return (
          <g>
            <rect x={tx - boxW / 2} y={ty - boxH} width={boxW} height={boxH} rx={4}
              fill={dk(dark, "rgba(0,0,0,0.9)", "rgba(0,0,0,0.8)")}
              stroke={dk(dark, "rgba(255,255,255,0.1)", "rgba(0,0,0,0.2)")} />
            {lines.map((l, li) => (
              <text key={li} x={tx} y={ty - boxH + 14 + li * 14} textAnchor="middle"
                fill="#e2e8f0" fontSize={10} fontFamily={OS.mono}
                fontWeight={li === 0 ? 600 : 400}>{l}</text>
            ))}
          </g>
        );
      })()}

      {/* Axis labels */}
      <text x={PAD.left + chartW / 2} y={H - 6} textAnchor="middle"
        fill={textColor} fontSize={10}>Throughput (PRs/week)</text>
      <text x={12} y={PAD.top + chartH / 2} textAnchor="middle"
        fill={textColor} fontSize={10}
        transform={`rotate(-90, 12, ${PAD.top + chartH / 2})`}>Efficiency (faster cycles)</text>

      {/* X tick labels */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <text key={`xt${f}`} x={toX(maxX * f)} y={H - 18} textAnchor="middle"
          fill={textColor} fontSize={9} fontFamily={OS.mono}>{(maxX * f).toFixed(1)}</text>
      ))}

      {/* AI color legend */}
      <defs>
        <linearGradient id="aiGrad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="rgb(150,150,150)" />
          <stop offset="100%" stopColor={OS.blue} />
        </linearGradient>
      </defs>
      <rect x={W - PAD.right - 90} y={4} width={50} height={6} rx={3} fill="url(#aiGrad)" />
      <text x={W - PAD.right - 94} y={11} textAnchor="end" fill={textColor} fontSize={8}>0% AI</text>
      <text x={W - PAD.right - 36} y={11} fill={textColor} fontSize={8}>100%</text>
    </svg>
  );
}

/**
 * Eng Stats Dashboard — KPI cards, cycle time chart, PR size distribution,
 * AI usage section, and optional Copilot section.
 * Sub-tab navigation: Summary / Cycle Time / AI Adoption / Teams.
 * Customizable layout persisted to chrome.storage.local.
 * All charts are pure SVG — no chart library dependency.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@shared/db";
import { OS } from "@shared/tokens";
import type { PRMetric, JiraTicket, PRJiraLink, AIReviewComment, OpenPRSnapshot } from "@shared/types";
import { isBotAuthor } from "@shared/constants";

// ─── Sub-tab types ───
type EngStatsTab = "Summary" | "Cycle Time" | "AI Adoption" | "AI Reviews" | "Teams";
const ENG_STATS_TABS: EngStatsTab[] = ["Summary", "Cycle Time", "AI Adoption", "AI Reviews", "Teams"];

// ─── Customization config (persisted to chrome.storage.local) ───
type SectionId = "kpis" | "cycleTime" | "aiAdoption" | "prSize" | "toolUsage" | "projection";
type KpiId = "cycletime" | "medreview" | "prsmerged" | "aiassisted" | "leadtime";
type TeamColumnId = "prs" | "cycle" | "medReview" | "avgLines" | "ai" | "trend";

interface KpiDisplayConfig {
  delta: boolean;
  sparkline: boolean;
  subtitle: boolean;
}

interface EngStatsConfig {
  visibleSections: SectionId[];
  kpiOrder: KpiId[];
  kpiDisplay: Record<KpiId, KpiDisplayConfig>;
  teamColumns: TeamColumnId[];
}

const DEFAULT_CONFIG: EngStatsConfig = {
  visibleSections: ["kpis", "cycleTime", "aiAdoption", "prSize", "toolUsage", "projection"],
  kpiOrder: ["cycletime", "medreview", "prsmerged", "aiassisted", "leadtime"],
  kpiDisplay: {
    cycletime: { delta: true, sparkline: true, subtitle: true },
    medreview: { delta: true, sparkline: true, subtitle: true },
    prsmerged: { delta: true, sparkline: true, subtitle: true },
    aiassisted: { delta: true, sparkline: true, subtitle: true },
    leadtime: { delta: true, sparkline: true, subtitle: true },
  },
  teamColumns: ["prs", "cycle", "medReview", "avgLines", "ai", "trend"],
};

function useEngStatsConfig() {
  const [config, setConfig] = useState<EngStatsConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    chrome.storage.local.get("engStatsConfig").then((r) => {
      if (r.engStatsConfig) {
        setConfig({ ...DEFAULT_CONFIG, ...(r.engStatsConfig as Partial<EngStatsConfig>) });
      }
    });
  }, []);

  const update = useCallback((patch: Partial<EngStatsConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      chrome.storage.local.set({ engStatsConfig: next });
      return next;
    });
  }, []);

  return { config, updateConfig: update };
}

// ─── Dark mode context (mirrors App.tsx pattern) ───
const dk = (dark: boolean, d: string, l: string) => (dark ? d : l);

// ─── Helpers ───

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Count weekend days (Sat+Sun) between two ISO timestamps */
function weekendDaysBetween(startISO: string, endISO: string): number {
  const start = new Date(startISO);
  const end = new Date(endISO);
  let count = 0;
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  while (d < end) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/** Convert raw hours to business hours by subtracting weekend days */
function toBusinessHours(rawHours: number, startISO: string, endISO: string): number {
  const weekendHours = weekendDaysBetween(startISO, endISO) * 24;
  return Math.max(0, rawHours - weekendHours);
}

/** Remove outliers using IQR method (1.5× fence) */
function removeOutliers(values: number[]): number[] {
  if (values.length < 4) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  return values.filter((v) => v >= lower && v <= upper);
}

function fmtHours(h: number | null): string {
  if (h === null || isNaN(h)) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

/** Always format as days — no unit mixing */
function fmtDays(h: number | null): string {
  if (h === null || isNaN(h)) return "—";
  return `${(h / 24).toFixed(1)}d`;
}

function weekLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/** Returns ISO date key for the Monday of the week containing `d`. */
function weekKey(d: Date): string {
  const day = d.getDay();
  const diff = (day + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - diff);
  return monday.toISOString().slice(0, 10);
}

// ─── Trend prediction (linear regression) ───

/** Simple linear regression: returns slope + intercept */
function linearRegression(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += values[i]; sumXY += i * values[i]; sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

/** Generate prediction points extending 25% beyond the data range */
function predictPoints(values: number[], count: number): number[] {
  const { slope, intercept } = linearRegression(values);
  const n = values.length;
  return Array.from({ length: count }, (_, i) => {
    const predicted = intercept + slope * (n + i);
    return Math.max(0, predicted); // clamp to 0
  });
}

// ─── Sub-components ───

function Sparkline({
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

interface KPICardProps {
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

function KPICard({
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

interface WeekBucket {
  label: string;
  avgHours: number;
  count: number;
}

function CycleTimeChart({
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

// ─── Projection Chart (14-day backlog trajectory) ───

function ProjectionChart({
  points,
  currentOpen,
  projected7d,
  projected14d,
  dark,
  height = 160,
}: {
  points: { day: number; count: number }[];
  currentOpen: number;
  projected7d: number;
  projected14d: number;
  dark: boolean;
  height?: number;
}) {
  if (points.length < 2) return null;

  const W = 480;
  const H = height;
  const pad = { top: 20, right: 45, bottom: 28, left: 40 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  const counts = points.map((p) => p.count);
  const minY = Math.min(...counts) - 5;
  const maxY = Math.max(...counts) + 5;
  const rangeY = maxY - minY || 1;

  const x = (day: number) => pad.left + (day / 14) * chartW;
  const y = (count: number) => pad.top + chartH - ((count - minY) / rangeY) * chartH;

  // Build line path
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)},${y(p.count).toFixed(1)}`).join(" ");

  // Area fill path
  const areaPath = `${linePath} L${x(14).toFixed(1)},${(pad.top + chartH).toFixed(1)} L${x(0).toFixed(1)},${(pad.top + chartH).toFixed(1)} Z`;

  const amber = dark ? "#FB923C" : "#EA580C";
  const amberFaint = dark ? "rgba(251,146,60,0.15)" : "rgba(234,88,12,0.08)";
  const gridColor = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const labelColor = dark ? "rgba(255,255,255,0.4)" : OS.muted;

  // Y-axis ticks (5 ticks)
  const yTicks = Array.from({ length: 5 }, (_, i) => Math.round(minY + (rangeY * i) / 4));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {/* Grid lines */}
      {yTicks.map((tick) => (
        <g key={tick}>
          <line x1={pad.left} x2={W - pad.right} y1={y(tick)} y2={y(tick)} stroke={gridColor} strokeWidth={1} />
          <text x={pad.left - 6} y={y(tick) + 3} textAnchor="end" fill={labelColor} fontSize={9} fontFamily={OS.mono}>{tick}</text>
        </g>
      ))}

      {/* Area fill */}
      <path d={areaPath} fill={amberFaint} />

      {/* Main projection line */}
      <path d={linePath} fill="none" stroke={amber} strokeWidth={2} />

      {/* Current baseline (dashed) */}
      <line x1={pad.left} x2={W - pad.right} y1={y(currentOpen)} y2={y(currentOpen)} stroke={labelColor} strokeWidth={1} strokeDasharray="4 3" />

      {/* Day 7 annotation */}
      <line x1={x(7)} x2={x(7)} y1={pad.top} y2={pad.top + chartH} stroke={gridColor} strokeWidth={1} strokeDasharray="3 3" />
      <circle cx={x(7)} cy={y(projected7d)} r={4} fill={amber} />
      <text x={x(7)} y={pad.top - 6} textAnchor="middle" fill={labelColor} fontSize={9} fontFamily={OS.mono}>1 wk: {projected7d}</text>

      {/* Day 14 annotation */}
      <line x1={x(14)} x2={x(14)} y1={pad.top} y2={pad.top + chartH} stroke={gridColor} strokeWidth={1} strokeDasharray="3 3" />
      <circle cx={x(14)} cy={y(projected14d)} r={4} fill={amber} />
      <text x={x(14)} y={pad.top - 6} textAnchor="middle" fill={amber} fontSize={10} fontWeight={700} fontFamily={OS.mono}>{projected14d}</text>

      {/* X-axis labels */}
      <text x={x(0)} y={H - 6} textAnchor="middle" fill={labelColor} fontSize={9} fontFamily={OS.mono}>Today</text>
      <text x={x(7)} y={H - 6} textAnchor="middle" fill={labelColor} fontSize={9} fontFamily={OS.mono}>1 wk</text>
      <text x={x(14)} y={H - 6} textAnchor="middle" fill={labelColor} fontSize={9} fontFamily={OS.mono}>2 wk</text>
    </svg>
  );
}

// ─── PR Size Donut Chart ───

function PRSizeChart({
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

function smoothPath(pts: { x: number; y: number }[], tension = 0.3): string {
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

function smoothArea(pts: { x: number; y: number }[], baseY: number, tension = 0.3): string {
  const line = smoothPath(pts, tension);
  if (!line || pts.length < 2) return "";
  return `${line} L ${pts[pts.length - 1].x} ${baseY} L ${pts[0].x} ${baseY} Z`;
}

// ─── AI Adoption Line Chart with target (pure SVG) ───

function AIAdoptionChart({
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

// ─── Main EngStatsView ───

interface EngStatsViewProps {
  darkMode?: boolean;
}

export function EngStatsView({ darkMode = false }: EngStatsViewProps) {
  const [selectedRepo, setSelectedRepo] = useState<string>("__all__");
  const [timeRange, setTimeRange] = useState<30 | 60 | 90 | 180 | 360>(30);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [repos, setRepos] = useState<string[]>([]);
  const [githubOrg, setGithubOrg] = useState<string>("");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string>("__all__");
  const [selectedType, setSelectedType] = useState<string>("__all__");
  const [jiraSyncing, setJiraSyncing] = useState(false);
  const [jiraSyncProgress, setJiraSyncProgress] = useState<{
    phase: string;
    current: number;
    total: number;
  } | null>(null);

  // Load config from chrome.storage
  useEffect(() => {
    chrome.storage.local
      .get(["githubRepos", "githubOrg", "githubLastSynced"])
      .then((r) => {
        setRepos((r.githubRepos as string[]) ?? []);
        setGithubOrg((r.githubOrg as string) ?? "");
        setLastSynced((r.githubLastSynced as string) ?? null);
      });
  }, []);

  const since = daysAgoISO(timeRange);
  // Bump this after sync to force useLiveQuery to re-evaluate
  const [queryKey, setQueryKey] = useState(0);

  // Live query from IndexedDB
  const allMetrics = useLiveQuery(
    () =>
      db.pr_metrics
        .where("mergedAt")
        .aboveOrEqual(since)
        .toArray()
        .catch(() => []),
    [since, queryKey],
    [] as PRMetric[],
  );

  // Total count in DB (helps debug whether data is persisted)
  const totalInDB = useLiveQuery(
    () => db.pr_metrics.count().catch(() => 0),
    [queryKey],
    0,
  );

  const copilotMetrics = useLiveQuery(
    () =>
      db.copilot_metrics
        .where("date")
        .aboveOrEqual(since.slice(0, 10))
        .toArray()
        .catch(() => []),
    [since],
    [],
  );

  // Jira tickets
  const jiraTickets = useLiveQuery(
    () => db.jira_tickets.toArray().catch(() => []),
    [queryKey],
    [] as JiraTicket[],
  );

  // PR-Jira links
  const prJiraLinks = useLiveQuery(
    () => db.pr_jira_links.toArray().catch(() => []),
    [queryKey],
    [] as PRJiraLink[],
  );

  // Open PR snapshots (for backlog projection)
  const openSnapshots = useLiveQuery(
    () =>
      db.open_pr_snapshots
        .where("snapshotAt")
        .aboveOrEqual(daysAgoISO(90))
        .toArray()
        .catch(() => []),
    [queryKey],
    [] as OpenPRSnapshot[],
  );

  // Open PR created dates from chrome.storage (set during sync)
  const [openPRCreatedDates, setOpenPRCreatedDates] = useState<Record<string, string[]>>({});
  useEffect(() => {
    chrome.storage.local.get("openPRCreatedDates").then((r) => {
      if (r.openPRCreatedDates) setOpenPRCreatedDates(r.openPRCreatedDates as Record<string, string[]>);
    });
  }, [queryKey]);

  // ─── Jira link maps ───
  const prToTickets = useMemo(() => {
    const map = new Map<number, JiraTicket[]>();
    const ticketByKey = new Map(jiraTickets.map((t) => [t.key, t]));
    for (const link of prJiraLinks) {
      const ticket = ticketByKey.get(link.jiraTicketKey);
      if (!ticket) continue;
      const existing = map.get(link.prMetricId) ?? [];
      existing.push(ticket);
      map.set(link.prMetricId, existing);
    }
    return map;
  }, [jiraTickets, prJiraLinks]);

  // Available teams (distinct components)
  const teams = useMemo(() => {
    const set = new Set<string>();
    for (const t of jiraTickets) {
      if (t.component) set.add(t.component);
    }
    return Array.from(set).sort();
  }, [jiraTickets]);

  // Available issue types
  const issueTypes = useMemo(() => {
    const set = new Set<string>();
    for (const t of jiraTickets) {
      set.add(t.issueType);
    }
    return Array.from(set).sort();
  }, [jiraTickets]);

  // Filter by selected repo, team, and type
  const metrics = useMemo(() => {
    let filtered =
      selectedRepo === "__all__"
        ? allMetrics
        : allMetrics.filter((m) => m.repo === selectedRepo);

    // Filter by team (via linked Jira tickets)
    if (selectedTeam !== "__all__") {
      filtered = filtered.filter((m) => {
        const tickets = prToTickets.get(m.id!);
        return tickets?.some((t) => t.component === selectedTeam);
      });
    }

    // Filter by issue type
    if (selectedType !== "__all__") {
      filtered = filtered.filter((m) => {
        const tickets = prToTickets.get(m.id!);
        return tickets?.some((t) => t.issueType === selectedType);
      });
    }

    return filtered;
  }, [allMetrics, selectedRepo, selectedTeam, selectedType, prToTickets]);

  // Collect unique repos from DB + config
  const allRepos = useMemo(() => {
    const fromDB = Array.from(new Set(allMetrics.map((m) => m.repo)));
    const combined = Array.from(new Set([...repos, ...fromDB]));
    return combined;
  }, [allMetrics, repos]);

  // ─── Computed KPIs ───

  const cycleTimes = removeOutliers(
    metrics
      .filter((m) => m.cycleTimeHours !== null && m.mergedAt)
      .map((m) => toBusinessHours(m.cycleTimeHours!, m.createdAt, m.mergedAt!)),
  );

  const avgCycleTime = cycleTimes.length
    ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length
    : null;

  const reviewTimes = removeOutliers(
    metrics
      .filter((m) => m.timeToFirstReviewHours !== null)
      .map((m) => {
        const reviewEnd = new Date(new Date(m.createdAt).getTime() + m.timeToFirstReviewHours! * 3600000).toISOString();
        return toBusinessHours(m.timeToFirstReviewHours!, m.createdAt, reviewEnd);
      }),
  );

  const medianReviewTime = reviewTimes.length ? median(reviewTimes) : null;

  const prsMerged = metrics.length;

  // ─── Cycle time trend (current half vs prior half) ───
  const halfPoint = daysAgoISO(timeRange / 2);
  const recent = metrics.filter((m) => m.mergedAt && m.mergedAt >= halfPoint);
  const older = metrics.filter((m) => m.mergedAt && m.mergedAt < halfPoint);

  const toBizCycle = (m: PRMetric) =>
    m.cycleTimeHours !== null && m.mergedAt
      ? toBusinessHours(m.cycleTimeHours, m.createdAt, m.mergedAt)
      : null;

  const recentCycles = removeOutliers(
    recent.map(toBizCycle).filter((h): h is number => h !== null),
  );
  const recentAvg = recentCycles.length
    ? recentCycles.reduce((a, b) => a + b, 0) / recentCycles.length
    : null;

  const olderCycles = removeOutliers(
    older.map(toBizCycle).filter((h): h is number => h !== null),
  );
  const olderAvg = olderCycles.length
    ? olderCycles.reduce((a, b) => a + b, 0) / olderCycles.length
    : null;

  // ─── Weekly buckets for cycle time chart ───
  const weeklyBuckets: WeekBucket[] = useMemo(() => {
    const buckets: Map<string, number[]> = new Map();
    for (const m of metrics) {
      if (!m.mergedAt || m.cycleTimeHours === null) continue;
      const biz = toBusinessHours(m.cycleTimeHours, m.createdAt, m.mergedAt);
      const key = weekKey(new Date(m.mergedAt));
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(biz);
    }

    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, vals]) => ({
        label: weekLabel(new Date(key + "T12:00:00")),
        avgHours: vals.reduce((a, b) => a + b, 0) / vals.length,
        count: vals.length,
      }))
      .slice(-Math.ceil(timeRange / 7));
  }, [metrics, timeRange]);

  // ─── PR size distribution ───
  const smallCount = metrics.filter(
    (m) => m.additions + m.deletions < 100,
  ).length;
  const mediumCount = metrics.filter(
    (m) =>
      m.additions + m.deletions >= 100 && m.additions + m.deletions < 500,
  ).length;
  const largeCount = metrics.filter(
    (m) => m.additions + m.deletions >= 500,
  ).length;

  // ─── AI adoption ───
  // Filter out bot-authored PRs for all human-focused metrics
  const humanMetrics = useMemo(
    () => metrics.filter((m) => !m.author || !isBotAuthor(m.author)),
    [metrics],
  );

  const aiPRs = humanMetrics.filter((m) => m.aiAssisted).length;
  const aiPct = humanMetrics.length
    ? Math.round((aiPRs / humanMetrics.length) * 100)
    : 0;

  // AI vs non-AI cycle time comparison
  const aiCycleComparison = useMemo(() => {
    const aiCycles: number[] = [];
    const nonAiCycles: number[] = [];
    for (const m of humanMetrics) {
      if (m.cycleTimeHours == null || !m.mergedAt) continue;
      const biz = toBusinessHours(m.cycleTimeHours, m.createdAt, m.mergedAt);
      if (m.aiAssisted) aiCycles.push(biz);
      else nonAiCycles.push(biz);
    }
    const cleanAi = removeOutliers(aiCycles);
    const cleanNon = removeOutliers(nonAiCycles);
    if (!cleanAi.length || !cleanNon.length) return null;
    const avgAi = cleanAi.reduce((a, b) => a + b, 0) / cleanAi.length;
    const avgNon = cleanNon.reduce((a, b) => a + b, 0) / cleanNon.length;
    const pctDiff = avgNon > 0 ? Math.round(((avgNon - avgAi) / avgNon) * 100) : 0;
    return { avgAi, avgNon, pctDiff };
  }, [humanMetrics]);

  // Tool breakdown (scoped to selected time range)
  const toolCounts: Record<string, number> = {};
  for (const m of metrics) {
    for (const tool of m.aiTools) {
      toolCounts[tool] = (toolCounts[tool] ?? 0) + 1;
    }
  }
  const toolEntries = Object.entries(toolCounts).sort(
    (a, b) => b[1] - a[1],
  );

  // ─── AI review tool breakdown ───
  const aiReviewStats = useMemo(() => {
    const reviewToolCounts: Record<string, number> = {};
    let reviewedByAI = 0;
    for (const m of metrics) {
      const reviewers = (m as PRMetric & { aiReviewers?: string[] }).aiReviewers ?? [];
      if (reviewers.length > 0) {
        reviewedByAI++;
        for (const tool of reviewers) {
          reviewToolCounts[tool] = (reviewToolCounts[tool] ?? 0) + 1;
        }
      }
    }
    const pct = metrics.length ? Math.round((reviewedByAI / metrics.length) * 100) : 0;
    const toolEntries = Object.entries(reviewToolCounts).sort((a, b) => b[1] - a[1]);
    return { reviewedByAI, pct, toolEntries };
  }, [metrics]);

  // ─── AI Review Comments data ───
  const allReviewComments = useLiveQuery(
    () => db.ai_review_comments.where("createdAt").aboveOrEqual(since).toArray(),
    [since, queryKey],
    [] as AIReviewComment[],
  );

  const filteredReviewComments = useMemo(() => {
    let result = allReviewComments;
    if (selectedRepo !== "__all__") result = result.filter((c) => c.repo === selectedRepo);
    if (selectedTeam !== "__all__") {
      // Filter by team via prToTickets lookup
      const prKeysInTeam = new Set<string>();
      for (const m of metrics) {
        const tickets = prToTickets.get(m.id!);
        if (tickets?.length) {
          const team = tickets[0].component ?? "No Component";
          if (team === selectedTeam) prKeysInTeam.add(`${m.repo}:${m.prNumber}`);
        }
      }
      result = result.filter((c) => prKeysInTeam.has(`${c.repo}:${c.prNumber}`));
    }
    return result;
  }, [allReviewComments, selectedRepo, selectedTeam, metrics, prToTickets]);

  const reviewTabStats = useMemo(() => {
    const comments = filteredReviewComments;
    const byTool: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byRepo: Record<string, number> = {};
    const byAuthor: Record<string, { total: number; byCategory: Record<string, number>; byTool: Record<string, number> }> = {};
    const byTeamMap: Record<string, number> = {};
    const weeklyBuckets: Map<string, number> = new Map();
    const reviewedPRs = new Set<string>();

    for (const c of comments) {
      byTool[c.tool] = (byTool[c.tool] ?? 0) + 1;
      byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
      bySeverity[c.severity] = (bySeverity[c.severity] ?? 0) + 1;
      byRepo[c.repo] = (byRepo[c.repo] ?? 0) + 1;
      reviewedPRs.add(`${c.repo}:${c.prNumber}`);

      // By author
      const author = c.prAuthor ?? "unknown";
      if (!byAuthor[author]) byAuthor[author] = { total: 0, byCategory: {}, byTool: {} };
      byAuthor[author].total++;
      byAuthor[author].byCategory[c.category] = (byAuthor[author].byCategory[c.category] ?? 0) + 1;
      byAuthor[author].byTool[c.tool] = (byAuthor[author].byTool[c.tool] ?? 0) + 1;

      // By team (via PR → Jira link)
      const matchingMetric = metrics.find((m) => m.repo === c.repo && m.prNumber === c.prNumber);
      if (matchingMetric) {
        const tickets = prToTickets.get(matchingMetric.id!);
        const team = tickets?.[0]?.component ?? "Unlinked";
        byTeamMap[team] = (byTeamMap[team] ?? 0) + 1;
      }

      // Weekly trend
      const wk = weekKey(new Date(c.createdAt));
      weeklyBuckets.set(wk, (weeklyBuckets.get(wk) ?? 0) + 1);
    }

    const weeklyTrend = Array.from(weeklyBuckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, count]) => ({ label, count }));

    const authorRows = Object.entries(byAuthor)
      .map(([author, data]) => {
        const topCat = Object.entries(data.byCategory).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
        return { author, ...data, topCategory: topCat };
      })
      .sort((a, b) => b.total - a.total);

    return {
      totalComments: comments.length,
      reviewedPRCount: reviewedPRs.size,
      byTool: Object.entries(byTool).sort((a, b) => b[1] - a[1]),
      byCategory: Object.entries(byCategory).sort((a, b) => b[1] - a[1]),
      bySeverity: Object.entries(bySeverity).sort((a, b) => b[1] - a[1]),
      byRepo: Object.entries(byRepo).sort((a, b) => b[1] - a[1]),
      byTeam: Object.entries(byTeamMap).filter(([t]) => t !== "Unlinked").sort((a, b) => b[1] - a[1]),
      unlinkedCount: byTeamMap["Unlinked"] ?? 0,
      weeklyTrend,
      authorRows,
    };
  }, [filteredReviewComments, metrics, prToTickets]);

  // Weekly AI pct trend
  const weeklyAI = useMemo(() => {
    const buckets: Map<string, { ai: number; total: number }> = new Map();
    for (const m of metrics) {
      if (!m.mergedAt) continue;
      const key = weekKey(new Date(m.mergedAt));
      if (!buckets.has(key)) buckets.set(key, { ai: 0, total: 0 });
      const b = buckets.get(key)!;
      b.total++;
      if (m.aiAssisted) b.ai++;
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, v]) => ({
        label: weekLabel(new Date(key + "T12:00:00")),
        pct: v.total > 0 ? Math.round((v.ai / v.total) * 100) : 0,
      }))
      .slice(-Math.ceil(timeRange / 7));
  }, [metrics, timeRange]);

  // ─── Lead Time: Jira created → PR merged (for linked tickets) ───
  const leadTimes = useMemo(() => {
    const times: number[] = [];
    for (const m of metrics) {
      if (!m.mergedAt || m.id == null) continue;
      const tickets = prToTickets.get(m.id);
      if (!tickets?.length) continue;
      // Use earliest ticket creation date
      const earliest = tickets
        .map((t) => new Date(t.createdAt).getTime())
        .filter((t) => !isNaN(t));
      if (!earliest.length) continue;
      const ticketCreated = Math.min(...earliest);
      const merged = new Date(m.mergedAt).getTime();
      if (merged > ticketCreated) {
        times.push((merged - ticketCreated) / (1000 * 60 * 60));
      }
    }
    return times;
  }, [metrics, prToTickets]);

  const avgLeadTime = leadTimes.length
    ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length
    : null;

  // ─── Copilot summary ───
  const latestCopilot =
    copilotMetrics.length > 0
      ? copilotMetrics.sort((a, b) => b.date.localeCompare(a.date))[0]
      : null;

  // ─── Sparkline data (7 weekly data points) ───

  const weeklyCycleDays = useMemo(
    () => weeklyBuckets.map((b) => b.avgHours / 24).slice(-7),
    [weeklyBuckets],
  );

  const weeklyReviewMedians = useMemo(() => {
    const byWeek = new Map<string, number[]>();
    for (const m of metrics) {
      if (m.timeToFirstReviewHours == null || !m.mergedAt) continue;
      const reviewEnd = new Date(new Date(m.createdAt).getTime() + m.timeToFirstReviewHours * 3600000).toISOString();
      const biz = toBusinessHours(m.timeToFirstReviewHours, m.createdAt, reviewEnd);
      const key = weekKey(new Date(m.mergedAt));
      if (!byWeek.has(key)) byWeek.set(key, []);
      byWeek.get(key)!.push(biz);
    }
    return Array.from(byWeek.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, vals]) => median(removeOutliers(vals)))
      .slice(-7);
  }, [metrics]);

  const weeklyPRCounts = useMemo(() => {
    const byWeek = new Map<string, number>();
    for (const m of metrics) {
      if (!m.mergedAt) continue;
      const key = weekKey(new Date(m.mergedAt));
      byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
    }
    return Array.from(byWeek.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, count]) => count)
      .slice(-7);
  }, [metrics]);

  const weeklyAIPcts = useMemo(
    () => weeklyAI.map((w) => w.pct).slice(-7),
    [weeklyAI],
  );

  const weeklyLeadDays = useMemo(() => {
    const byWeek = new Map<string, number[]>();
    for (const m of metrics) {
      if (!m.mergedAt || m.id == null) continue;
      const tickets = prToTickets.get(m.id);
      if (!tickets?.length) continue;
      const earliest = tickets
        .map((t) => new Date(t.createdAt).getTime())
        .filter((t) => !isNaN(t));
      if (!earliest.length) continue;
      const ticketCreated = Math.min(...earliest);
      const merged = new Date(m.mergedAt).getTime();
      if (merged <= ticketCreated) continue;
      const leadHours = (merged - ticketCreated) / (1000 * 60 * 60);
      const key = weekKey(new Date(m.mergedAt));
      if (!byWeek.has(key)) byWeek.set(key, []);
      byWeek.get(key)!.push(leadHours / 24);
    }
    return Array.from(byWeek.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, vals]) => vals.reduce((a, b) => a + b, 0) / vals.length)
      .slice(-7);
  }, [metrics, prToTickets]);

  // ─── Delta percentages (recent half vs older half) ───

  const cycleDelta = useMemo(
    () =>
      recentAvg != null && olderAvg != null && olderAvg !== 0
        ? Math.round(((recentAvg - olderAvg) / olderAvg) * 100)
        : null,
    [recentAvg, olderAvg],
  );

  const reviewDelta = useMemo(() => {
    const toBizReview = (m: PRMetric) => {
      if (m.timeToFirstReviewHours == null) return null;
      const reviewEnd = new Date(new Date(m.createdAt).getTime() + m.timeToFirstReviewHours * 3600000).toISOString();
      return toBusinessHours(m.timeToFirstReviewHours, m.createdAt, reviewEnd);
    };
    const recentReviews = removeOutliers(
      recent.map(toBizReview).filter((h): h is number => h !== null),
    );
    const olderReviews = removeOutliers(
      older.map(toBizReview).filter((h): h is number => h !== null),
    );
    if (!recentReviews.length || !olderReviews.length) return null;
    const recentMed = median(recentReviews);
    const olderMed = median(olderReviews);
    if (olderMed === 0) return null;
    return Math.round(((recentMed - olderMed) / olderMed) * 100);
  }, [recent, older]);

  const prsDelta = useMemo(() => {
    if (older.length === 0) return null;
    return Math.round(
      ((recent.length - older.length) / older.length) * 100,
    );
  }, [recent, older]);

  const aiDelta = useMemo(() => {
    const recentAI = recent.filter((m) => m.aiAssisted).length;
    const recentAIPct =
      recent.length > 0 ? (recentAI / recent.length) * 100 : 0;
    const olderAI = older.filter((m) => m.aiAssisted).length;
    const olderAIPct =
      older.length > 0 ? (olderAI / older.length) * 100 : 0;
    if (olderAIPct === 0) return null;
    return Math.round(((recentAIPct - olderAIPct) / olderAIPct) * 100);
  }, [recent, older]);

  const leadDelta = useMemo(() => {
    const recentLeads: number[] = [];
    const olderLeads: number[] = [];
    for (const m of metrics) {
      if (!m.mergedAt || m.id == null) continue;
      const tickets = prToTickets.get(m.id);
      if (!tickets?.length) continue;
      const earliest = tickets
        .map((t) => new Date(t.createdAt).getTime())
        .filter((t) => !isNaN(t));
      if (!earliest.length) continue;
      const ticketCreated = Math.min(...earliest);
      const merged = new Date(m.mergedAt).getTime();
      if (merged <= ticketCreated) continue;
      const hours = (merged - ticketCreated) / (1000 * 60 * 60);
      if (m.mergedAt >= halfPoint) recentLeads.push(hours);
      else olderLeads.push(hours);
    }
    if (!recentLeads.length || !olderLeads.length) return null;
    const recentAvgLead =
      recentLeads.reduce((a, b) => a + b, 0) / recentLeads.length;
    const olderAvgLead =
      olderLeads.reduce((a, b) => a + b, 0) / olderLeads.length;
    if (olderAvgLead === 0) return null;
    return Math.round(
      ((recentAvgLead - olderAvgLead) / olderAvgLead) * 100,
    );
  }, [metrics, prToTickets, halfPoint]);

  // ─── Lead time alert flag ───
  const leadTimeIsHigh = avgLeadTime != null && avgLeadTime > 120;

  // ─── AI section header data ───
  const firstWeekAIPct = useMemo(() => {
    if (!weeklyAI.length) return undefined;
    const idx = Math.max(0, weeklyAI.length - 6);
    return weeklyAI[idx]?.pct;
  }, [weeklyAI]);

  const aiTrendWord = useMemo(() => {
    if (firstWeekAIPct == null) return "flat";
    const diff = aiPct - firstWeekAIPct;
    if (diff > 2) return "up";
    if (diff < -2) return "down";
    return "flat";
  }, [aiPct, firstWeekAIPct]);

  const aiSubtitle = useMemo(() => {
    const base = `${aiPct}% of PRs AI-assisted`;
    if (firstWeekAIPct == null || weeklyAI.length < 2) return base;
    const weeksBack = Math.min(weeklyAI.length, 6) - 1;
    return `${base} · trending ${aiTrendWord} from ${firstWeekAIPct}% ${weeksBack} weeks ago`;
  }, [aiPct, firstWeekAIPct, aiTrendWord, weeklyAI.length]);

  // ─── Tool display entries ───
  const toolColors: Record<string, string> = {
    claude: "#D97706",
    copilot: "#2EA043",
    cursor: "#7C3AED",
    coderabbit: "#0891B2",
    aider: "#F59E0B",
    devin: "#EC4899",
    codex: "#10B981",
    "amazon-q": "#FF9900",
    sweep: "#6366F1",
    windsurf: "#06B6D4",
  };

  const categoryColors: Record<string, string> = {
    bug: "#EF4444",
    security: "#F59E0B",
    "type-safety": "#8B5CF6",
    perf: "#F97316",
    logic: "#3B82F6",
    style: "#6B7280",
    other: "#9CA3AF",
  };

  // Separate known tools from unattributed "ai" catch-all
  const displayToolEntries: [string, number][] = useMemo(() => {
    return toolEntries
      .filter(([tool]) => tool.toLowerCase() !== "ai")
      .map(([tool, count]) => [tool, count] as [string, number]);
  }, [toolEntries]);

  const unattributedAICount = useMemo(() => {
    const aiEntry = toolEntries.find(([tool]) => tool.toLowerCase() === "ai");
    return aiEntry ? aiEntry[1] : 0;
  }, [toolEntries]);

  // ─── Per-author AI adoption (excludes bots via shared isBotAuthor) ───
  const authorAIRows = useMemo(() => {
    const authorStats = new Map<string, { total: number; ai: number; toolCounts: Map<string, number>; cycleTimes: number[]; sizes: number[] }>();
    for (const m of humanMetrics) {
      if (!m.author) continue;
      if (!authorStats.has(m.author)) authorStats.set(m.author, { total: 0, ai: 0, toolCounts: new Map(), cycleTimes: [], sizes: [] });
      const s = authorStats.get(m.author)!;
      s.total++;
      if (m.cycleTimeHours != null) s.cycleTimes.push(m.cycleTimeHours);
      s.sizes.push(m.additions + m.deletions);
      if (m.aiAssisted) {
        s.ai++;
        for (const t of m.aiTools) {
          if (t.toLowerCase() === "ai") continue;
          s.toolCounts.set(t, (s.toolCounts.get(t) ?? 0) + 1);
        }
      }
    }
    return [...authorStats.entries()]
      .map(([author, s]) => {
        const cleanCycles = removeOutliers(s.cycleTimes);
        const avgCycle = cleanCycles.length > 0
          ? cleanCycles.reduce((a, b) => a + b, 0) / cleanCycles.length
          : null;
        const avgSize = s.sizes.length > 0
          ? Math.round(s.sizes.reduce((a, b) => a + b, 0) / s.sizes.length)
          : 0;
        return {
          author,
          total: s.total,
          ai: s.ai,
          pct: s.total > 0 ? Math.round((s.ai / s.total) * 100) : 0,
          toolCounts: [...s.toolCounts.entries()].sort((a, b) => b[1] - a[1]),
          tools: [...s.toolCounts.keys()].sort(),
          avgCycleHours: avgCycle,
          avgSize,
        };
      })
      .filter(r => r.total >= 2)
      .sort((a, b) => b.pct - a.pct || b.ai - a.ai);
  }, [humanMetrics]);

  const activeAuthorRows = useMemo(() => authorAIRows.filter(r => r.ai > 0), [authorAIRows]);
  const zeroAdoptionCount = useMemo(() => authorAIRows.filter(r => r.ai === 0).length, [authorAIRows]);
  const [showZeroAuthors, setShowZeroAuthors] = useState(false);
  const [showAllAuthors, setShowAllAuthors] = useState(false);
  const [showLowTeams, setShowLowTeams] = useState(false);

  type AuthorSortKey = "pct" | "ai" | "total" | "cycle";
  const [authorSortKey, setAuthorSortKey] = useState<AuthorSortKey>("pct");
  const [authorSortAsc, setAuthorSortAsc] = useState(false);

  const sortedActiveAuthors = useMemo(() => {
    const rows = [...activeAuthorRows];
    const dir = authorSortAsc ? 1 : -1;
    rows.sort((a, b) => {
      switch (authorSortKey) {
        case "pct": return dir * (a.pct - b.pct) || b.ai - a.ai;
        case "ai": return dir * (a.ai - b.ai);
        case "total": return dir * (a.total - b.total);
        case "cycle": {
          const aVal = a.avgCycleHours ?? Infinity;
          const bVal = b.avgCycleHours ?? Infinity;
          return dir * (aVal - bVal);
        }
        default: return 0;
      }
    });
    return rows;
  }, [activeAuthorRows, authorSortKey, authorSortAsc]);

  const toggleAuthorSort = (key: AuthorSortKey) => {
    if (authorSortKey === key) setAuthorSortAsc((a) => !a);
    else { setAuthorSortKey(key); setAuthorSortAsc(false); }
  };

  const authorBackfillPending = useMemo(
    () => metrics.length > 0 && metrics.every(m => !m.author),
    [metrics],
  );

  // ─── Team breakdown rows (pre-computed) ───
  const teamRows = useMemo(() => {
    const teamStats = new Map<string, PRMetric[]>();
    const unlinked: PRMetric[] = [];
    const source =
      selectedRepo === "__all__"
        ? allMetrics
        : allMetrics.filter((x) => x.repo === selectedRepo);
    const seen = new Set<number>();
    for (const m of source) {
      if (m.id != null && seen.has(m.id)) continue;
      if (m.id != null) seen.add(m.id);
      const tickets = prToTickets.get(m.id!);
      if (!tickets?.length) {
        unlinked.push(m);
        continue;
      }
      const team = tickets[0].component ?? "No Component";
      if (!teamStats.has(team)) teamStats.set(team, []);
      teamStats.get(team)!.push(m);
    }
    const rows = Array.from(teamStats.entries()).sort(
      (a, b) => b[1].length - a[1].length,
    );
    if (unlinked.length > 0) rows.push(["Unlinked", unlinked]);

    return rows.map(([team, prs]) => {
      const ct = removeOutliers(
        prs
          .filter((p) => p.cycleTimeHours !== null && p.mergedAt)
          .map((p) => toBusinessHours(p.cycleTimeHours!, p.createdAt, p.mergedAt!)),
      );
      const rt = removeOutliers(
        prs
          .filter((p) => p.timeToFirstReviewHours !== null)
          .map((p) => {
            const reviewEnd = new Date(new Date(p.createdAt).getTime() + p.timeToFirstReviewHours! * 3600000).toISOString();
            return toBusinessHours(p.timeToFirstReviewHours!, p.createdAt, reviewEnd);
          }),
      );
      const avgSize = prs.length
        ? Math.round(
            prs.reduce((a, p) => a + p.additions + p.deletions, 0) /
              prs.length,
          )
        : 0;
      const aiPctTeam = prs.length
        ? Math.min(100, Math.round(
            (prs.filter((p) => p.aiAssisted).length / prs.length) * 100,
          ))
        : 0;
      const avgCycleHours = ct.length
        ? ct.reduce((a, b) => a + b, 0) / ct.length
        : null;
      const medReviewHours = rt.length ? median(rt) : null;
      return {
        team,
        prCount: prs.length,
        avgCycleHours,
        medReviewHours,
        avgSize,
        aiPctTeam,
      };
    });
  }, [allMetrics, selectedRepo, prToTickets]);

  // ─── Manual sync ───
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncPhase, setSyncPhase] = useState<string>("");

  // Ref to hold resolve fn so the completion listener can unblock handleSync
  const ghSyncResolveRef = React.useRef<
    ((result: { synced?: number; total?: number; errors?: string[]; error?: string }) => void) | null
  >(null);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    setJiraSyncProgress(null);
    const parts: string[] = [];
    try {
      // 1. GitHub sync — skip if synced within the last hour
      const storageSnap = await chrome.storage.local.get([
        "githubLastSynced",
        "jiraToken",
        "jiraEmail",
      ]);
      const ghLastSynced = storageSnap.githubLastSynced as string | undefined;
      const ghSyncedRecently =
        ghLastSynced &&
        Date.now() - new Date(ghLastSynced).getTime() < 60 * 60 * 1000;

      let ghMsg: string | null = null;
      if (ghSyncedRecently) {
        ghMsg = "GitHub up to date";
        setSyncPhase("Skipping GitHub (recent)…");
      } else {
        setSyncPhase("Fetching PRs…");

        // Fire-and-forget — completion comes via GITHUB_SYNC_COMPLETE broadcast
        // Timeout after 5 minutes to avoid stuck UI
        const ghResult = await new Promise<{
          synced?: number;
          total?: number;
          errors?: string[];
          error?: string;
        }>((resolve) => {
          const timeout = setTimeout(() => {
            ghSyncResolveRef.current = null;
            resolve({ error: "Sync timed out after 5 minutes" });
          }, 5 * 60 * 1000);
          ghSyncResolveRef.current = (msg) => {
            clearTimeout(timeout);
            resolve(msg);
          };
          chrome.runtime.sendMessage({ type: "GITHUB_SYNC" }).catch(() => {});
        });

        const ghErrors = ghResult.errors;
        const ghError = ghResult.error;
        if (ghErrors?.length)
          parts.push(`GitHub: ${ghErrors.join(", ")}`);
        else if (ghError) parts.push(`GitHub: ${ghError}`);

        const ghSynced = ghResult.synced;
        const ghTotal = ghResult.total;
        ghMsg =
          ghSynced != null && ghSynced > 0
            ? `${ghSynced} PRs`
            : ghTotal && ghTotal > 0
              ? `${ghTotal} PRs (up to date)`
              : null;
      }

      // 2. Jira sync (if configured)
      let jiraMsg: string | null = null;
      if (storageSnap.jiraToken && storageSnap.jiraEmail) {
        setSyncPhase("Jira tickets…");
        const jiraResp = await chrome.runtime.sendMessage({
          type: "JIRA_SYNC",
        });

        if (jiraResp) {
          const jErrors = jiraResp.errors as string[] | undefined;
          const jError = jiraResp.error as string | undefined;
          if (jErrors?.length)
            parts.push(`Jira: ${jErrors.join(", ")}`);
          else if (jError) parts.push(`Jira: ${jError}`);

          const jSynced = jiraResp.synced as number | undefined;
          const jLinked = jiraResp.linked as number | undefined;
          jiraMsg =
            [
              jSynced ? `${jSynced} tickets` : null,
              jLinked ? `${jLinked} linked` : null,
            ]
              .filter(Boolean)
              .join(", ") || null;
        }
        setJiraSyncProgress(null);
      }

      // Combined result
      setSyncResult(
        [ghMsg, jiraMsg].filter(Boolean).join(" · ") || "Up to date",
      );
      if (parts.length) setSyncError(parts.join(" | "));

      const r = await chrome.storage.local.get([
        "githubLastSynced",
        "jiraLastSynced",
      ]);
      setLastSynced(r.githubLastSynced ?? r.jiraLastSynced ?? null);
      setQueryKey((k) => k + 1);
    } catch (e) {
      setSyncError(String(e));
    } finally {
      setSyncing(false);
      setSyncPhase("");
      setJiraSyncProgress(null);
    }
  }, []);

  // Listen for sync progress messages
  useEffect(() => {
    const listener = (message: {
      type?: string;
      phase?: string;
      current?: number;
      total?: number;
      repo?: string;
    }) => {
      if (message.type === "JIRA_SYNC_PROGRESS") {
        setJiraSyncProgress({
          phase: message.phase ?? "tickets",
          current: message.current ?? 0,
          total: message.total ?? 0,
        });
      } else if (message.type === "GITHUB_SYNC_PROGRESS") {
        setSyncPhase(`Enriching ${message.current}/${message.total} PRs…`);
      } else if (message.type === "GITHUB_SYNC_COMPLETE") {
        if (ghSyncResolveRef.current) {
          ghSyncResolveRef.current(message as Record<string, unknown>);
          ghSyncResolveRef.current = null;
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // ─── Sub-tabs + customization state ───
  const [activeTab, setActiveTab] = useState<EngStatsTab>("Summary");
  const { config, updateConfig } = useEngStatsConfig();
  const [showCustomize, setShowCustomize] = useState(false);
  const customizeRef = useRef<HTMLDivElement>(null);

  // ─── Teams view state: sort + expand ───
  const [teamSortCol, setTeamSortCol] = useState<string>("prs");
  const [teamSortDir, setTeamSortDir] = useState(-1);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [hoveredTeam, setHoveredTeam] = useState<string | null>(null);

  const handleTeamSort = useCallback((col: string) => {
    setTeamSortCol((prev) => {
      if (prev === col) {
        setTeamSortDir((d) => d * -1);
        return col;
      }
      setTeamSortDir(-1);
      return col;
    });
  }, []);

  const sortedTeamRows = useMemo(() => {
    return [...teamRows].sort((a, b) => {
      let va: number, vb: number;
      switch (teamSortCol) {
        case "prs": va = a.prCount; vb = b.prCount; break;
        case "cycle": va = a.avgCycleHours ?? 0; vb = b.avgCycleHours ?? 0; break;
        case "medReview": va = a.medReviewHours ?? 0; vb = b.medReviewHours ?? 0; break;
        case "avgLines": va = a.avgSize; vb = b.avgSize; break;
        case "ai": va = a.aiPctTeam; vb = b.aiPctTeam; break;
        default: va = a.prCount; vb = b.prCount;
      }
      return (va - vb) * teamSortDir;
    });
  }, [teamRows, teamSortCol, teamSortDir]);

  // ─── Per-team weekly cycle data for sparklines + expanded detail ───
  const teamWeeklyCycles = useMemo(() => {
    const result = new Map<string, number[]>();
    const teamPRs = new Map<string, PRMetric[]>();
    const source = selectedRepo === "__all__" ? allMetrics : allMetrics.filter((x) => x.repo === selectedRepo);
    for (const m of source) {
      const tickets = prToTickets.get(m.id!);
      const team = tickets?.[0]?.component ?? (tickets?.length ? "No Component" : "Unlinked");
      if (!teamPRs.has(team)) teamPRs.set(team, []);
      teamPRs.get(team)!.push(m);
    }
    for (const [team, prs] of teamPRs) {
      const byWeek = new Map<string, number[]>();
      for (const m of prs) {
        if (!m.mergedAt || m.cycleTimeHours === null) continue;
        const biz = toBusinessHours(m.cycleTimeHours, m.createdAt, m.mergedAt);
        const key = weekKey(new Date(m.mergedAt));
        if (!byWeek.has(key)) byWeek.set(key, []);
        byWeek.get(key)!.push(biz / 24);
      }
      const weekly = Array.from(byWeek.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([, vals]) => vals.reduce((a, b) => a + b, 0) / vals.length)
        .slice(-6);
      result.set(team, weekly);
    }
    return result;
  }, [allMetrics, selectedRepo, prToTickets]);

  // ─── Per-team PR size distribution for expanded detail ───
  const teamSizeDist = useMemo(() => {
    const result = new Map<string, { s: number; m: number; l: number }>();
    const source = selectedRepo === "__all__" ? allMetrics : allMetrics.filter((x) => x.repo === selectedRepo);
    for (const m of source) {
      const tickets = prToTickets.get(m.id!);
      const team = tickets?.[0]?.component ?? (tickets?.length ? "No Component" : "Unlinked");
      if (!result.has(team)) result.set(team, { s: 0, m: 0, l: 0 });
      const dist = result.get(team)!;
      const lines = m.additions + m.deletions;
      if (lines < 100) dist.s++;
      else if (lines < 500) dist.m++;
      else dist.l++;
    }
    return result;
  }, [allMetrics, selectedRepo, prToTickets]);

  // Close customize popover on outside click
  useEffect(() => {
    if (!showCustomize) return;
    const handler = (e: MouseEvent) => {
      if (customizeRef.current && !customizeRef.current.contains(e.target as Node)) {
        setShowCustomize(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showCustomize]);

  // ─── KPI card reorder helpers ───
  const moveKpi = useCallback((id: KpiId, dir: -1 | 1) => {
    updateConfig({
      kpiOrder: (() => {
        const order = [...config.kpiOrder];
        const idx = order.indexOf(id);
        if (idx < 0) return order;
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= order.length) return order;
        [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
        return order;
      })(),
    });
  }, [config.kpiOrder, updateConfig]);

  // ─── Section visibility helper ───
  const sectionVisible = useCallback((id: SectionId) => config.visibleSections.includes(id), [config.visibleSections]);
  const toggleSection = useCallback((id: SectionId) => {
    const current = config.visibleSections;
    const next = current.includes(id) ? current.filter((s) => s !== id) : [...current, id];
    updateConfig({ visibleSections: next });
  }, [config.visibleSections, updateConfig]);

  // ─── Styles ───
  const cardBg = dk(darkMode, "#1c1c22", OS.white);
  const cardBorder = `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`;
  const sectionTitle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary),
    fontFamily: OS.font,
    margin: 0,
    marginBottom: 12,
  };
  const subLabel: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontFamily: OS.mono,
    color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
    margin: 0,
    marginBottom: 8,
  };
  const subTabStyle = (active: boolean): React.CSSProperties => ({
    background: active ? dk(darkMode, "rgba(255,255,255,0.08)", OS.blue) : "transparent",
    color: active ? dk(darkMode, "#fff", "#fff") : dk(darkMode, "rgba(255,255,255,0.4)", OS.muted),
    border: "none",
    borderRadius: 4,
    padding: "5px 12px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: OS.font,
  });

  // ─── PR Backlog Projection ───
  const prProjection = useMemo(() => {
    // Current open count: latest snapshot per repo, summed
    const latestByRepo = new Map<string, OpenPRSnapshot>();
    for (const s of openSnapshots) {
      const existing = latestByRepo.get(s.repo);
      if (!existing || s.snapshotAt > existing.snapshotAt) {
        latestByRepo.set(s.repo, s);
      }
    }
    // Respect repo filter
    const relevantSnapshots = selectedRepo === "__all__"
      ? Array.from(latestByRepo.values())
      : Array.from(latestByRepo.values()).filter((s) => s.repo === selectedRepo);
    const currentOpen = relevantSnapshots.reduce((sum, s) => sum + s.openCount, 0);

    // Close rate: PRs merged per day over last 30 days
    const thirtyDaysAgo = daysAgoISO(30);
    const recentMerged = metrics.filter((m) => m.mergedAt && m.mergedAt >= thirtyDaysAgo);
    const closeRatePerDay = recentMerged.length / 30;

    // Open rate: combine merged PR createdAt + currently open PR createdAt
    const recentMergedCreated = metrics.filter((m) => m.createdAt >= thirtyDaysAgo);
    const relevantRepos = selectedRepo === "__all__"
      ? Object.keys(openPRCreatedDates)
      : [selectedRepo];
    let openCreatedInWindow = 0;
    for (const repo of relevantRepos) {
      const dates = openPRCreatedDates[repo] ?? [];
      openCreatedInWindow += dates.filter((d) => d >= thirtyDaysAgo).length;
    }
    const totalOpened = recentMergedCreated.length + openCreatedInWindow;
    const openRatePerDay = totalOpened / 30;

    const netRatePerDay = openRatePerDay - closeRatePerDay;

    // Projections
    const projected7d = Math.round(currentOpen + netRatePerDay * 7);
    const projected14d = Math.round(currentOpen + netRatePerDay * 14);

    // Chart data: daily points for 14 days
    const projectionPoints = Array.from({ length: 15 }, (_, i) => ({
      day: i,
      count: Math.round(currentOpen + netRatePerDay * i),
    }));

    return {
      currentOpen,
      openRatePerWeek: Math.round(openRatePerDay * 7 * 10) / 10,
      closeRatePerWeek: Math.round(closeRatePerDay * 7 * 10) / 10,
      netRatePerWeek: Math.round(netRatePerDay * 7 * 10) / 10,
      projected7d,
      projected14d,
      projectionPoints,
      hasData: latestByRepo.size > 0,
    };
  }, [openSnapshots, metrics, openPRCreatedDates, selectedRepo]);

  const noData = allMetrics.length === 0;

  return (
    <div
      style={{
        padding: "16px",
        fontFamily: OS.font,
        color: dk(darkMode, "#fff", OS.text),
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* ─── Header ─── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: dk(darkMode, "#fff", OS.text),
          }}
        >
          Eng Stats
        </span>

        {/* Repo selector */}
        {allRepos.length > 0 && (
          <select
            value={selectedRepo}
            onChange={(e) => setSelectedRepo(e.target.value)}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 6,
              border: cardBorder,
              background: cardBg,
              color: dk(darkMode, "rgba(255,255,255,0.8)", OS.text),
              fontFamily: OS.font,
              cursor: "pointer",
            }}
          >
            <option value="__all__">All repos</option>
            {allRepos.map((r) => (
              <option key={r} value={r}>
                {r.split("/")[1] ?? r}
              </option>
            ))}
          </select>
        )}

        {/* Team selector (from Jira components) */}
        {teams.length > 0 && (
          <select
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 6,
              border: cardBorder,
              background: cardBg,
              color: dk(darkMode, "rgba(255,255,255,0.8)", OS.text),
              fontFamily: OS.font,
              cursor: "pointer",
            }}
          >
            <option value="__all__">All teams</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}

        {/* Type selector */}
        {issueTypes.length > 0 && (
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 6,
              border: cardBorder,
              background: cardBg,
              color: dk(darkMode, "rgba(255,255,255,0.8)", OS.text),
              fontFamily: OS.font,
              cursor: "pointer",
            }}
          >
            <option value="__all__">All types</option>
            {issueTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}

        {/* Time range toggle */}
        <div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
          {([30, 60, 90, 180, 360] as const).map((d) => (
            <button
              key={d}
              onClick={() => setTimeRange(d)}
              style={{
                fontSize: 11,
                fontWeight: 500,
                padding: "3px 10px",
                borderRadius: 6,
                border: cardBorder,
                cursor: "pointer",
                fontFamily: OS.mono,
                background:
                  timeRange === d
                    ? OS.blue
                    : dk(darkMode, "rgba(255,255,255,0.05)", OS.bg),
                color:
                  timeRange === d
                    ? "#fff"
                    : dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
              }}
            >
              {d}d
            </button>
          ))}
        </div>

        {/* Sync button */}
        <button
          onClick={handleSync}
          disabled={syncing}
          style={{
            fontSize: 11,
            fontWeight: 500,
            padding: "4px 12px",
            borderRadius: 6,
            border: `1px solid ${OS.blue}`,
            background: "transparent",
            color: OS.blue,
            cursor: syncing ? "not-allowed" : "pointer",
            fontFamily: OS.mono,
            opacity: syncing ? 0.6 : 1,
          }}
        >
          {syncing ? syncPhase || "Syncing…" : "Sync"}
        </button>

        {/* Compact sync status — green dot + muted text */}
        {lastSynced && !syncing && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: OS.green,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontFamily: OS.mono,
                color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted),
              }}
            >
              Synced{" "}
              {new Date(lastSynced).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
              · {totalInDB} PRs
            </span>
          </div>
        )}
      </div>

      {/* Sync error */}
      {syncError && (
        <div
          style={{
            fontSize: 11,
            color: OS.red,
            background: "rgba(209,67,67,0.08)",
            border: `1px solid rgba(209,67,67,0.2)`,
            borderRadius: 6,
            padding: "6px 10px",
            fontFamily: OS.mono,
          }}
        >
          Sync error: {syncError}
        </div>
      )}

      {/* Jira sync progress */}
      {jiraSyncProgress && jiraSyncProgress.total > 0 && (
        <div>
          <div
            style={{
              fontSize: 11,
              color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted),
              fontFamily: OS.mono,
              marginBottom: 4,
            }}
          >
            {jiraSyncProgress.phase === "tickets"
              ? "Syncing Jira"
              : "Linking PRs to Jira"}
            … {jiraSyncProgress.current}/{jiraSyncProgress.total}
          </div>
          <div
            style={{
              height: 3,
              borderRadius: 2,
              background: dk(
                darkMode,
                "rgba(255,255,255,0.08)",
                OS.border,
              ),
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.round((jiraSyncProgress.current / jiraSyncProgress.total) * 100)}%`,
                background: OS.blue,
                borderRadius: 2,
                transition: "width 0.3s",
              }}
            />
          </div>
        </div>
      )}

      {/* No GitHub token configured */}
      {repos.length === 0 && (
        <div
          style={{
            padding: "20px",
            textAlign: "center",
            background: cardBg,
            border: cardBorder,
            borderRadius: 10,
            fontSize: 13,
            color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted),
          }}
        >
          No GitHub repos configured.{" "}
          <span style={{ color: OS.blue, fontWeight: 500 }}>
            Add your PAT + repos in Options → Integrations → GitHub.
          </span>
        </div>
      )}

      {/* ─── Sub-tab Navigation + Customize ─── */}
      {repos.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              display: "flex", gap: 2,
              background: dk(darkMode, "rgba(255,255,255,0.03)", OS.bg),
              borderRadius: 6, padding: 3,
            }}>
              {ENG_STATS_TABS.map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={subTabStyle(activeTab === tab)}>
                  {tab}
                </button>
              ))}
            </div>
            <div style={{ marginLeft: "auto", position: "relative" }} ref={customizeRef}>
              <button
                onClick={() => setShowCustomize((p) => !p)}
                style={{
                  background: "transparent", border: "none", cursor: "pointer",
                  fontSize: 14, padding: "4px 8px", borderRadius: 4, opacity: 0.5,
                  color: dk(darkMode, "#fff", OS.text),
                }}
                title="Customize dashboard"
              >
                ⚙
              </button>
              {/* ─── Customize Popover ─── */}
              {showCustomize && (
                <div style={{
                  position: "absolute", top: "100%", right: 0, marginTop: 4,
                  width: 280, maxHeight: 420, overflowY: "auto",
                  background: dk(darkMode, "#1c1c22", OS.white),
                  border: cardBorder, borderRadius: 8, padding: 12,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.2)", zIndex: 100,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 10, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary) }}>
                    Customize Dashboard
                  </div>

                  {/* Section visibility */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={subLabel}>Show / Hide Sections</div>
                    {([
                      ["kpis", "KPI Cards"],
                      ["cycleTime", "Cycle Time Chart"],
                      ["aiAdoption", "AI Adoption Chart"],
                      ["prSize", "PR Size Distribution"],
                      ["toolUsage", "Tool Usage"],
                      ["projection", "PR Projection"],
                    ] as [SectionId, string][]).map(([id, label]) => (
                      <label key={id} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "3px 0",
                        fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary), cursor: "pointer",
                      }}>
                        <input type="checkbox" checked={sectionVisible(id)} onChange={() => toggleSection(id)}
                          style={{ accentColor: OS.blue }} />
                        {label}
                      </label>
                    ))}
                  </div>

                  {/* KPI card order */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={subLabel}>KPI Card Order</div>
                    {config.kpiOrder.map((id, idx) => {
                      const names: Record<KpiId, string> = {
                        cycletime: "Avg Cycle Time", medreview: "Med. Review",
                        prsmerged: "PRs Merged", aiassisted: "AI-Assisted", leadtime: "Avg Lead Time",
                      };
                      return (
                        <div key={id} style={{
                          display: "flex", alignItems: "center", gap: 6, padding: "2px 0",
                          fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary),
                        }}>
                          <button onClick={() => moveKpi(id, -1)} disabled={idx === 0}
                            style={{ background: "transparent", border: "none", cursor: idx === 0 ? "default" : "pointer", fontSize: 10, opacity: idx === 0 ? 0.2 : 0.6, color: dk(darkMode, "#fff", OS.text), padding: "0 2px" }}>▲</button>
                          <button onClick={() => moveKpi(id, 1)} disabled={idx === config.kpiOrder.length - 1}
                            style={{ background: "transparent", border: "none", cursor: idx === config.kpiOrder.length - 1 ? "default" : "pointer", fontSize: 10, opacity: idx === config.kpiOrder.length - 1 ? 0.2 : 0.6, color: dk(darkMode, "#fff", OS.text), padding: "0 2px" }}>▼</button>
                          <span>{names[id]}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* KPI display toggles */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={subLabel}>KPI Card Elements</div>
                    {(["delta", "sparkline", "subtitle"] as const).map((key) => (
                      <label key={key} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "3px 0",
                        fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary), cursor: "pointer",
                      }}>
                        <input type="checkbox"
                          checked={Object.values(config.kpiDisplay).every((d) => d[key])}
                          onChange={() => {
                            const allOn = Object.values(config.kpiDisplay).every((d) => d[key]);
                            const next = { ...config.kpiDisplay };
                            for (const k of Object.keys(next) as KpiId[]) {
                              next[k] = { ...next[k], [key]: !allOn };
                            }
                            updateConfig({ kpiDisplay: next });
                          }}
                          style={{ accentColor: OS.blue }}
                        />
                        Show {key === "delta" ? "% change" : key}
                      </label>
                    ))}
                  </div>

                  {/* Team table columns (only relevant in Teams view) */}
                  <div>
                    <div style={subLabel}>Team Table Columns</div>
                    {([
                      ["prs", "PRs"], ["cycle", "Cycle"], ["medReview", "Med Review"],
                      ["avgLines", "Δ Lines"], ["ai", "AI %"], ["trend", "Trend"],
                    ] as [TeamColumnId, string][]).map(([id, label]) => (
                      <label key={id} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "3px 0",
                        fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary), cursor: "pointer",
                      }}>
                        <input type="checkbox"
                          checked={config.teamColumns.includes(id)}
                          onChange={() => {
                            const cols = config.teamColumns.includes(id)
                              ? config.teamColumns.filter((c) => c !== id)
                              : [...config.teamColumns, id];
                            updateConfig({ teamColumns: cols });
                          }}
                          style={{ accentColor: OS.blue }}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ─── KPI Cards (Summary tab only) ─── */}
          {activeTab === "Summary" && sectionVisible("kpis") && (() => {
            const kpiDefs: Record<KpiId, Omit<KPICardProps, "dark" | "showDelta" | "showSparkline" | "showSubtitle">> = {
              cycletime: {
                label: "Avg Cycle Time", value: fmtHours(avgCycleTime),
                sparklineData: weeklyCycleDays, deltaPercent: cycleDelta,
                deltaPeriodLabel: `vs prev ${timeRange / 2}d`, trendPositive: false,
                detailSub: `${cycleTimes.length} PRs with cycle data`,
              },
              medreview: {
                label: "Median Review Time", value: fmtHours(medianReviewTime),
                sparklineData: weeklyReviewMedians, deltaPercent: reviewDelta,
                deltaPeriodLabel: `vs prev ${timeRange / 2}d`, trendPositive: false,
                detailSub: "time to first review",
              },
              prsmerged: {
                label: "PRs Merged", value: String(prsMerged),
                sparklineData: weeklyPRCounts, deltaPercent: prsDelta,
                deltaPeriodLabel: `vs prev ${timeRange / 2}d`, trendPositive: true,
                detailSub: `last ${timeRange} days`,
              },
              aiassisted: {
                label: "AI-Assisted", value: `${aiPct}%`,
                sparklineData: weeklyAIPcts, deltaPercent: aiDelta,
                deltaPeriodLabel: `vs prev ${timeRange / 2}d`, trendPositive: true,
                detailSub: `${aiPRs} of ${prsMerged} PRs`,
              },
              leadtime: {
                label: "Avg Lead Time", value: fmtHours(avgLeadTime),
                sparklineData: weeklyLeadDays, deltaPercent: leadDelta,
                deltaPeriodLabel: `vs prev ${timeRange / 2}d`, trendPositive: false,
                alertBorder: leadTimeIsHigh,
                detailSub: `ticket → merge (${leadTimes.length} linked)`,
              },
            };

            return (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {config.kpiOrder
                  .filter((id) => id !== "leadtime" || avgLeadTime !== null)
                  .map((id) => {
                    const def = kpiDefs[id];
                    const disp = config.kpiDisplay[id];
                    return (
                      <KPICard
                        key={id}
                        {...def}
                        dark={darkMode}
                        showDelta={disp.delta}
                        showSparkline={disp.sparkline}
                        showSubtitle={disp.subtitle}
                      />
                    );
                  })}
              </div>
            );
          })()}


          {noData && (
            <div
              style={{
                padding: "16px",
                textAlign: "center",
                background: cardBg,
                border: cardBorder,
                borderRadius: 10,
                fontSize: 12,
                color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted),
              }}
            >
              No PR data for this period. Click <strong>Sync</strong> to
              fetch from GitHub.
            </div>
          )}

          {/* ─── Summary View ─── */}
          {activeTab === "Summary" && !noData && (
            <>
              {sectionVisible("cycleTime") && sectionVisible("aiAdoption") ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary) }}>Cycle Time</span>
                      <span style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.faint), fontFamily: OS.mono }}>weekly avg, days</span>
                    </div>
                    {weeklyBuckets.length > 0 ? (
                      <CycleTimeChart buckets={weeklyBuckets} dark={darkMode} height={300} />
                    ) : (
                      <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted), height: 80, display: "flex", alignItems: "center" }}>Not enough data</div>
                    )}
                  </div>
                  <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary) }}>AI Adoption</span>
                      <span style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.faint), fontFamily: OS.mono }}>weekly % of PRs</span>
                    </div>
                    <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginBottom: 8 }}>{aiSubtitle}</div>
                    {weeklyAI.length >= 2 && <AIAdoptionChart weeklyPcts={weeklyAI} dark={darkMode} height={280} />}
                  </div>
                </div>
              ) : (
                <>
                  {sectionVisible("cycleTime") && (
                    <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary) }}>Cycle Time</span>
                        <span style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.faint), fontFamily: OS.mono }}>weekly avg, days</span>
                      </div>
                      {weeklyBuckets.length > 0 ? <CycleTimeChart buckets={weeklyBuckets} dark={darkMode} height={300} /> : null}
                    </div>
                  )}
                  {sectionVisible("aiAdoption") && weeklyAI.length >= 2 && (
                    <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary) }}>AI Adoption</span>
                        <span style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.faint), fontFamily: OS.mono }}>weekly % of PRs</span>
                      </div>
                      <AIAdoptionChart weeklyPcts={weeklyAI} dark={darkMode} height={280} />
                    </div>
                  )}
                </>
              )}
              {(sectionVisible("prSize") || sectionVisible("toolUsage")) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {sectionVisible("prSize") && (
                    <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                      <h3 style={sectionTitle}>PR Size Distribution</h3>
                      <PRSizeChart small={smallCount} medium={mediumCount} large={largeCount} dark={darkMode} />
                    </div>
                  )}
                  {sectionVisible("toolUsage") && (
                    <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                      <h3 style={sectionTitle}>AI Tool Usage</h3>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {displayToolEntries.map(([tool, count]) => {
                          const maxCount = displayToolEntries.length > 0 ? displayToolEntries[0][1] : 1;
                          return (
                            <div key={tool} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 11, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), width: 80, flexShrink: 0, textTransform: "capitalize" }}>{tool}</span>
                              <div style={{ flex: 1, height: 12, borderRadius: 3, background: dk(darkMode, "rgba(255,255,255,0.06)", OS.border), overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${Math.round((count / maxCount) * 100)}%`, background: toolColors[tool.toLowerCase()] ?? OS.faint, borderRadius: 3, minWidth: count > 0 ? 2 : 0 }} />
                              </div>
                              <span style={{ fontSize: 11, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), minWidth: 24, textAlign: "right" }}>{count}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ─── PR Backlog Projection ─── */}
              {sectionVisible("projection") && (
                <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                  <h3 style={sectionTitle}>PR Backlog Projection</h3>
                  {!prProjection.hasData ? (
                    <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), padding: "12px 0" }}>
                      No open PR data yet — click <strong>Scan Now</strong> to sync.
                    </div>
                  ) : (
                    <>
                      {/* Mini KPI cards */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12 }}>
                        {[
                          { label: "Open Now", value: String(prProjection.currentOpen) },
                          { label: "Opened / wk", value: String(prProjection.openRatePerWeek) },
                          { label: "Closed / wk", value: String(prProjection.closeRatePerWeek) },
                          { label: "Net / wk", value: (prProjection.netRatePerWeek >= 0 ? "+" : "") + prProjection.netRatePerWeek },
                        ].map((kpi) => (
                          <div key={kpi.label} style={{
                            padding: "8px 10px", borderRadius: 8,
                            background: dk(darkMode, "rgba(255,255,255,0.04)", "rgba(0,0,0,0.02)"),
                            border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
                          }}>
                            <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), marginBottom: 2 }}>{kpi.label}</div>
                            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: OS.mono, color: dk(darkMode, "#fff", OS.text) }}>{kpi.value}</div>
                          </div>
                        ))}
                      </div>

                      {/* Projection chart */}
                      <ProjectionChart
                        points={prProjection.projectionPoints}
                        currentOpen={prProjection.currentOpen}
                        projected7d={prProjection.projected7d}
                        projected14d={prProjection.projected14d}
                        dark={darkMode}
                      />

                      {/* Insight text */}
                      <div style={{
                        fontSize: 11, marginTop: 10, padding: "8px 10px", borderRadius: 6,
                        background: dk(darkMode, "rgba(234,88,12,0.1)", "rgba(234,88,12,0.06)"),
                        color: dk(darkMode, "#FB923C", "#C2410C"),
                        fontFamily: OS.font,
                      }}>
                        {prProjection.netRatePerWeek > 0
                          ? `At current rates, open PRs will reach ~${prProjection.projected14d} in 2 weeks if nothing changes.`
                          : prProjection.netRatePerWeek < 0
                          ? `Backlog is shrinking — projected to reach ~${prProjection.projected14d} in 2 weeks.`
                          : `Open/close rates are balanced — backlog is holding steady at ~${prProjection.currentOpen}.`}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {/* ─── Cycle Time View ─── */}
          {activeTab === "Cycle Time" && !noData && (
            <>
              <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.8)", OS.secondary), marginBottom: 2 }}>
                  Weekly Average Cycle Time
                </div>
                <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginBottom: 12 }}>
                  {weeklyBuckets.length > 0 ? `${weeklyBuckets.length} weeks of data` : ""}
                </div>
                {weeklyBuckets.length > 0 && (
                  <CycleTimeChart buckets={weeklyBuckets} dark={darkMode} fullWidth height={220} />
                )}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), marginTop: 4 }}>
                By Team
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {teamRows
                  .filter((r) => r.team !== "Unlinked")
                  .sort((a, b) => (b.avgCycleHours ?? 0) - (a.avgCycleHours ?? 0))
                  .map((r) => {
                    const flagCycle = r.avgCycleHours != null && r.avgCycleHours > 240;
                    const trend = teamWeeklyCycles.get(r.team) ?? [];
                    return (
                      <div key={r.team} style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg, display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary) }}>{r.team}</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <span style={{ fontSize: 20, fontWeight: 700, color: flagCycle ? OS.red : dk(darkMode, "#fff", OS.text) }}>{fmtHours(r.avgCycleHours)}</span>
                          <span style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.faint) }}>{r.prCount} PRs</span>
                        </div>
                        {trend.length >= 2 && <Sparkline data={trend} width={120} height={28} color={flagCycle ? OS.red : OS.blue} />}
                        <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), fontFamily: OS.mono }}>med review: {fmtHours(r.medReviewHours)}</div>
                      </div>
                    );
                  })}
              </div>
            </>
          )}

          {/* ─── AI Adoption View ─── */}
          {activeTab === "AI Adoption" && !noData && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Hero KPI cards */}
              <div style={{ display: "grid", gridTemplateColumns: aiCycleComparison ? "1fr 1fr 1fr" : "1fr 1fr", gap: 12 }}>
                {/* Card 1 — AI-Assisted PRs */}
                <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg, textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: dk(darkMode, "#fff", OS.text), fontFamily: OS.mono }}>
                    {aiPct}%
                  </div>
                  <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), marginTop: 2 }}>
                    AI-Assisted PRs
                  </div>
                  {aiDelta != null && (
                    <span style={{
                      display: "inline-block",
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: OS.mono,
                      padding: "2px 8px",
                      borderRadius: 999,
                      marginTop: 6,
                      background: aiDelta > 0 ? `${OS.green}18` : aiDelta < 0 ? `${OS.red}18` : "transparent",
                      color: aiDelta > 0 ? OS.green : aiDelta < 0 ? OS.red : dk(darkMode, "rgba(255,255,255,0.4)", OS.muted),
                    }}>
                      {aiDelta > 0 ? "+" : ""}{aiDelta}% vs prior
                    </span>
                  )}
                  <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginTop: 4 }}>
                    {aiPRs} of {metrics.length} PRs
                  </div>
                </div>

                {/* Card 2 — AI PR Cycle Time */}
                {aiCycleComparison ? (
                  <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg, textAlign: "center" }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: dk(darkMode, "#fff", OS.text), fontFamily: OS.mono }}>
                      {fmtDays(aiCycleComparison.avgAi)}
                    </div>
                    <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), marginTop: 2 }}>
                      AI PR Cycle Time
                    </div>
                    <span style={{
                      display: "inline-block",
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: OS.mono,
                      padding: "2px 8px",
                      borderRadius: 999,
                      marginTop: 6,
                      background: `${OS.green}18`,
                      color: OS.green,
                    }}>
                      {aiCycleComparison.pctDiff}% faster
                    </span>
                    <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginTop: 4 }}>
                      vs {fmtDays(aiCycleComparison.avgNon)} non-AI avg
                    </div>
                  </div>
                ) : (
                  /* Fallback: tool breakdown takes 2nd slot when no cycle data */
                  null
                )}

                {/* Card 3 — Tool Breakdown */}
                <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.8)", OS.secondary), marginBottom: 8, textAlign: "center" }}>
                    Tool Breakdown
                  </div>
                  {displayToolEntries.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {displayToolEntries.map(([tool, count]) => {
                        const pct = aiPRs > 0 ? Math.round((count / aiPRs) * 100) : 0;
                        return (
                          <div key={tool} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontSize: 12, color: toolColors[tool.toLowerCase()] ?? dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary), textTransform: "capitalize", fontWeight: 500 }}>{tool}</span>
                            <span style={{ fontSize: 11, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted) }}>
                              {count} <span style={{ opacity: 0.6 }}>·</span> {pct}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), textAlign: "center" }}>No tools detected</div>
                  )}
                  {unattributedAICount > 0 && (
                    <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted), marginTop: 6, textAlign: "center" }}>
                      +{unattributedAICount} PRs with unidentified tool
                    </div>
                  )}
                </div>
              </div>

              {/* Weekly trend chart */}
              <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text), marginBottom: 2 }}>
                  Weekly Trend
                </div>
                <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), marginBottom: 12 }}>
                  {aiSubtitle}
                </div>
                {weeklyAI.length >= 2 && (
                  <AIAdoptionChart weeklyPcts={weeklyAI} dark={darkMode} fullWidth height={150} />
                )}
              </div>

              {/* By Team — chip layout */}
              <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text), marginBottom: 2 }}>By Team</div>
                <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), marginBottom: 12 }}>AI adoption rate per team ({timeRange}d)</div>
                {(() => {
                  const allRows = teamRows
                    .filter((r) => r.team !== "Unlinked")
                    .map((r) => ({ team: r.team, aiCount: Math.round(r.prCount * r.aiPctTeam / 100), total: r.prCount, pct: r.aiPctTeam }))
                    .filter((r) => r.aiCount > 0)
                    .sort((a, b) => b.pct - a.pct);
                  const highRows = allRows.filter((r) => r.pct >= 15);
                  const lowRows = allRows.filter((r) => r.pct < 15);
                  const unlinkedRow = teamRows.find((r) => r.team === "Unlinked");

                  const chipStyle = (pct: number): React.CSSProperties => ({
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
                    background: dk(darkMode, "rgba(255,255,255,0.03)", OS.bg),
                    minWidth: 90,
                  });

                  return allRows.length === 0 ? (
                    <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted) }}>No AI-assisted PRs</div>
                  ) : (
                    <>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {highRows.map((r) => (
                          <div key={r.team} style={chipStyle(r.pct)}>
                            <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary), marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.team}>{r.team}</div>
                            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: OS.mono, color: r.pct > 30 ? OS.green : r.pct > 15 ? OS.warning : dk(darkMode, "rgba(255,255,255,0.5)", OS.muted) }}>
                              {r.pct}%
                            </div>
                            <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginTop: 2 }}>
                              {r.aiCount} PRs
                            </div>
                          </div>
                        ))}
                        {lowRows.length > 0 && !showLowTeams && (
                          <div
                            onClick={() => setShowLowTeams(true)}
                            style={{
                              ...chipStyle(0),
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              minHeight: 60,
                            }}
                          >
                            <span style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.45)", OS.muted) }}>
                              +{lowRows.length} team{lowRows.length !== 1 ? "s" : ""} under 15%
                            </span>
                          </div>
                        )}
                        {showLowTeams && lowRows.map((r) => (
                          <div key={r.team} style={{ ...chipStyle(r.pct), opacity: 0.7 }}>
                            <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.team}>{r.team}</div>
                            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted) }}>
                              {r.pct}%
                            </div>
                            <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted), marginTop: 2 }}>
                              {r.aiCount} PRs
                            </div>
                          </div>
                        ))}
                        {showLowTeams && lowRows.length > 0 && (
                          <div
                            onClick={() => setShowLowTeams(false)}
                            style={{ ...chipStyle(0), cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 60 }}
                          >
                            <span style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.45)", OS.muted) }}>Collapse ▴</span>
                          </div>
                        )}
                      </div>
                      {unlinkedRow && (
                        <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginTop: 10 }}>
                          {unlinkedRow.prCount} PRs not linked to Jira (excluded from team breakdown)
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Per-author AI adoption */}
              <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text), marginBottom: 2 }}>By Author</div>
                <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), marginBottom: 8 }}>
                  AI adoption rate per contributor, bots excluded ({timeRange}d)
                </div>
                {/* Tool legend */}
                {displayToolEntries.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
                    {displayToolEntries.map(([tool]) => (
                      <div key={tool} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{
                          width: 8, height: 8, borderRadius: 2,
                          background: toolColors[tool.toLowerCase()] ?? dk(darkMode, "rgba(255,255,255,0.15)", OS.faint),
                          flexShrink: 0,
                        }} />
                        <span style={{
                          fontSize: 11,
                          color: dk(darkMode, "rgba(255,255,255,0.55)", OS.secondary),
                          textTransform: "capitalize",
                        }}>
                          {tool}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {authorBackfillPending ? (
                  <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), padding: "8px 0" }}>
                    Author data syncing — reload extension or trigger a GitHub sync to populate.
                  </div>
                ) : authorAIRows.length === 0 ? (
                  <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted) }}>No authors with 2+ PRs in this period</div>
                ) : (
                  <>
                    {/* Table header — sortable, 4-column (no Tools) */}
                    {(() => {
                      const thBase: React.CSSProperties = {
                        fontSize: 11,
                        color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted),
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        cursor: "pointer",
                        userSelect: "none",
                        fontFamily: OS.font,
                        fontWeight: 500,
                        background: "none",
                        border: "none",
                        padding: 0,
                      };
                      const arrow = (key: AuthorSortKey) =>
                        authorSortKey === key ? (authorSortAsc ? " ▴" : " ▾") : "";
                      const activeColor = dk(darkMode, "rgba(255,255,255,0.8)", OS.text);
                      return (
                        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 52px 52px", gap: 6, marginBottom: 6, padding: "0 0 4px 0", borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}` }}>
                          <div style={{ ...thBase, cursor: "default" }}>Author</div>
                          <button onClick={() => toggleAuthorSort("pct")} style={{ ...thBase, color: authorSortKey === "pct" ? activeColor : thBase.color }}>AI %{arrow("pct")}</button>
                          <button onClick={() => toggleAuthorSort("ai")} style={{ ...thBase, textAlign: "right", color: authorSortKey === "ai" ? activeColor : thBase.color }}>PRs{arrow("ai")}</button>
                          <button onClick={() => toggleAuthorSort("cycle")} style={{ ...thBase, textAlign: "right", color: authorSortKey === "cycle" ? activeColor : thBase.color }}>Cycle{arrow("cycle")}</button>
                        </div>
                      );
                    })()}
                    {/* Active author rows (ai > 0) — capped at 8, expandable */}
                    {sortedActiveAuthors.slice(0, showAllAuthors ? sortedActiveAuthors.length : 8).map((r) => {
                      // Color bar by primary tool, fall back to threshold colors
                      const primaryTool = r.toolCounts.length > 0 ? r.toolCounts[0][0] : null;
                      const primaryToolColor = primaryTool ? toolColors[primaryTool.toLowerCase()] : null;
                      const barColor = primaryToolColor
                        ?? (r.pct > 50 ? OS.green : r.pct > 20 ? OS.warning : dk(darkMode, "rgba(255,255,255,0.15)", OS.faint));
                      const lowConfidence = r.total < 5;
                      const toolTotal = r.toolCounts.reduce((s, [, c]) => s + c, 0);
                      const toolTip = r.toolCounts.length > 0
                        ? r.toolCounts.map(([t, c]) => `${t}: ${c} PR${c !== 1 ? "s" : ""} (${Math.round((c / toolTotal) * 100)}%)`).join("\n")
                        : undefined;
                      return (
                        <div key={r.author} style={{ display: "grid", gridTemplateColumns: "140px 1fr 52px 52px", gap: 6, alignItems: "center", padding: "4px 0" }}>
                          <span style={{
                            fontSize: 12,
                            color: dk(darkMode, "rgba(255,255,255,0.8)", OS.text),
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            display: "flex", alignItems: "center", gap: 6,
                          }} title={r.author}>
                            {/* Tool color dot */}
                            {primaryToolColor && (
                              <span title={toolTip} style={{
                                width: 7, height: 7, borderRadius: 999,
                                background: primaryToolColor, flexShrink: 0,
                              }} />
                            )}
                            {r.author}
                          </span>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ flex: 1, height: 14, background: dk(darkMode, "rgba(255,255,255,0.06)", OS.border), borderRadius: 3, overflow: "hidden" }}
                              title={toolTip}
                            >
                              {/* Stacked tool segments inside the AI% bar */}
                              {r.toolCounts.length > 1 ? (
                                <div style={{ display: "flex", height: "100%", width: `${r.pct}%`, minWidth: r.ai > 0 ? 2 : 0, borderRadius: 3, overflow: "hidden" }}>
                                  {r.toolCounts.map(([tool, count]) => {
                                    return (
                                      <div key={tool} style={{
                                        flex: count,
                                        height: "100%",
                                        background: toolColors[tool.toLowerCase()] ?? barColor,
                                      }} />
                                    );
                                  })}
                                </div>
                              ) : (
                                <div style={{ width: `${r.pct}%`, height: "100%", borderRadius: 3, minWidth: r.ai > 0 ? 2 : 0, background: barColor }} />
                              )}
                            </div>
                            <span style={{ fontSize: 12, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), minWidth: 32, textAlign: "right", opacity: lowConfidence ? 0.6 : 1 }}>
                              {r.pct}%{lowConfidence ? "*" : ""}
                            </span>
                          </div>
                          <span style={{ fontSize: 12, fontFamily: OS.mono, textAlign: "right" }}>
                            <span style={{ fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text) }}>{r.ai}</span>
                            <span style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted) }}>/{r.total}</span>
                          </span>
                          <span style={{ fontSize: 12, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), textAlign: "right" }}>
                            {r.avgCycleHours != null ? fmtDays(r.avgCycleHours) : "—"}
                          </span>
                        </div>
                      );
                    })}
                    {/* Show more / less toggle */}
                    {sortedActiveAuthors.length > 8 && (
                      <div
                        onClick={() => setShowAllAuthors((v) => !v)}
                        style={{ fontSize: 11, color: OS.blue, marginTop: 6, cursor: "pointer", userSelect: "none" }}
                      >
                        {showAllAuthors ? "Show less ▴" : `Show all ${sortedActiveAuthors.length} authors ▾`}
                      </div>
                    )}
                    {/* Zero adoption toggle */}
                    {zeroAdoptionCount > 0 && (
                      <div
                        onClick={() => setShowZeroAuthors(!showZeroAuthors)}
                        style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), marginTop: 6, cursor: "pointer", userSelect: "none", borderTop: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`, paddingTop: 6 }}
                      >
                        {showZeroAuthors ? "Hide" : "Show"} {zeroAdoptionCount} author{zeroAdoptionCount !== 1 ? "s" : ""} with 0% AI usage {showZeroAuthors ? "▴" : "▾"}
                      </div>
                    )}
                    {showZeroAuthors && authorAIRows.filter(r => r.ai === 0).map((r) => (
                      <div key={r.author} style={{ display: "grid", gridTemplateColumns: "140px 1fr 52px 52px", gap: 6, alignItems: "center", padding: "3px 0", opacity: 0.5 }}>
                        <span style={{
                          fontSize: 12,
                          color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }} title={r.author}>{r.author}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ flex: 1, height: 14, background: dk(darkMode, "rgba(255,255,255,0.04)", OS.border), borderRadius: 3 }} />
                          <span style={{ fontSize: 12, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), minWidth: 32, textAlign: "right" }}>0%</span>
                        </div>
                        <span style={{ fontSize: 12, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), textAlign: "right" }}>
                          0<span style={{ fontSize: 10, opacity: 0.5 }}>/{r.total}</span>
                        </span>
                        <span style={{ fontSize: 12, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), textAlign: "right" }}>
                          {r.avgCycleHours != null ? fmtDays(r.avgCycleHours) : "—"}
                        </span>
                      </div>
                    ))}
                    {/* Low confidence footnote */}
                    {activeAuthorRows.some(r => r.total < 5) && (
                      <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginTop: 6 }}>
                        * Under 5 PRs — percentage may not be representative
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ─── AI Reviews section — hidden when 0% ─── */}
              {aiReviewStats.pct > 0 && (
                <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text) }}>AI Reviews</div>
                    <span style={{ fontSize: 20, fontWeight: 700, fontFamily: OS.mono, color: dk(darkMode, "#fff", OS.text) }}>
                      {aiReviewStats.pct}%
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), marginBottom: 12 }}>
                    {aiReviewStats.reviewedByAI} of {metrics.length} PRs reviewed by AI tools ({timeRange}d)
                  </div>
                  {aiReviewStats.toolEntries.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {aiReviewStats.toolEntries.map(([tool, count]) => {
                        const maxCount = aiReviewStats.toolEntries[0][1];
                        const reviewColors: Record<string, string> = {
                          coderabbit: "#0891B2",
                          copilot: "#2EA043",
                          "amazon-q": "#FF9900",
                          cursor: "#7C3AED",
                          devin: "#EC4899",
                          tabnine: "#4B83CD",
                          sonarcloud: "#F97316",
                          codeclimate: "#10B981",
                          windsurf: "#06B6D4",
                        };
                        return (
                          <div key={tool} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary), width: 100, flexShrink: 0, textTransform: "capitalize" }}>{tool}</span>
                            <div style={{ flex: 1, height: 14, borderRadius: 3, background: dk(darkMode, "rgba(255,255,255,0.06)", OS.border), overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${Math.round((count / maxCount) * 100)}%`, background: reviewColors[tool.toLowerCase()] ?? dk(darkMode, "rgba(255,255,255,0.2)", OS.faint), borderRadius: 3, minWidth: 2 }} />
                            </div>
                            <span style={{ fontSize: 12, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), minWidth: 36, textAlign: "right" }}>
                              {count} <span style={{ fontSize: 10, opacity: 0.5 }}>PRs</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ─── AI Reviews Tab ─── */}
          {activeTab === "AI Reviews" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {reviewTabStats.totalComments === 0 ? (
                <div style={{ padding: "40px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 14, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.secondary), marginBottom: 4 }}>
                    No AI review comments found
                  </div>
                  <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted) }}>
                    Trigger a GitHub sync to populate review data. AI review bots (CodeRabbit, Cursor, Copilot, Claude) are detected automatically.
                  </div>
                </div>
              ) : (
                <>
                  {/* KPI cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                    {/* Card 1 — AI-Reviewed PRs */}
                    <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg, textAlign: "center" }}>
                      <div style={{ fontSize: 28, fontWeight: 700, color: dk(darkMode, "#fff", OS.text), fontFamily: OS.mono }}>
                        {reviewTabStats.reviewedPRCount}
                      </div>
                      <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), marginTop: 2 }}>
                        AI-Reviewed PRs
                      </div>
                      <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginTop: 4 }}>
                        {metrics.length > 0 ? Math.round((reviewTabStats.reviewedPRCount / metrics.length) * 100) : 0}% of {metrics.length} PRs
                      </div>
                    </div>

                    {/* Card 2 — Issues Found */}
                    <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg, textAlign: "center" }}>
                      <div style={{ fontSize: 28, fontWeight: 700, color: dk(darkMode, "#fff", OS.text), fontFamily: OS.mono }}>
                        {reviewTabStats.totalComments}
                      </div>
                      <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), marginTop: 2 }}>
                        Issues Found
                      </div>
                      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 6 }}>
                        {reviewTabStats.bySeverity.map(([sev, count]) => (
                          <span key={sev} style={{
                            fontSize: 10, fontFamily: OS.mono, padding: "1px 6px", borderRadius: 4,
                            background: sev === "high" ? `${OS.red}20` : sev === "medium" ? `${OS.warning}20` : dk(darkMode, "rgba(255,255,255,0.06)", OS.bg),
                            color: sev === "high" ? OS.red : sev === "medium" ? OS.warning : dk(darkMode, "rgba(255,255,255,0.5)", OS.muted),
                          }}>
                            {count} {sev}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Card 3 — Tool breakdown */}
                    <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.8)", OS.secondary), marginBottom: 8, textAlign: "center" }}>
                        Review Tools
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {reviewTabStats.byTool.map(([tool, count]) => (
                          <div key={tool} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontSize: 12, color: toolColors[tool] ?? dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary), textTransform: "capitalize", fontWeight: 500 }}>{tool}</span>
                            <span style={{ fontSize: 11, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted) }}>
                              {count} <span style={{ opacity: 0.6 }}>issues</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Issues by Category — horizontal bars */}
                  <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text), marginBottom: 2 }}>Issues by Category</div>
                    <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), marginBottom: 12 }}>
                      What AI reviewers are catching ({timeRange}d)
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {reviewTabStats.byCategory.map(([cat, count]) => {
                        const maxCount = reviewTabStats.byCategory[0]?.[1] ?? 1;
                        return (
                          <div key={cat} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ width: 80, fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary), textAlign: "right", flexShrink: 0, textTransform: "capitalize" }}>{cat}</span>
                            <div style={{ flex: 1, height: 16, background: dk(darkMode, "rgba(255,255,255,0.06)", OS.border), borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ width: `${Math.round((count / maxCount) * 100)}%`, height: "100%", borderRadius: 3, minWidth: 2, background: categoryColors[cat] ?? OS.faint }} />
                            </div>
                            <span style={{ width: 36, fontSize: 12, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), textAlign: "right" }}>{count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Weekly Trend */}
                  {reviewTabStats.weeklyTrend.length > 1 && (
                    <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text), marginBottom: 2 }}>Weekly Trend</div>
                      <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), marginBottom: 12 }}>
                        AI review issues per week
                      </div>
                      {/* Simple bar chart for weekly trend */}
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 80 }}>
                        {reviewTabStats.weeklyTrend.map(({ label, count }) => {
                          const maxW = Math.max(...reviewTabStats.weeklyTrend.map((w) => w.count), 1);
                          const pct = Math.max(4, Math.round((count / maxW) * 100));
                          return (
                            <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                              <span style={{ fontSize: 9, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted) }}>{count}</span>
                              <div style={{ width: "100%", height: `${pct}%`, background: OS.blue, borderRadius: 2, minHeight: 2 }}
                                title={`Week of ${label}: ${count} issues`} />
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                        <span style={{ fontSize: 9, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted) }}>{reviewTabStats.weeklyTrend[0]?.label}</span>
                        <span style={{ fontSize: 9, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted) }}>{reviewTabStats.weeklyTrend[reviewTabStats.weeklyTrend.length - 1]?.label}</span>
                      </div>
                    </div>
                  )}

                  {/* By Team + By Repo side by side */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {/* By Team chips */}
                    <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text), marginBottom: 8 }}>By Team</div>
                      {reviewTabStats.byTeam.length === 0 ? (
                        <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted) }}>No team data (link PRs to Jira)</div>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {reviewTabStats.byTeam.map(([team, count]) => (
                            <div key={team} style={{
                              padding: "8px 12px", borderRadius: 8,
                              border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
                              background: dk(darkMode, "rgba(255,255,255,0.03)", OS.bg),
                            }}>
                              <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), marginBottom: 2 }} title={team}>{team}</div>
                              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: OS.mono, color: dk(darkMode, "#fff", OS.text) }}>{count}</div>
                              <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted) }}>issues</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {reviewTabStats.unlinkedCount > 0 && (
                        <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginTop: 8 }}>
                          {reviewTabStats.unlinkedCount} issues on PRs not linked to Jira
                        </div>
                      )}
                    </div>

                    {/* By Repo chips */}
                    <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text), marginBottom: 8 }}>By Repo</div>
                      {reviewTabStats.byRepo.length === 0 ? (
                        <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted) }}>No data</div>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {reviewTabStats.byRepo.map(([repo, count]) => {
                            const shortName = repo.split("/").pop() ?? repo;
                            return (
                              <div key={repo} style={{
                                padding: "8px 12px", borderRadius: 8,
                                border: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`,
                                background: dk(darkMode, "rgba(255,255,255,0.03)", OS.bg),
                              }}>
                                <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary), marginBottom: 2 }} title={repo}>{shortName}</div>
                                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: OS.mono, color: dk(darkMode, "#fff", OS.text) }}>{count}</div>
                                <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted) }}>issues</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* By Author table */}
                  <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text), marginBottom: 2 }}>By Author</div>
                    <div style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), marginBottom: 10 }}>
                      Who is receiving the most AI review feedback ({timeRange}d)
                    </div>
                    {/* Header */}
                    <div style={{ display: "grid", gridTemplateColumns: "130px 1fr 60px 80px", gap: 6, marginBottom: 6, padding: "0 0 4px 0", borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}` }}>
                      <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), textTransform: "uppercase", letterSpacing: "0.05em" }}>Author</div>
                      <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), textTransform: "uppercase", letterSpacing: "0.05em" }}>Severity</div>
                      <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right" }}>Issues</div>
                      <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right" }}>Top Category</div>
                    </div>
                    {reviewTabStats.authorRows.slice(0, 10).map((row) => {
                      const high = row.byCategory["bug"] ?? 0 + (row.byCategory["security"] ?? 0);
                      return (
                        <div key={row.author} style={{ display: "grid", gridTemplateColumns: "130px 1fr 60px 80px", gap: 6, alignItems: "center", padding: "4px 0" }}>
                          <span style={{ fontSize: 12, color: dk(darkMode, "rgba(255,255,255,0.8)", OS.text), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.author}>
                            {row.author}
                          </span>
                          {/* Severity distribution mini bar */}
                          <div style={{ display: "flex", height: 10, borderRadius: 3, overflow: "hidden", background: dk(darkMode, "rgba(255,255,255,0.04)", OS.border) }}
                            title={Object.entries(row.byCategory).map(([c, n]) => `${c}: ${n}`).join(", ")}
                          >
                            {Object.entries(row.byCategory).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
                              <div key={cat} style={{
                                flex: count,
                                height: "100%",
                                background: categoryColors[cat] ?? dk(darkMode, "rgba(255,255,255,0.15)", OS.faint),
                              }} />
                            ))}
                          </div>
                          <span style={{ fontSize: 12, fontFamily: OS.mono, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text), textAlign: "right" }}>
                            {row.total}
                          </span>
                          <span style={{ fontSize: 11, color: categoryColors[row.topCategory] ?? dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), textAlign: "right", textTransform: "capitalize" }}>
                            {row.topCategory}
                          </span>
                        </div>
                      );
                    })}
                    {reviewTabStats.authorRows.length > 10 && (
                      <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), marginTop: 6 }}>
                        +{reviewTabStats.authorRows.length - 10} more authors
                      </div>
                    )}
                  </div>

                  {/* Category legend */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "0 4px" }}>
                    {Object.entries(categoryColors).map(([cat, color]) => (
                      <div key={cat} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.secondary), textTransform: "capitalize" }}>{cat}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ─── Teams View ─── */}
          {activeTab === "Teams" && !noData && (
            <div style={{ padding: 0, borderRadius: 10, border: cardBorder, background: cardBg, overflow: "hidden" }}>
              {/* Table header */}
              <div style={{
                display: "grid",
                gridTemplateColumns: `180px ${config.teamColumns.includes("prs") ? "60px " : ""}${config.teamColumns.includes("cycle") ? "80px " : ""}${config.teamColumns.includes("medReview") ? "90px " : ""}${config.teamColumns.includes("avgLines") ? "80px " : ""}${config.teamColumns.includes("ai") ? "60px " : ""}${config.teamColumns.includes("trend") ? "90px" : ""}`,
                padding: "10px 16px",
                borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}`,
              }}>
                <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), textTransform: "uppercase", fontFamily: OS.mono }}>Team</div>
                {([
                  { col: "prs", l: "PRs" }, { col: "cycle", l: "Cycle" },
                  { col: "medReview", l: "Med Review" }, { col: "avgLines", l: "Δ Lines" },
                  { col: "ai", l: "AI %" },
                ] as { col: TeamColumnId; l: string }[])
                  .filter((c) => config.teamColumns.includes(c.col))
                  .map((c) => (
                    <div key={c.col} onClick={() => handleTeamSort(c.col)} style={{
                      textAlign: "right", cursor: "pointer", userSelect: "none",
                      fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted),
                      textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: OS.mono,
                    }}>
                      {c.l} {teamSortCol === c.col ? (teamSortDir > 0 ? "↑" : "↓") : ""}
                    </div>
                  ))}
                {config.teamColumns.includes("trend") && (
                  <div style={{ textAlign: "right", fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), textTransform: "uppercase", fontFamily: OS.mono }}>Trend</div>
                )}
              </div>
              {/* Rows */}
              {sortedTeamRows.map((row) => {
                const isGhost = row.team === "No Component" || row.team === "Unlinked";
                const flagCycle = row.avgCycleHours != null && row.avgCycleHours > 240;
                const flagReview = row.medReviewHours != null && row.medReviewHours >= 1;
                const trend = teamWeeklyCycles.get(row.team) ?? [];
                const sizeDist = teamSizeDist.get(row.team) ?? { s: 0, m: 0, l: 0 };
                const sizeTotal = sizeDist.s + sizeDist.m + sizeDist.l || 1;
                const isExpanded = expandedTeam === row.team;
                const numStyle: React.CSSProperties = { fontFamily: OS.mono, fontVariantNumeric: "tabular-nums" };
                const cellMono = (flag?: boolean): React.CSSProperties => ({
                  textAlign: "right", fontSize: 12, fontFamily: OS.mono,
                  color: flag ? OS.red : dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary),
                });

                return (
                  <div key={row.team}>
                    <div
                      onClick={() => setExpandedTeam(isExpanded ? null : row.team)}
                      onMouseEnter={() => setHoveredTeam(row.team)}
                      onMouseLeave={() => setHoveredTeam(null)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: `180px ${config.teamColumns.includes("prs") ? "60px " : ""}${config.teamColumns.includes("cycle") ? "80px " : ""}${config.teamColumns.includes("medReview") ? "90px " : ""}${config.teamColumns.includes("avgLines") ? "80px " : ""}${config.teamColumns.includes("ai") ? "60px " : ""}${config.teamColumns.includes("trend") ? "90px" : ""}`,
                        padding: "10px 16px", cursor: "pointer",
                        borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.03)", "rgba(0,0,0,0.04)")}`,
                        background: isExpanded
                          ? dk(darkMode, "rgba(255,255,255,0.03)", "rgba(0,0,0,0.02)")
                          : hoveredTeam === row.team
                            ? dk(darkMode, "rgba(255,255,255,0.02)", "rgba(0,0,0,0.015)")
                            : "transparent",
                        opacity: isGhost ? 0.55 : 1,
                        transition: "background 0.1s",
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, color: dk(darkMode, "rgba(255,255,255,0.85)", OS.text) }}>
                        <span style={{ display: "inline-block", fontSize: 8, opacity: 0.3, transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.1s" }}>▶</span>
                        {row.team}
                        {row.team === "No Component" && (
                          <span style={{ fontSize: 9, opacity: 0.3, background: dk(darkMode, "rgba(255,255,255,0.06)", OS.bg), padding: "1px 5px", borderRadius: 3 }}>untagged</span>
                        )}
                      </div>
                      {config.teamColumns.includes("prs") && <div style={cellMono()}>{row.prCount}</div>}
                      {config.teamColumns.includes("cycle") && <div style={cellMono(flagCycle)}>{fmtHours(row.avgCycleHours)}</div>}
                      {config.teamColumns.includes("medReview") && <div style={cellMono(flagReview)}>{fmtHours(row.medReviewHours)}</div>}
                      {config.teamColumns.includes("avgLines") && <div style={cellMono()}>{row.avgSize > 0 ? `±${row.avgSize}` : "—"}</div>}
                      {config.teamColumns.includes("ai") && (
                        <div style={{ ...cellMono(), color: row.aiPctTeam > 30 ? OS.green : row.aiPctTeam > 15 ? OS.warning : undefined, opacity: row.aiPctTeam > 0 ? 0.9 : 0.3 }}>
                          {row.aiPctTeam}%
                        </div>
                      )}
                      {config.teamColumns.includes("trend") && (
                        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
                          {trend.length >= 2 && <Sparkline data={trend} width={80} height={18} color={flagCycle ? OS.red : OS.blue} />}
                        </div>
                      )}
                    </div>
                    {/* Expanded detail */}
                    {isExpanded && (
                      <div style={{ padding: "12px 16px", borderTop: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}` }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                          <div>
                            <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, fontFamily: OS.mono }}>Cycle trend (6w)</div>
                            {trend.length >= 2 ? (
                              <Sparkline data={trend} width={140} height={36} color={flagCycle ? OS.red : OS.blue} />
                            ) : (
                              <span style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted) }}>No data</span>
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, fontFamily: OS.mono }}>PR size mix</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ display: "flex", height: 8, flex: 1, borderRadius: 4, overflow: "hidden" }}>
                                <div style={{ width: `${(sizeDist.s / sizeTotal) * 100}%`, background: OS.green }} />
                                <div style={{ width: `${(sizeDist.m / sizeTotal) * 100}%`, background: OS.warning }} />
                                <div style={{ width: `${(sizeDist.l / sizeTotal) * 100}%`, background: OS.red }} />
                              </div>
                              <span style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), fontFamily: OS.mono, whiteSpace: "nowrap" }}>
                                {sizeDist.s}/{sizeDist.m}/{sizeDist.l}
                              </span>
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.4)", OS.muted), textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, fontFamily: OS.mono }}>Flags</div>
                            <div style={{ fontSize: 11, lineHeight: 1.6, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary) }}>
                              {flagCycle && <div style={{ color: OS.red }}>⚠ Cycle time 2x+ org avg</div>}
                              {flagReview && <div style={{ color: OS.warning }}>⚠ Review time in hours</div>}
                              {!flagCycle && !flagReview && <div style={{ opacity: 0.3 }}>No flags</div>}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ─── Copilot Section (only if org configured) ─── */}
          {githubOrg && latestCopilot && (
            <div
              style={{
                padding: "14px 16px",
                borderRadius: 10,
                border: cardBorder,
                background: cardBg,
              }}
            >
              <h3 style={sectionTitle}>
                Copilot —{" "}
                <span style={{ fontWeight: 400, fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted) }}>
                  {latestCopilot.date}
                </span>
              </h3>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <KPICard label="Active Users" value={String(latestCopilot.totalActiveUsers)} dark={darkMode} />
                <KPICard label="Engaged Users" value={String(latestCopilot.totalEngagedUsers)} dark={darkMode} />
                <KPICard label="Chat Messages" value={String(latestCopilot.totalChats)} dark={darkMode} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

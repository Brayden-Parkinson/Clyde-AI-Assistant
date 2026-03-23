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
import type { PRMetric, JiraTicket, PRJiraLink } from "@shared/types";

// ─── Sub-tab types ───
type EngStatsTab = "Summary" | "Cycle Time" | "AI Adoption" | "Teams";
const ENG_STATS_TABS: EngStatsTab[] = ["Summary", "Cycle Time", "AI Adoption", "Teams"];

// ─── Customization config (persisted to chrome.storage.local) ───
type SectionId = "kpis" | "cycleTime" | "aiAdoption" | "prSize" | "toolUsage";
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
  visibleSections: ["kpis", "cycleTime", "aiAdoption", "prSize", "toolUsage"],
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

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");
  const areaD = `${pathD} L ${points[points.length - 1].x} ${PAD.top + chartH} L ${points[0].x} ${PAD.top + chartH} Z`;

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

      {/* Data points */}
      {points.map((p, i) => {
        const hasAnno = annotations?.[p.label];
        return (
          <circle key={i} cx={p.x} cy={p.y} r={hover === i ? 4 : hasAnno ? 3.5 : 2.5}
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
          <rect x={points[hover].x - 26} y={points[hover].y - 22} width={52} height={18} rx={3}
            fill={dk(dark, "rgba(0,0,0,0.85)", "rgba(0,0,0,0.75)")} stroke={dk(dark, "rgba(255,255,255,0.1)", "rgba(0,0,0,0.2)")} />
          <text x={points[hover].x} y={points[hover].y - 10} textAnchor="middle"
            fill="#e2e8f0" fontSize={10} fontFamily={OS.mono}>{points[hover].pct}%</text>
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
  const aiPRs = metrics.filter((m) => m.aiAssisted).length;
  const aiPct = metrics.length
    ? Math.round((aiPRs / metrics.length) * 100)
    : 0;

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

  // ─── Tool display entries (rename "ai" → "Unclassified") ───
  const toolColors: Record<string, string> = {
    claude: "#D97706",
    copilot: "#2EA043",
    cursor: "#7C3AED",
    coderabbit: "#0891B2",
  };

  const displayToolEntries: [string, number][] = useMemo(() => {
    return toolEntries.map(
      ([tool, count]) =>
        [
          tool.toLowerCase() === "ai" ? "AI (unknown tool)" : tool,
          count,
        ] as [string, number],
    );
  }, [toolEntries]);

  // ─── Per-author AI adoption ───
  const authorAIRows = useMemo(() => {
    const authorStats = new Map<string, { total: number; ai: number; tools: Set<string>; cycleTimes: number[]; sizes: number[] }>();
    for (const m of metrics) {
      if (!m.author) continue; // skip PRs without author data
      if (!authorStats.has(m.author)) authorStats.set(m.author, { total: 0, ai: 0, tools: new Set(), cycleTimes: [], sizes: [] });
      const s = authorStats.get(m.author)!;
      s.total++;
      if (m.cycleTimeHours != null) s.cycleTimes.push(m.cycleTimeHours);
      s.sizes.push(m.additions + m.deletions);
      if (m.aiAssisted) {
        s.ai++;
        for (const t of m.aiTools) s.tools.add(t);
      }
    }
    return [...authorStats.entries()]
      .map(([author, s]) => {
        const avgCycle = s.cycleTimes.length > 0
          ? s.cycleTimes.reduce((a, b) => a + b, 0) / s.cycleTimes.length
          : null;
        const avgSize = s.sizes.length > 0
          ? Math.round(s.sizes.reduce((a, b) => a + b, 0) / s.sizes.length)
          : 0;
        return {
          author,
          total: s.total,
          ai: s.ai,
          pct: s.total > 0 ? Math.round((s.ai / s.total) * 100) : 0,
          tools: [...s.tools].sort(),
          avgCycleHours: avgCycle,
          avgSize,
        };
      })
      .filter(r => r.total >= 2)
      .sort((a, b) => b.pct - a.pct || b.ai - a.ai);
  }, [metrics]);

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
    for (const m of source) {
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
        ? Math.round(
            (prs.filter((p) => p.aiAssisted).length / prs.length) * 100,
          )
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
        const ghResult = await new Promise<{
          synced?: number;
          total?: number;
          errors?: string[];
          error?: string;
        }>((resolve) => {
          ghSyncResolveRef.current = resolve;
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
            <>
              <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.8)", OS.secondary), marginBottom: 2 }}>
                  AI-Assisted PR % by Week
                </div>
                <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginBottom: 12 }}>
                  {aiSubtitle}
                </div>
                {weeklyAI.length >= 2 && (
                  <AIAdoptionChart weeklyPcts={weeklyAI} dark={darkMode} fullWidth height={220} />
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary), marginBottom: 10 }}>By Tool ({timeRange}d)</div>
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
                <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary), marginBottom: 10 }}>By Team ({timeRange}d)</div>
                  {(() => {
                    const rows = teamRows
                      .map((r) => ({ team: r.team, aiCount: Math.round(r.prCount * r.aiPctTeam / 100), total: r.prCount, pct: r.aiPctTeam }))
                      .filter((r) => r.aiCount > 0)
                      .sort((a, b) => b.aiCount - a.aiCount);
                    return rows.length === 0 ? (
                      <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted) }}>No AI-assisted PRs</div>
                    ) : rows.map((r) => (
                      <div key={r.team} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ width: 120, fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), textAlign: "right", fontFamily: OS.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>{r.team}</span>
                        <div style={{ flex: 1, height: 12, background: dk(darkMode, "rgba(255,255,255,0.04)", OS.border), borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ width: `${r.pct}%`, height: "100%", borderRadius: 3, minWidth: 2, background: r.pct > 30 ? OS.green : r.pct > 15 ? OS.warning : dk(darkMode, "rgba(255,255,255,0.15)", OS.faint) }} />
                        </div>
                        <span style={{ width: 56, fontSize: 11, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), textAlign: "right", whiteSpace: "nowrap" }}>
                          {r.aiCount}
                          <span style={{ fontSize: 9, opacity: 0.4 }}> / {r.total}</span>
                        </span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
              {/* Per-author AI adoption */}
              <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: dk(darkMode, "rgba(255,255,255,0.7)", OS.secondary), marginBottom: 2 }}>By Author ({timeRange}d)</div>
                <div style={{ fontSize: 10, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), marginBottom: 10 }}>
                  AI adoption rate per contributor
                </div>
                {authorBackfillPending ? (
                  <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), padding: "8px 0" }}>
                    Author data syncing — reload extension or trigger a GitHub sync to populate.
                  </div>
                ) : authorAIRows.length === 0 ? (
                  <div style={{ fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted) }}>No authors with 2+ PRs in this period</div>
                ) : (
                  <>
                    {/* Table header */}
                    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 52px 52px 70px", gap: 6, marginBottom: 6, padding: "0 0 4px 0", borderBottom: `1px solid ${dk(darkMode, "rgba(255,255,255,0.06)", OS.border)}` }}>
                      <div style={{ fontSize: 9, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted), textTransform: "uppercase", fontFamily: OS.mono, letterSpacing: "0.05em" }}>Author</div>
                      <div style={{ fontSize: 9, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted), textTransform: "uppercase", fontFamily: OS.mono, letterSpacing: "0.05em" }}>AI %</div>
                      <div style={{ fontSize: 9, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted), textTransform: "uppercase", fontFamily: OS.mono, letterSpacing: "0.05em", textAlign: "right" }}>PRs</div>
                      <div style={{ fontSize: 9, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted), textTransform: "uppercase", fontFamily: OS.mono, letterSpacing: "0.05em", textAlign: "right" }}>Cycle</div>
                      <div style={{ fontSize: 9, color: dk(darkMode, "rgba(255,255,255,0.3)", OS.muted), textTransform: "uppercase", fontFamily: OS.mono, letterSpacing: "0.05em", textAlign: "right" }}>Tools</div>
                    </div>
                    {/* Rows */}
                    {authorAIRows.slice(0, 20).map((r) => {
                      const barColor = r.pct > 50 ? OS.green : r.pct > 20 ? OS.warning : dk(darkMode, "rgba(255,255,255,0.15)", OS.faint);
                      return (
                        <div key={r.author} style={{ display: "grid", gridTemplateColumns: "110px 1fr 52px 52px 70px", gap: 6, alignItems: "center", padding: "3px 0" }}>
                          <span style={{
                            fontSize: 11, fontFamily: OS.mono,
                            color: dk(darkMode, "rgba(255,255,255,0.7)", OS.text),
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }} title={r.author}>{r.author}</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ flex: 1, height: 12, background: dk(darkMode, "rgba(255,255,255,0.04)", OS.border), borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ width: `${r.pct}%`, height: "100%", borderRadius: 3, minWidth: r.ai > 0 ? 2 : 0, background: barColor }} />
                            </div>
                            <span style={{ fontSize: 11, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), minWidth: 28, textAlign: "right" }}>
                              {r.pct}%
                            </span>
                          </div>
                          <span style={{ fontSize: 11, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), textAlign: "right" }}>
                            {r.ai}<span style={{ fontSize: 9, opacity: 0.4 }}>/{r.total}</span>
                          </span>
                          <span style={{ fontSize: 11, fontFamily: OS.mono, color: dk(darkMode, "rgba(255,255,255,0.5)", OS.muted), textAlign: "right" }}>
                            {r.avgCycleHours != null ? fmtHours(r.avgCycleHours) : "—"}
                          </span>
                          <span style={{
                            fontSize: 9, fontFamily: OS.mono,
                            color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted),
                            textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }} title={r.tools.join(", ")}>
                            {r.tools.length > 0 ? r.tools.join(", ") : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </>
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

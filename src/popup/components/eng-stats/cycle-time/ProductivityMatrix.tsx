import React, { useMemo } from "react";
import { OS } from "@shared/tokens";
import { dk, computeProductivityMatrix, type PersonRow } from "../shared";
import { ProductivityMatrixChart, InfoTip } from "../charts";

interface ProductivityMatrixProps {
  darkMode: boolean;
  personRows: PersonRow[];
}

export function ProductivityMatrixSection({ darkMode, personRows }: ProductivityMatrixProps) {
  const points = useMemo(() => computeProductivityMatrix(personRows), [personRows]);
  const cardBg = dk(darkMode, "#1c1c22", OS.white);
  const cardBorder = `1px solid ${dk(darkMode, "rgba(255,255,255,0.08)", OS.border)}`;

  return (
    <>
      <div style={{
        fontSize: 12, fontWeight: 600,
        color: dk(darkMode, "rgba(255,255,255,0.6)", OS.secondary),
        marginTop: 4,
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          Productivity Matrix
          <InfoTip dark={darkMode} text="Each bubble is a developer. X-axis: PR throughput (PRs/week). Y-axis: efficiency (faster cycle time = higher). Bubble size = code volume. Color = AI adoption % (gray→blue)." />
        </span>
      </div>

      {points.length < 3 ? (
        <div style={{
          padding: "20px 16px", borderRadius: 10, border: cardBorder, background: cardBg,
          fontSize: 11, color: dk(darkMode, "rgba(255,255,255,0.35)", OS.muted), textAlign: "center",
        }}>
          Need 3+ contributors with cycle time data for the productivity matrix
        </div>
      ) : (
        <div style={{ padding: "14px 16px", borderRadius: 10, border: cardBorder, background: cardBg }}>
          <ProductivityMatrixChart points={points} dark={darkMode} height={280} />
        </div>
      )}
    </>
  );
}

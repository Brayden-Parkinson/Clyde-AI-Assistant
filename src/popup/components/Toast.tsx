import React, { useEffect } from "react";
import { OS } from "@shared/tokens";

export type ToastVariant = "success" | "error" | "warning" | "info";

interface ToastProps {
  message: string;
  variant?: ToastVariant;
  onClose: () => void;
}

const VARIANT_STYLES: Record<ToastVariant, { background: string; color: string }> = {
  success: { background: "#16a34a", color: OS.white },
  error: { background: "#dc2626", color: OS.white },
  warning: { background: "#d97706", color: OS.white },
  info: { background: OS.text, color: OS.white },
};

export function Toast({ message, variant = "info", onClose }: ToastProps) {
  useEffect(() => {
    const duration = variant === "error" ? 5000 : 2800;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, variant]);

  const styles = VARIANT_STYLES[variant];

  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        background: styles.background,
        color: styles.color,
        borderRadius: 8,
        padding: "8px 16px",
        fontSize: 13,
        fontWeight: 500,
        fontFamily: OS.font,
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        animation: "toastIn 0.3s ease",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        gap: 8,
        maxWidth: 360,
      }}
    >
      {message}
    </div>
  );
}

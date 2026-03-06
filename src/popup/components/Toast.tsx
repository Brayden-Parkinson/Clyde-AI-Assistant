import React, { useEffect, useState, useCallback, useRef } from "react";
import { OS } from "@shared/tokens";
import { IconCheck, IconX, IconWarning, IconInfo } from "./Icons";

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

// ─── Single toast ───

interface ToastCardProps {
  item: ToastItem;
  onDismiss: (id: number) => void;
}

function ToastCard({ item, onDismiss }: ToastCardProps) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    setTimeout(() => onDismiss(item.id), 250);
  }, [exiting, item.id, onDismiss]);

  useEffect(() => {
    const duration = item.variant === "error" ? 6000 : 3000;
    timerRef.current = setTimeout(dismiss, duration);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [dismiss, item.variant]);

  const icons: Record<ToastVariant, React.ReactNode> = {
    success: <IconCheck size={14} />,
    error: <IconX size={14} />,
    warning: <IconWarning size={14} />,
    info: <IconInfo size={14} />,
  };

  const colors: Record<ToastVariant, string> = {
    success: OS.green,
    error: OS.red,
    warning: "#b08d33",
    info: OS.secondary,
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        background: OS.white,
        border: `1px solid ${OS.border}`,
        borderLeft: `3px solid ${colors[item.variant]}`,
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06)",
        fontSize: 13,
        fontFamily: OS.font,
        color: OS.text,
        maxWidth: 340,
        minWidth: 200,
        animation: exiting ? "toastOut 0.25s ease forwards" : "toastIn 0.25s ease",
        pointerEvents: "auto",
      }}
    >
      <span style={{ color: colors[item.variant], flexShrink: 0, display: "inline-flex", alignItems: "center" }}>
        {icons[item.variant]}
      </span>
      <span style={{ flex: 1, lineHeight: 1.4, fontWeight: 500 }}>{item.message}</span>
      <button
        onClick={dismiss}
        style={{
          background: "none",
          border: "none",
          color: OS.faint,
          fontSize: 14,
          cursor: "pointer",
          padding: "0 2px",
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        <IconX size={12} />
      </button>
    </div>
  );
}

// ─── Toast container (stacks multiple) ───

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(40px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes toastOut {
          from { opacity: 1; transform: translateX(0); }
          to { opacity: 0; transform: translateX(40px); }
        }
      `}</style>
      <div
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 9999,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <ToastCard key={t.id} item={t} onDismiss={onDismiss} />
        ))}
      </div>
    </>
  );
}

// ─── Hook for easy usage ───

let nextId = 1;

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = nextId++;
    setToasts((prev) => [...prev.slice(-4), { id, message, variant }]); // Keep max 5
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, showToast, dismissToast };
}

// ─── Legacy single-toast API (backwards compat for App.tsx) ───

interface ToastProps {
  message: string;
  variant?: ToastVariant;
  onClose: () => void;
}

export function Toast({ message, variant = "info", onClose }: ToastProps) {
  const [item] = useState<ToastItem>(() => ({ id: nextId++, message, variant }));

  return (
    <ToastContainer
      toasts={[item]}
      onDismiss={onClose}
    />
  );
}

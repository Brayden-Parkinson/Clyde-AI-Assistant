import React, { useEffect } from "react";
import { OS } from "@shared/tokens";

interface ToastProps {
  message: string;
  onClose: () => void;
}

export function Toast({ message, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 2800);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        background: OS.darkBlue,
        color: OS.white,
        borderRadius: 10,
        padding: "12px 20px",
        fontSize: 13,
        fontWeight: 600,
        fontFamily: OS.font,
        boxShadow: "0 8px 32px rgba(22,59,131,0.25)",
        animation: "toastIn 0.3s ease",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      {message}
    </div>
  );
}

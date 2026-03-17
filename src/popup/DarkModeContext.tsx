import React, { createContext, useContext } from "react";

export interface DarkModeState {
  darkMode: boolean;
  toggleDarkMode: () => void;
}

export const DarkModeContext = createContext<DarkModeState>({
  darkMode: false,
  toggleDarkMode: () => {},
});

/** Read darkMode boolean from context. Use inside DarkModeContext.Provider. */
export function useDarkMode(): boolean {
  return useContext(DarkModeContext).darkMode;
}

/** Returns `darkVal` when dark mode is on, `lightVal` otherwise. */
export function dk<T>(darkMode: boolean, darkVal: T, lightVal: T): T {
  return darkMode ? darkVal : lightVal;
}

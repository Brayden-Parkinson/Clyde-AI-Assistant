import { useLiveQuery } from "dexie-react-hooks";
import { db, setSetting } from "@shared/db";

export function useSettings() {
  const settings = useLiveQuery(() => db.settings.toArray(), [], undefined);

  const get = <T extends string | number | boolean>(
    key: string,
    defaultValue: T,
  ): T => {
    if (!settings) return defaultValue;
    const row = settings.find((s) => s.key === key);
    return row ? (row.value as T) : defaultValue;
  };

  return { get, set: setSetting, loading: settings === undefined };
}

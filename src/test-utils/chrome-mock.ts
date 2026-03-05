/**
 * Minimal chrome.* API mock for Vitest.
 * Only stubs what's needed by the tested modules.
 */

const storage: Record<string, unknown> = {};

const chromeStub = {
  storage: {
    local: {
      get: async (keys: string | string[]) => {
        const keyArr = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const k of keyArr) {
          if (k in storage) result[k] = storage[k];
        }
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(storage, items);
      },
      clear: async () => {
        for (const k of Object.keys(storage)) delete storage[k];
      },
    },
    session: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
    onChanged: {
      addListener: () => {},
    },
  },
  runtime: {
    id: "test-extension-id",
    getURL: (path: string) => `chrome-extension://test-extension-id/${path}`,
    sendMessage: async () => ({}),
    openOptionsPage: () => {},
  },
  alarms: {
    create: () => {},
    get: async () => undefined,
    clear: async () => {},
  },
  action: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {},
    onClicked: { addListener: () => {} },
  },
  notifications: {
    create: () => {},
    onClicked: { addListener: () => {} },
  },
  sidePanel: {
    setOptions: async () => {},
    setPanelBehavior: async () => {},
  },
  tabs: {
    create: async () => ({}),
  },
};

// @ts-expect-error — stub for test env
globalThis.chrome = chromeStub;

/**
 * Helper: pre-populate chrome.storage.local for tests.
 */
export function setStorageLocal(items: Record<string, unknown>): void {
  Object.assign(storage, items);
}

/**
 * Helper: clear all storage between tests.
 */
export function clearStorageLocal(): void {
  for (const k of Object.keys(storage)) delete storage[k];
}

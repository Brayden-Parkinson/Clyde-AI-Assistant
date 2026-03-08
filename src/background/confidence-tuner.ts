import { db } from "@shared/db";
import { logStatus } from "@shared/status";
import { DEFAULTS } from "@shared/constants";

const MIN_THRESHOLD = 0.5;
const MAX_THRESHOLD = 0.85;
const TUNE_STEP = 0.05;
const MIN_SAMPLES = 5; // need at least this many actions before tuning

export interface ConfidenceTuneInfo {
  lastChecked: string;
  dismissRate: number; // 0–100 (percentage)
  totalSamples: number;
  dismissed: number;
  positive: number;
}

/**
 * Auto-tune the confidence threshold based on dismiss rate over the last 30 days.
 *
 * Logic:
 * - dismissRate > 50%: Claude is too noisy → raise threshold by 5pp (max 85%)
 * - dismissRate < 20%: Claude is too selective → lower threshold by 5pp (min 50%)
 * - 20–50%: threshold is well calibrated → no change
 *
 * Only runs when `confidenceAutoTune` is enabled in chrome.storage.local.
 * Records tuning results in `confidenceTuneInfo` for display in Options.
 */
export async function runConfidenceTuner(): Promise<void> {
  const result = await chrome.storage.local.get(["confidenceAutoTune", "confidenceThreshold"]);
  if (!result.confidenceAutoTune) return;

  const currentThreshold =
    typeof result.confidenceThreshold === "number" &&
    result.confidenceThreshold >= MIN_THRESHOLD &&
    result.confidenceThreshold <= MAX_THRESHOLD
      ? result.confidenceThreshold
      : DEFAULTS.confidenceThreshold;

  // Pull last 30 days of action_log
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recentActions = await db.action_log.where("createdAt").above(cutoff).toArray();

  const dismissed = recentActions.filter((a) => a.action === "dismissed").length;
  const positive = recentActions.filter((a) =>
    ["done", "actioned", "snoozed"].includes(a.action),
  ).length;
  const total = dismissed + positive;

  const tuneInfo: ConfidenceTuneInfo = {
    lastChecked: new Date().toISOString(),
    dismissRate: total > 0 ? Math.round((dismissed / total) * 100) : 0,
    totalSamples: total,
    dismissed,
    positive,
  };

  if (total < MIN_SAMPLES) {
    await chrome.storage.local.set({ confidenceTuneInfo: tuneInfo });
    await logStatus(
      "info",
      "worker",
      `Confidence tuner: not enough data (${total} actions, need ${MIN_SAMPLES})`,
    );
    return;
  }

  const dismissRate = dismissed / total;
  let newThreshold = currentThreshold;

  if (dismissRate > 0.5 && currentThreshold < MAX_THRESHOLD) {
    newThreshold = Math.min(
      Math.round((currentThreshold + TUNE_STEP) * 100) / 100,
      MAX_THRESHOLD,
    );
  } else if (dismissRate < 0.2 && currentThreshold > MIN_THRESHOLD) {
    newThreshold = Math.max(
      Math.round((currentThreshold - TUNE_STEP) * 100) / 100,
      MIN_THRESHOLD,
    );
  }

  const update: Record<string, unknown> = { confidenceTuneInfo: tuneInfo };
  if (newThreshold !== currentThreshold) {
    update.confidenceThreshold = newThreshold;
  }
  await chrome.storage.local.set(update);

  if (newThreshold !== currentThreshold) {
    await logStatus(
      "success",
      "worker",
      `Confidence auto-tuned: ${Math.round(currentThreshold * 100)}% → ${Math.round(newThreshold * 100)}% (dismiss rate: ${tuneInfo.dismissRate}%, ${total} samples)`,
    );
  } else {
    await logStatus(
      "info",
      "worker",
      `Confidence tuner: threshold unchanged at ${Math.round(currentThreshold * 100)}% (dismiss rate: ${tuneInfo.dismissRate}%, ${total} samples)`,
    );
  }
}

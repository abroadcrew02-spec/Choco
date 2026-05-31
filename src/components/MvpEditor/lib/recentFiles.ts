/**
 * recentFiles.ts
 *
 * Utility for tracking recently opened image files in localStorage.
 *
 * Storage key: "choco:recent-files"
 * Format: JSON array of RecentFileEntry (max 5 entries, newest first)
 *
 * Thumbnails are scaled to max 128px on the long edge to limit storage usage.
 * Full image data is NOT stored; clicking "reopen" prompts the user to
 * re-select the file via the standard file dialog.
 */

export const RECENT_FILES_KEY = "choco:recent-files";
export const RECENT_FILES_MAX = 5;
const THUMB_MAX_PX = 128;

export interface RecentFileEntry {
  /** Original file name (e.g. "logo.png") */
  name: string;
  /** 128px-scaled thumbnail as a PNG data URL */
  thumbnailDataUrl: string;
  /** ISO 8601 timestamp of last access */
  lastAccessedAt: string;
}

/** Reads the recent files list from localStorage. Returns [] on any error. */
export function getRecentFiles(): RecentFileEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_FILES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentFileEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as Record<string, unknown>).name === "string" &&
        typeof (e as Record<string, unknown>).thumbnailDataUrl === "string" &&
        typeof (e as Record<string, unknown>).lastAccessedAt === "string"
    );
  } catch {
    return [];
  }
}

/** Persists the recent files list to localStorage. Silently ignores quota errors. */
function saveRecentFiles(entries: RecentFileEntry[]): void {
  try {
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(entries));
  } catch {
    // ignore quota errors
  }
}

/**
 * Scales ImageData down to fit within THUMB_MAX_PX on the long edge,
 * then returns a PNG data URL.
 */
export function makeThumbnail(imageData: ImageData): string {
  const { width, height } = imageData;
  let tw = width;
  let th = height;
  if (width > THUMB_MAX_PX || height > THUMB_MAX_PX) {
    if (width >= height) {
      tw = THUMB_MAX_PX;
      th = Math.max(1, Math.round((height / width) * THUMB_MAX_PX));
    } else {
      th = THUMB_MAX_PX;
      tw = Math.max(1, Math.round((width / height) * THUMB_MAX_PX));
    }
  }
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = width;
  srcCanvas.height = height;
  srcCanvas.getContext("2d")!.putImageData(imageData, 0, 0);

  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = tw;
  thumbCanvas.height = th;
  const ctx = thumbCanvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(srcCanvas, 0, 0, tw, th);
  return thumbCanvas.toDataURL("image/png");
}

/**
 * Adds a file to the recent files list.
 *
 * - Deduplicates by exact file name (removes older entry for the same name).
 * - Keeps at most RECENT_FILES_MAX entries (oldest removed when over limit).
 * - Persists to localStorage immediately.
 *
 * @param name           File name (e.g. "logo.png")
 * @param thumbnailDataUrl 128px PNG data URL
 */
export function addRecentFile(name: string, thumbnailDataUrl: string): void {
  const prev = getRecentFiles();
  const deduplicated = prev.filter((e) => e.name !== name);
  const entry: RecentFileEntry = {
    name,
    thumbnailDataUrl,
    lastAccessedAt: new Date().toISOString(),
  };
  const next = [entry, ...deduplicated].slice(0, RECENT_FILES_MAX);
  saveRecentFiles(next);
}

/**
 * Clears all recent files from localStorage.
 */
export function clearRecentFiles(): void {
  try {
    localStorage.removeItem(RECENT_FILES_KEY);
  } catch {
    // ignore
  }
}

/**
 * Formats an ISO timestamp into a short relative label for display.
 * e.g. "5分前", "2時間前", "3日前", or "MM/DD"
 */
export function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  if (isNaN(diffMs)) return "";
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "今";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 14) return `${diffDay}日前`;
  const d = new Date(isoString);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

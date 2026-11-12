/**
 * Pure path / link helpers.
 *
 * Deliberately free of any top-level `obsidian` import so the trickiest logic
 * (folder resolution + link generation) can be unit-tested in Node. The i18n
 * `t()` used for error messages is also obsidian-free at module load.
 * All paths handled here are normalized, vault-relative, POSIX-style
 * (forward slashes, no leading slash, "" === vault root).
 */

import { t } from "./i18n";

export type LinkStyle = "markdown" | "wiki";

export class PathResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathResolutionError";
  }
}

/** Where the configured folder path is anchored to. */
export type PathBase = "note" | "vault";

export interface ResolvedFolder {
  /** Vault-relative folder, "" means the vault root. */
  folder: string;
  /** Which anchor was actually applied (useful for the settings preview). */
  base: PathBase;
}

/**
 * Normalize an arbitrary user supplied path into a vault-relative POSIX path.
 * Backslashes are accepted (Windows users), `.` segments dropped, `..` resolved.
 * Returns "" for the vault root instead of "." or "/".
 */
export function normalizeVaultPath(input: string): string {
  const unified = input.replace(/\\/g, "/");
  const parts = unified.split("/");
  const stack: string[] = [];

  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) {
        throw new PathResolutionError(
          t("error.pathOutOfRange", { input })
        );
      }
      stack.pop();
      continue;
    }
    stack.push(part);
  }

  return stack.join("/");
}

/** Folder containing a note. "" when the note is in the vault root. */
export function parentFolder(filePath: string): string {
  const normalized = normalizeVaultPath(filePath);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

/** Join two vault-relative paths, normalizing the result. */
export function joinVaultPath(...segments: string[]): string {
  return normalizeVaultPath(
    segments
      .filter((segment) => segment !== undefined && segment !== null)
      .join("/")
  );
}

function isRelativeMarker(path: string): boolean {
  return (
    path === "." ||
    path === "./" ||
    path === ".." ||
    path.startsWith("./") ||
    path.startsWith("../")
  );
}

/**
 * Resolve the user setting into the vault-relative folder that should receive
 * pasted images.
 *
 * Rules (documented in the settings UI):
 *  - ""                      -> folder of the current note
 *  - "./x" or "../x"         -> resolved against the folder of the current note
 *  - "/x"                    -> resolved against the vault root
 *  - "x" (bare, no prefix)   -> resolved against the vault root, so that a
 *                               note-relative folder must be written explicitly
 *                               as "./x" — this keeps the two modes unambiguous.
 */
export function resolveImageFolder(
  notePath: string,
  settingPath: string,
  barePathBase: PathBase = "vault"
): ResolvedFolder {
  const raw = (settingPath ?? "").trim().replace(/\\/g, "/");
  const noteFolder = parentFolder(notePath);

  if (raw === "" || raw === "." || raw === "./") {
    return { folder: noteFolder, base: "note" };
  }

  if (isRelativeMarker(raw)) {
    return { folder: joinVaultPath(noteFolder, raw), base: "note" };
  }

  if (raw.startsWith("/")) {
    return { folder: normalizeVaultPath(raw), base: "vault" };
  }

  const normalized = normalizeVaultPath(raw);
  if (barePathBase === "note") {
    return { folder: joinVaultPath(noteFolder, normalized), base: "note" };
  }
  return { folder: normalized, base: "vault" };
}

/** Characters that are illegal in file names on Windows / macOS / Linux. */
const ILLEGAL_FILE_NAME_CHARS = /[\\/:*?"<>|]/g;

/**
 * Replace the control characters (U+0000–U+001F) that are illegal in file
 * names. They are matched by code point instead of by a character range, so
 * no control character ever shows up in a regular expression.
 */
function replaceControlChars(name: string): string {
  return Array.from(name)
    .map((char) => ((char.codePointAt(0) ?? 0) <= 0x1f ? "-" : char))
    .join("");
}

/** Strip characters that are illegal in file names on Windows / macOS / Linux. */
export function sanitizeFileName(name: string): string {
  const cleaned = replaceControlChars(name)
    .replace(ILLEGAL_FILE_NAME_CHARS, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\-\s]+/, "")
    .replace(/[.\-\s]+$/, "");
  return cleaned.length > 0 ? cleaned : "image";
}

/** `2026-11-12T03:12:45Z` -> `20261112-031245` (filesystem friendly, sortable). */
export function formatTimestamp(date: Date): string {
  const pad = (value: number, width = 2): string =>
    String(value).padStart(width, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}` +
    pad(date.getMilliseconds(), 3)
  );
}

/**
 * Pick a file name that does not collide with an existing file.
 * `exists` receives a candidate vault path and reports whether it is taken.
 */
export function buildUniquePath(
  folder: string,
  baseName: string,
  extension: string,
  exists: (candidate: string) => boolean
): string {
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  const stem = sanitizeFileName(baseName);

  let candidate = joinVaultPath(folder, `${stem}${ext}`);
  let counter = 1;
  while (exists(candidate)) {
    candidate = joinVaultPath(folder, `${stem}-${counter}${ext}`);
    counter += 1;
    if (counter > 9999) {
      candidate = joinVaultPath(folder, `${stem}-${Date.now()}${ext}`);
      break;
    }
  }
  return candidate;
}

/**
 * Relative path from the note's folder to a target file, e.g.
 * note "a/b/note.md", target "a/assets/x.png" -> "assets/x.png";
 * target "c/x.png" -> "../../c/x.png".
 */
export function relativeFromNote(notePath: string, targetPath: string): string {
  const from = parentFolder(notePath).split("/").filter(Boolean);
  const to = normalizeVaultPath(targetPath).split("/").filter(Boolean);

  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) {
    common += 1;
  }

  const ups = from.length - common;
  const down = to.slice(common);
  const segments = [...Array<string>(ups).fill(".."), ...down];
  return segments.length === 0 ? "" : segments.join("/");
}

/** URL-encode a vault path segment by segment, keeping the separators. */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export interface LinkOptions {
  /** Vault-relative path of the note being edited. */
  notePath: string;
  /** Vault-relative path of the saved image. */
  imagePath: string;
  style: LinkStyle;
  alt?: string;
}

/** Build the text that gets inserted at the cursor. */
export function buildImageLink(options: LinkOptions): string {
  const { notePath, imagePath, style } = options;
  const alt = options.alt ?? "";

  if (style === "wiki") {
    const target = normalizeVaultPath(imagePath);
    return alt ? `![[${target}|${alt}]]` : `![[${target}]]`;
  }

  const relative = relativeFromNote(notePath, imagePath);
  return `![${alt}](${encodePath(relative)})`;
}

export interface MimeExtensionMap {
  [mime: string]: string;
}

export const MIME_EXTENSIONS: MimeExtensionMap = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/x-ms-bmp": "bmp",
  "image/avif": "avif",
  "image/tiff": "tiff",
  "image/heic": "heic",
  "image/heif": "heif",
};

const KNOWN_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
  "tiff",
  "tif",
  "heic",
  "heif",
]);

/** Infer the file extension from a MIME type, falling back to the file name. */
export function inferExtension(mimeType: string, fileName?: string): string {
  const byMime = MIME_EXTENSIONS[(mimeType || "").toLowerCase()];
  if (byMime) return byMime;

  const dot = (fileName ?? "").lastIndexOf(".");
  if (dot !== -1) {
    const ext = (fileName ?? "").slice(dot + 1).toLowerCase();
    if (KNOWN_EXTENSIONS.has(ext)) return ext === "jpeg" ? "jpg" : ext;
  }
  return "png";
}
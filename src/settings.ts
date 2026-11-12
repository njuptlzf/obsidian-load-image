import type { LinkStyle } from "./paths";
import type { LanguageSetting } from "./i18n";

export interface LoadImageSettings {
  /** Folder for pasted images. Empty = next to the note. */
  imageFolder: string;
  /** How the image is referenced in the note. */
  linkStyle: LinkStyle;
  /**
   * Image name template. Supported placeholders:
   * `{timestamp}`, `{name}` (original file name), `{note}` (note name),
   * `{date}`, `{time}`. Empty = keep the original file name.
   */
  fileNameTemplate: string;
  /** Show a short notice after an image was saved. */
  showNotice: boolean;
  /**
   * UI language. "auto" follows Obsidian's app language (getLanguage()).
   */
  language: LanguageSetting;
}

export const DEFAULT_SETTINGS: LoadImageSettings = {
  imageFolder: "./assets",
  linkStyle: "markdown",
  fileNameTemplate: "",
  showNotice: false,
  language: "auto",
};

const MAX_FOLDER_LENGTH = 200;

/**
 * Validate / repair a settings object coming from disk (data.json can be edited
 * by hand or left over from an older version). Never throws: bad values fall
 * back to the default so the plugin always boots.
 */
export function normalizeSettings(input: unknown): LoadImageSettings {
  const raw = (input ?? {}) as Partial<Record<keyof LoadImageSettings, unknown>>;

  let imageFolder = DEFAULT_SETTINGS.imageFolder;
  if (typeof raw.imageFolder === "string") {
    const trimmed = raw.imageFolder.trim();
    imageFolder = trimmed.length > MAX_FOLDER_LENGTH
      ? trimmed.slice(0, MAX_FOLDER_LENGTH)
      : trimmed === "." || trimmed === "/" ? "" : trimmed;
  }

  const linkStyle: LinkStyle =
    raw.linkStyle === "wiki" ? "wiki" : "markdown";

  let fileNameTemplate = DEFAULT_SETTINGS.fileNameTemplate;
  if (typeof raw.fileNameTemplate === "string") {
    // Empty is a valid value: "keep the original file name".
    fileNameTemplate = raw.fileNameTemplate.trim().slice(0, 120);
  }

  const showNotice = raw.showNotice === true;

  const language: LanguageSetting =
    raw.language === "en" || raw.language === "zh" || raw.language === "auto"
      ? raw.language
      : "auto";

  return { imageFolder, linkStyle, fileNameTemplate, showNotice, language };
}

/**
 * Expand the file name template. `{timestamp}` is always available, `{name}`
 * and `{note}` become empty strings when unavailable. The result is *not*
 * sanitized here — the path layer takes care of that.
 */
export function expandFileNameTemplate(
  template: string,
  context: { timestamp: string; originalName?: string; noteName?: string }
): string {
  const name = (context.originalName ?? "").replace(/\.[^.]+$/, "");
  return template
    .replace(/\{timestamp\}/g, context.timestamp)
    .replace(/\{name\}/g, name)
    .replace(/\{note\}/g, context.noteName ?? "")
    .replace(/\{date\}/g, context.timestamp.slice(0, 8))
    .replace(/\{time\}/g, context.timestamp.slice(9));
}
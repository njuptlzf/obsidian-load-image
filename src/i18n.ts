/**
 * Lightweight i18n for the Load Image plugin.
 *
 * Obsidian exposes the app UI language via the public `getLanguage()` API
 * (since 1.8.7) but provides no translation framework for plugin strings, so
 * we keep our own dictionary. The default locale follows the app; the user can
 * force English or Chinese in settings. Older Obsidian versions without
 * `getLanguage()` fall back to the browser / Electron locale.
 *
 * NOTE: `obsidian` is required lazily inside `detectLocale()` (never at module
 * load) so the pure path / saver modules that import this file stay testable in
 * plain Node without pulling in Obsidian.
 */

export type Locale = "en" | "zh";
export type LanguageSetting = "auto" | "en" | "zh";

const en: Record<string, string> = {
  // Settings
  "settings.heading": "Load Image settings",
  "settings.folder.name": "Image folder for pasted images",
  "settings.folder.rule1": "1. Empty — save next to the current Markdown note",
  "settings.folder.rule2":
    "2. Relative path (starting with ./ or ../) — relative to the note's folder",
  "settings.folder.rule3":
    "3. Absolute path (e.g. /assets, assets/images) — relative to the vault root",
  "settings.folder.note": "Missing folders are created automatically.",
  "settings.folder.reset": "Reset to default ./assets",
  "settings.link.name": "Insert link style",
  "settings.link.desc":
    "Markdown relative paths are the most compatible; the Wiki embed uses the full in-vault path.",
  "settings.link.markdown": "Markdown: ![](assets/a.png)",
  "settings.link.wiki": "Wiki: ![[assets/a.png]]",
  "settings.nameTemplate.name": "Image name template",
  "settings.nameTemplate.desc":
    "Empty: keep the clipboard file name. Placeholders: {name} original name, {timestamp} timestamp, {date} date, {time} time, {note} note name. Collisions get -1, -2 appended automatically.",
  "settings.nameTemplate.placeholder": "Empty = use original file name",
  "settings.notice.name": "Show notice after saving",
  "settings.notice.desc":
    'Pop a "image saved" notice in the top-right corner after each paste.',
  "settings.language.name": "Language",
  "settings.language.desc":
    'UI language. "Follow app" uses Obsidian\'s own language setting.',
  "settings.language.auto": "Follow app",
  "settings.language.en": "English",
  "settings.language.zh": "中文",

  // Settings preview
  "preview.noteBase": 'Example note "{note}": images will be saved to:',
  "preview.vaultBase": "Images will be saved (relative to the vault root):",
  "preview.noteHint": "The actual location follows the current note.",
  "preview.vaultRoot": "(vault root)",
  "preview.invalid": "Invalid path",

  // Notices / errors
  "notice.clipboardEmpty": "No image found in the clipboard",
  "notice.clipboardReadFailed":
    "Cannot read the clipboard. Please use Ctrl/Cmd+V to paste directly.",
  "notice.openNoteFirst": "Open a note before pasting an image",
  "notice.savedOne": "Image saved",
  "notice.savedMany": "{count} images saved",
  "error.savePrefix": "Failed to save image: ",
  "error.pathOutOfRange":
    'Path "{input}" goes outside the Obsidian vault root',
  "error.folderOccupied":
    'Path "{path}" is occupied by a file with the same name; a folder cannot be created there',

  // Commands
  "cmd.paste.name": "Paste image from clipboard",
};

const zh: Record<string, string> = {
  // Settings
  "settings.heading": "Load Image 设置",
  "settings.folder.name": "粘贴图片的存放目录",
  "settings.folder.rule1": "1. 留空 —— 保存到当前 Markdown 笔记的同级目录",
  "settings.folder.rule2":
    "2. 相对路径（以 ./ 或 ../ 开头）—— 以当前笔记所在目录为基准",
  "settings.folder.rule3":
    "3. 绝对路径（如 /assets、assets/images）—— 以 Obsidian 仓库根目录为基准",
  "settings.folder.note": "目录不存在时自动创建。",
  "settings.folder.reset": "恢复默认值 ./assets",
  "settings.link.name": "插入链接格式",
  "settings.link.desc": "Markdown 相对路径兼容性最好；Wiki 嵌入使用仓库内完整路径。",
  "settings.link.markdown": "Markdown：![](assets/a.png)",
  "settings.link.wiki": "Wiki：![[assets/a.png]]",
  "settings.nameTemplate.name": "图片名模板",
  "settings.nameTemplate.desc":
    "留空：使用剪贴板中的原文件名。可用占位符：{name} 原文件名、{timestamp} 时间戳、{date} 日期、{time} 时间、{note} 笔记名。重名时自动追加 -1、-2。",
  "settings.nameTemplate.placeholder": "留空 = 使用原文件名",
  "settings.notice.name": "保存后显示提示",
  "settings.notice.desc": "在右上角弹出“图片已保存”的通知。",
  "settings.language.name": "界面语言",
  "settings.language.desc": "UI 语言。“跟随应用” 使用 Obsidian 的语言设置。",
  "settings.language.auto": "跟随应用",
  "settings.language.en": "English",
  "settings.language.zh": "中文",

  // Settings preview
  "preview.noteBase": "以笔记 “{note}” 为例，图片将保存到：",
  "preview.vaultBase": "图片将保存到（仓库根目录起算）：",
  "preview.noteHint": "实际落点随当前笔记所在位置变化。",
  "preview.vaultRoot": "（仓库根目录）",
  "preview.invalid": "路径无效",

  // Notices / errors
  "notice.clipboardEmpty": "剪贴板中没有图片",
  "notice.clipboardReadFailed": "无法读取剪贴板，请使用 Ctrl/Cmd+V 直接粘贴",
  "notice.openNoteFirst": "请先打开一个笔记再粘贴图片",
  "notice.savedOne": "图片已保存",
  "notice.savedMany": "{count} 张图片已保存",
  "error.savePrefix": "保存图片失败：",
  "error.pathOutOfRange": "路径 “{input}” 超出了 Obsidian 仓库根目录的范围",
  "error.folderOccupied": "路径 “{path}” 已被同名文件占用，无法创建目录",

  // Commands
  "cmd.paste.name": "从剪贴板粘贴图片",
};

const dict: Record<Locale, Record<string, string>> = { en, zh };

let current: Locale = "en";

/** Detect the locale from the running environment. */
export function detectLocale(): Locale {
  let lang = "";
  try {
    // Available since Obsidian 1.8.7; lazy require keeps pure modules node-safe.
    const obsidian = require("obsidian");
    if (obsidian && typeof obsidian.getLanguage === "function") {
      lang = obsidian.getLanguage();
    }
  } catch {
    // obsidian module unavailable (older version or non-app environment)
  }
  if (!lang && typeof navigator !== "undefined") {
    lang = navigator.language || "";
  }
  if (!lang && typeof window !== "undefined") {
    try {
      lang = window.localStorage?.getItem("language") || "";
    } catch {
      // ignore storage access errors
    }
  }
  return lang.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/** Resolve the active locale from the user's language preference. */
export function setLocale(pref: LanguageSetting): void {
  current = pref === "auto" ? detectLocale() : pref;
}

export function getLocale(): Locale {
  return current;
}

/** Translate a key, optionally interpolating {name} tokens. */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = dict[current][key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

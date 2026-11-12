/**
 * Runtime smoke test: loads the REAL built main.js with a stubbed `obsidian`
 * module and simulates an actual Ctrl+V paste, asserting that the image lands
 * in the configured folder and the correct link is inserted at the cursor.
 *
 * Run: node scripts/smoke.mjs
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import Module from "node:module";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mainPath = join(root, "main.js");

if (!fs.existsSync(mainPath)) {
  console.error("main.js not found — run `npm run build` first.");
  process.exit(1);
}

// ---------------------------------------------------------------- fake vault
class FakeFolder {
  constructor(path) {
    this.path = path;
    this.kind = "folder";
  }
}

class FakeVault {
  constructor() {
    this.folders = new Set(["", "notes", "notes/daily"]);
    this.files = new Map();
    this.writes = [];
  }
  getAbstractFileByPath(path) {
    if (this.files.has(path)) return { path, kind: "file" };
    if (this.folders.has(path) || path === "") return new FakeFolder(path);
    return null;
  }
  async createFolder(path) {
    this.folders.add(path);
    return new FakeFolder(path);
  }
  async createBinary(path, data) {
    this.files.set(path, { path, size: data.byteLength });
    this.writes.push(path);
    return { path, kind: "file" };
  }
}

const vault = new FakeVault();
const notices = [];

// ------------------------------------------------------------- stub obsidian
class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
    this._data = null;
    this._events = [];
    this._commands = [];
    this._tabs = [];
  }
  async loadData() {
    return this._data;
  }
  async saveData(data) {
    this._data = data;
  }
  addSettingTab(tab) {
    this._tabs.push(tab);
  }
  registerEvent(ref) {
    this._events.push(ref);
    return ref;
  }
  addCommand(cmd) {
    this._commands.push(cmd);
    return cmd;
  }
  registerDomEvent() {}
  registerInterval() {}
}

class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = null;
  }
}

class Notice {
  constructor(message) {
    notices.push(message);
  }
}

class Setting {
  constructor() {
    this.settingEl = {};
  }
  setName() {
    return this;
  }
  setDesc() {
    return this;
  }
  setHeading() {
    return this;
  }
  addText() {
    return this;
  }
  addExtraButton() {
    return this;
  }
  addDropdown() {
    return this;
  }
  addToggle() {
    return this;
  }
}

const obsidianStub = {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  MarkdownView: class {},
  MarkdownFileInfo: class {},
  TFile: class {},
  TFolder: FakeFolder,
  getLanguage: () => "en",
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") return obsidianStub;
  return originalLoad.call(this, request, parent, isMain);
};

// ------------------------------------------------------------- load the plugin
const require = createRequire(import.meta.url);
const LoadImagePlugin = require(mainPath).default ?? require(mainPath);

const app = {
  vault,
  workspace: {
    on: (name, cb) => ({ name, cb, unregister() {} }),
    getActiveFile: () => ({ path: "notes/daily/2026-11-12.md", basename: "2026-11-12", extension: "md" }),
  },
};

const plugin = new LoadImagePlugin(app, { id: "load-image" });

// ------------------------------------------------------------------ scenario
function makePasteEvent() {
  const file = {
    name: "image.png",
    type: "image/png",
    size: 12,
    arrayBuffer: async () => new ArrayBuffer(12),
  };
  return {
    clipboardData: { files: [file], items: [], types: ["Files"] },
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

const inserted = [];
const editor = {
  replaceSelection: (text) => inserted.push(text),
  getCursor: () => ({ line: 0, ch: 0 }),
};

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

console.log("Load Image — runtime smoke test\n");

await plugin.onload();
console.log("onload");

check("registers one editor-paste listener", plugin._events.length === 1, `got ${plugin._events.length}`);
check("registers the manual paste command", plugin._commands.length === 1);
check("registers a settings tab", plugin._tabs.length === 1);

// --- declarative settings (Obsidian 1.13+) ---------------------------------
const settingsTab = plugin._tabs[0];
const definitions = settingsTab.getSettingDefinitions();
check("settings tab exposes declarative definitions", Array.isArray(definitions) && definitions.length > 0);
const group = definitions[0];
check("definitions are grouped under a heading", group?.type === "group" && typeof group.heading === "string");
const items = group?.items ?? [];
check("defines all five settings", items.length === 5, `got ${items.length}`);
const controlKeys = items
  .map((item) => item.control?.key)
  .filter((key) => typeof key === "string");
check(
  "control keys match the settings object",
  ["linkStyle", "fileNameTemplate", "showNotice"].every((key) => controlKeys.includes(key)),
  controlKeys.join(",")
);
check(
  "every control key exists in the settings",
  controlKeys.every((key) => key in plugin.settings),
  controlKeys.join(",")
);

const pasteHandler = plugin._events[0].cb;

// --- default settings: ./assets relative to the note -----------------------
// Use the timestamp template for deterministic assertions below; the
// shipped default (empty template = original name) is tested at the end.
plugin.settings.fileNameTemplate = "image-{timestamp}";
let evt = makePasteEvent();
pasteHandler(evt, editor, { file: { path: "notes/daily/2026-11-12.md", basename: "2026-11-12" } });
check("takes over the paste (preventDefault)", evt.defaultPrevented);
await new Promise((r) => setTimeout(r, 60));

console.log("\ndefault ./assets:");
check("creates notes/daily/assets", vault.folders.has("notes/daily/assets"), [...vault.folders].join(","));
check("wrote exactly one image", vault.writes.length === 1, JSON.stringify(vault.writes));
check(
  "image is inside notes/daily/assets",
  (vault.writes[0] ?? "").startsWith("notes/daily/assets/"),
  vault.writes[0]
);
check(
  "inserted a note-relative markdown link",
  /^!\[\]\(assets\/image-[\d-]+\.png\)$/.test(inserted[0] ?? ""),
  inserted[0]
);

// --- empty folder: next to the note ---------------------------------------
plugin.settings.imageFolder = "";
inserted.length = 0;
vault.writes.length = 0;
evt = makePasteEvent();
pasteHandler(evt, editor, { file: { path: "notes/daily/2026-11-12.md", basename: "2026-11-12" } });
await new Promise((r) => setTimeout(r, 60));

console.log("\nempty folder (next to note):");
check("wrote into notes/daily", (vault.writes[0] ?? "").startsWith("notes/daily/"), vault.writes[0]);
check("link has no folder prefix", /^!\[\]\(image-[\d-]+\.png\)$/.test(inserted[0] ?? ""), inserted[0]);

// --- absolute from vault root ---------------------------------------------
plugin.settings.imageFolder = "/media/pasted";
inserted.length = 0;
vault.writes.length = 0;
evt = makePasteEvent();
pasteHandler(evt, editor, { file: { path: "notes/daily/2026-11-12.md", basename: "2026-11-12" } });
await new Promise((r) => setTimeout(r, 60));

console.log("\nvault-absolute /media/pasted:");
check("creates media and media/pasted", vault.folders.has("media") && vault.folders.has("media/pasted"));
check("wrote into media/pasted", (vault.writes[0] ?? "").startsWith("media/pasted/"), vault.writes[0]);
check(
  "link climbs two levels",
  /^!\[\]\(\.\.\/\.\.\/media\/pasted\/image-[\d-]+\.png\)$/.test(inserted[0] ?? ""),
  inserted[0]
);

// --- non-image paste is left alone ----------------------------------------
evt = {
  clipboardData: { files: [{ name: "a.txt", type: "text/plain" }], items: [] },
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true;
  },
};
pasteHandler(evt, editor, { file: { path: "notes/daily/2026-11-12.md" } });

console.log("\nnon-image paste:");
check("does not intercept text/files", evt.defaultPrevented === false);

// --- a paste another plugin handled already is left alone ------------------
inserted.length = 0;
vault.writes.length = 0;
evt = makePasteEvent();
evt.defaultPrevented = true; // another plugin already took the paste
pasteHandler(evt, editor, { file: { path: "notes/daily/2026-11-12.md" } });

console.log("\nalready handled paste:");
check("does not touch an already handled paste", vault.writes.length === 0 && inserted.length === 0);

// --- wiki style ------------------------------------------------------------
plugin.settings.imageFolder = "./assets";
plugin.settings.linkStyle = "wiki";
inserted.length = 0;
evt = makePasteEvent();
pasteHandler(evt, editor, { file: { path: "notes/daily/2026-11-12.md", basename: "2026-11-12" } });
await new Promise((r) => setTimeout(r, 60));

console.log("\nwiki link style:");
check("inserts a wiki embed with vault path", /^!\[\[notes\/daily\/assets\/.+\.png\]\]$/.test(inserted[0] ?? ""), inserted[0]);

// --- multi-image paste -----------------------------------------------------
inserted.length = 0;
const multi = {
  clipboardData: {
    files: [
      { name: "a.png", type: "image/png", arrayBuffer: async () => new ArrayBuffer(4) },
      { name: "b.jpg", type: "image/jpeg", arrayBuffer: async () => new ArrayBuffer(4) },
    ],
    items: [],
  },
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true;
  },
};
pasteHandler(multi, editor, { file: { path: "notes/daily/2026-11-12.md", basename: "2026-11-12" } });
await new Promise((r) => setTimeout(r, 80));

console.log("\nmulti-image paste:");
check("inserts two lines", (inserted[0] ?? "").split("\n").length === 2, JSON.stringify(inserted[0]));

// --- settings persistence --------------------------------------------------
plugin.settings.imageFolder = "  ./img  ";
await plugin.saveSettings();
check("\nsettings persisted to data.json store", plugin._data.imageFolder === "  ./img  ");

// --- empty template keeps the original clipboard name ----------------------
plugin.settings.imageFolder = "./assets";
plugin.settings.fileNameTemplate = "";
inserted.length = 0;
vault.writes.length = 0;
evt = {
  clipboardData: {
    files: [
      {
        name: "Clipboard_Screenshot.png",
        type: "image/png",
        arrayBuffer: async () => new ArrayBuffer(6),
      },
    ],
    items: [],
  },
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true;
  },
};
pasteHandler(evt, editor, { file: { path: "notes/daily/2026-11-12.md", basename: "2026-11-12" } });
await new Promise((r) => setTimeout(r, 60));

console.log("\nempty template (keep original name):");
check(
  "uses the sanitized original file name",
  vault.writes[0] === "notes/daily/assets/Clipboard_Screenshot.png",
  vault.writes[0]
);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
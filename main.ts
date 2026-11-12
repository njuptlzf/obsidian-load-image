import {
  App,
  Editor,
  MarkdownFileInfo,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFolder,
  getLanguage,
  type SettingDefinitionItem,
} from "obsidian";

import {
  DEFAULT_SETTINGS,
  LoadImageSettings,
  normalizeSettings,
} from "./src/settings";
import { PathResolutionError, inferExtension } from "./src/paths";
import {
  VaultPort,
  describeTargetFolder,
  saveImage,
} from "./src/saver";
import {
  t,
  setLocale,
  type LanguageSetting,
} from "./src/i18n";

/**
 * Controller layer: wires Obsidian events to the saver service.
 * No business logic here — folder resolution, naming and writing live in
 * `src/saver.ts` and `src/paths.ts`, both unit tested.
 */
export default class LoadImagePlugin extends Plugin {
  override settings: LoadImageSettings = { ...DEFAULT_SETTINGS };
  /** Paths claimed during the current paste batch (same-ms collisions). */
  private reserved = new Set<string>();

  override async onload(): Promise<void> {
    await this.loadSettings();
    setLocale(this.settings.language, this.getAppLanguage());
    this.addSettingTab(new LoadImageSettingTab(this.app, this));

    // Only image pastes are intercepted; text / file pastes stay untouched.
    this.registerEvent(
      this.app.workspace.on(
        "editor-paste",
        (evt: ClipboardEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
          // Another plugin may have handled the paste already.
          if (evt.defaultPrevented) return;

          const files = extractImageFiles(evt);
          if (files.length === 0) return;

          evt.preventDefault();
          void this.handlePaste(files, editor, info);
        }
      )
    );

    this.addCommand({
      id: "paste-image-from-clipboard",
      name: t("cmd.paste.name"),
      editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
        void this.pasteFromClipboard(editor, ctx);
      },
    });
  }

  /**
   * The Obsidian UI language, used when the plugin language follows the app.
   *
   * `getLanguage()` needs Obsidian 1.8.7, which is this plugin's minimum
   * version; on an unexpected failure the browser locale is used instead.
   */
  getAppLanguage(): string {
    try {
      return getLanguage();
    } catch {
      // The API is not available on this Obsidian version.
      return "";
    }
  }

  /** Re-render command palette labels after a language change. */
  refreshCommandNames(): void {
    // `app.commands` exists at runtime but is absent from some type defs.
    const commands = (
      this.app as unknown as {
        commands?: { commands?: Record<string, { name: string }> };
      }
    ).commands;
    const command =
      commands?.commands?.["load-image:paste-image-from-clipboard"];
    if (command) command.name = t("cmd.paste.name");
  }

  override onunload(): void {
    this.reserved.clear();
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Adapter that exposes the Obsidian vault through the testable port. */
  private get vaultPort(): VaultPort {
    const vault = this.app.vault;
    return {
      getAbstractFileByPath: (path) => vault.getAbstractFileByPath(path),
      createFolder: (path) => vault.createFolder(path),
      createBinary: (path, data) => vault.createBinary(path, data),
      isFolder: (entry) => entry instanceof TFolder,
    };
  }

  /**
   * Manual command path: read the clipboard ourselves for the rare case where
   * `editor-paste` is not delivered (e.g. focus inside a popover).
   */
  private async pasteFromClipboard(
    editor: Editor,
    ctx: MarkdownView | MarkdownFileInfo
  ): Promise<void> {
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];

      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;

        const blob = await item.getType(imageType);
        files.push(
          new File([blob], `clipboard.${inferExtension(imageType)}`, {
            type: imageType,
          })
        );
      }

      if (files.length === 0) {
        new Notice(t("notice.clipboardEmpty"));
        return;
      }
      await this.handlePaste(files, editor, ctx);
    } catch (error) {
      console.error("[load-image] clipboard read failed", error);
      new Notice(t("notice.clipboardReadFailed"));
    }
  }

  private async handlePaste(
    files: File[],
    editor: Editor,
    ctx: MarkdownView | MarkdownFileInfo
  ): Promise<void> {
    const noteFile = ctx?.file ?? this.app.workspace.getActiveFile();
    if (!noteFile) {
      new Notice(t("notice.openNoteFirst"));
      return;
    }

    const links: string[] = [];
    this.reserved.clear();

    for (const file of files) {
      try {
        const result = await saveImage(this.vaultPort, file, {
          notePath: noteFile.path,
          settings: this.settings,
          reserved: this.reserved,
        });
        links.push(result.link);
      } catch (error) {
        console.error("[load-image] save failed", error);
        new Notice(formatSaveError(error), 6000);
      }
    }

    this.reserved.clear();

    if (links.length === 0) return;
    editor.replaceSelection(links.join("\n"));

    if (this.settings.showNotice) {
      new Notice(
        links.length === 1
          ? t("notice.savedOne")
          : t("notice.savedMany", { count: links.length })
      );
    }
  }
}

function formatSaveError(error: unknown): string {
  if (error instanceof PathResolutionError) return error.message;
  const detail = error instanceof Error ? error.message : String(error);
  return `${t("error.savePrefix")}${detail}`;
}

/** Collect image files from a paste event, in a stable order. */
function extractImageFiles(evt: ClipboardEvent): File[] {
  const data = evt.clipboardData;
  if (!data) return [];

  const fromFiles = Array.from(data.files ?? []).filter((file) =>
    file.type.startsWith("image/")
  );
  if (fromFiles.length > 0) return fromFiles;

  return Array.from(data.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

/**
 * The settings tab.
 *
 * Two rendering paths that have to stay in sync:
 *
 *  - `getSettingDefinitions()` — the declarative API of Obsidian 1.13 and up.
 *    Obsidian renders it, persists the values and indexes the settings for
 *    the global settings search.
 *  - `display()` — the imperative fallback for Obsidian below 1.13.
 *
 * `refreshSettings()` picks whichever fits the running version: `update()`
 * re-reads the definitions on 1.13+, older versions re-render imperatively.
 */
class LoadImageSettingTab extends PluginSettingTab {
  private readonly plugin: LoadImagePlugin;
  private previewEl: HTMLElement | null = null;

  constructor(app: App, plugin: LoadImagePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // ------------------------------------------------------------- declarative

  /** Obsidian 1.13+ reads the settings from here. */
  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: t("settings.heading"),
        items: [
          {
            name: t("settings.language.name"),
            desc: t("settings.language.desc"),
            // A plain control cannot re-render the tab, and switching the
            // language changes every label — so this row keeps its handler.
            render: (setting) => this.renderLanguageSetting(setting),
          },
          {
            name: t("settings.folder.name"),
            // The folder row carries the live path preview, so it is drawn
            // by hand as well.
            render: (setting) => this.renderFolderSetting(setting),
          },
          {
            name: t("settings.link.name"),
            desc: t("settings.link.desc"),
            control: {
              type: "dropdown",
              key: "linkStyle",
              options: {
                markdown: t("settings.link.markdown"),
                wiki: t("settings.link.wiki"),
              },
            },
          },
          {
            name: t("settings.nameTemplate.name"),
            desc: t("settings.nameTemplate.desc"),
            control: {
              type: "text",
              key: "fileNameTemplate",
              placeholder: t("settings.nameTemplate.placeholder"),
            },
          },
          {
            name: t("settings.notice.name"),
            desc: t("settings.notice.desc"),
            control: { type: "toggle", key: "showNotice" },
          },
        ],
      },
    ];
  }

  /** Language picker. Switching it re-renders the whole tab. */
  private renderLanguageSetting(setting: Setting): void {
    setting.addDropdown((dropdown) =>
      dropdown
        .addOption("auto", t("settings.language.auto"))
        .addOption("en", t("settings.language.en"))
        .addOption("zh", t("settings.language.zh"))
        .setValue(this.plugin.settings.language)
        .onChange(async (value) => {
          this.plugin.settings.language = value as LanguageSetting;
          await this.plugin.saveSettings();
          setLocale(
            this.plugin.settings.language,
            this.plugin.getAppLanguage()
          );
          this.plugin.refreshCommandNames();
          this.refreshSettings();
        })
    );
  }

  /** Folder picker with the live path preview below it. */
  private renderFolderSetting(setting: Setting): void {
    // The three rules are separate lines, so they are built as a fragment.
    setting.setDesc(
      createFragment((fragment) => {
        fragment.createDiv({ text: t("settings.folder.rule1") });
        fragment.createDiv({ text: t("settings.folder.rule2") });
        fragment.createDiv({ text: t("settings.folder.rule3") });
        fragment.createDiv({
          cls: "load-image-desc-note",
          text: t("settings.folder.note"),
        });
      })
    );

    setting.addText((text) => {
      text
        .setPlaceholder("./assets")
        .setValue(this.plugin.settings.imageFolder)
        .onChange(async (value) => {
          this.plugin.settings.imageFolder = value;
          await this.plugin.saveSettings();
          this.updatePreview();
        });
      text.inputEl.addClass("load-image-folder-input");
    });

    setting.addExtraButton((button) => {
      button
        .setIcon("rotate-ccw")
        .setTooltip(t("settings.folder.reset"))
        .onClick(async () => {
          this.plugin.settings.imageFolder = DEFAULT_SETTINGS.imageFolder;
          await this.plugin.saveSettings();
          this.refreshSettings();
        });
    });

    this.previewEl = setting.descEl.createDiv({ cls: "load-image-preview" });
    this.updatePreview();
  }

  // -------------------------------------------------------------- imperative

  /** Obsidian below 1.13 renders the tab itself. */
  override display(): void {
    this.renderSettings();
  }

  /** The imperative settings page, used by Obsidian below 1.13. */
  private renderSettings(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName(t("settings.heading")).setHeading();

    // Language
    new Setting(containerEl)
      .setName(t("settings.language.name"))
      .setDesc(t("settings.language.desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", t("settings.language.auto"))
          .addOption("en", t("settings.language.en"))
          .addOption("zh", t("settings.language.zh"))
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value as LanguageSetting;
            await this.plugin.saveSettings();
            setLocale(
              this.plugin.settings.language,
              this.plugin.getAppLanguage()
            );
            this.plugin.refreshCommandNames();
            this.refreshSettings();
          })
      );

    const folderSetting = new Setting(containerEl)
      .setName(t("settings.folder.name"))
      .addText((text) => {
        text
          .setPlaceholder("./assets")
          .setValue(this.plugin.settings.imageFolder)
          .onChange(async (value) => {
            this.plugin.settings.imageFolder = value;
            await this.plugin.saveSettings();
            this.updatePreview();
          });
        text.inputEl.addClass("load-image-folder-input");
      })
      .addExtraButton((button) => {
        button
          .setIcon("rotate-ccw")
          .setTooltip(t("settings.folder.reset"))
          .onClick(async () => {
            this.plugin.settings.imageFolder = DEFAULT_SETTINGS.imageFolder;
            await this.plugin.saveSettings();
            this.refreshSettings();
          });
      });

    // 三种写法分条描述，避免挤在一行看不清。
    const folderDesc = folderSetting.descEl;
    folderDesc.empty();
    folderDesc.createDiv({ text: t("settings.folder.rule1") });
    folderDesc.createDiv({ text: t("settings.folder.rule2") });
    folderDesc.createDiv({ text: t("settings.folder.rule3") });
    folderDesc.createDiv({
      cls: "load-image-desc-note",
      text: t("settings.folder.note"),
    });

    this.previewEl = containerEl.createDiv({ cls: "load-image-preview" });

    new Setting(containerEl)
      .setName(t("settings.link.name"))
      .setDesc(t("settings.link.desc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("markdown", t("settings.link.markdown"))
          .addOption("wiki", t("settings.link.wiki"))
          .setValue(this.plugin.settings.linkStyle)
          .onChange(async (value) => {
            this.plugin.settings.linkStyle =
              value === "wiki" ? "wiki" : "markdown";
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.nameTemplate.name"))
      .setDesc(t("settings.nameTemplate.desc"))
      .addText((text) =>
        text
          .setPlaceholder(t("settings.nameTemplate.placeholder"))
          .setValue(this.plugin.settings.fileNameTemplate)
          .onChange(async (value) => {
            this.plugin.settings.fileNameTemplate = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("settings.notice.name"))
      .setDesc(t("settings.notice.desc"))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showNotice)
          .onChange(async (value) => {
            this.plugin.settings.showNotice = value;
            await this.plugin.saveSettings();
          })
      );

    this.updatePreview();
  }

  // ----------------------------------------------------------------- shared

  /**
   * Re-render the settings tab.
   *
   * `update()` is the 1.13+ refresh API — it re-reads the definitions.
   * Older Obsidian has no `update()`, so the imperative page is redrawn.
   */
  private refreshSettings(): void {
    const declarative = this as unknown as { update?: () => void };
    if (typeof declarative.update === "function") {
      declarative.update.call(this);
      return;
    }
    this.renderSettings();
  }

  private updatePreview(): void {
    if (!this.previewEl) return;

    // Fixed short example instead of the real note path, so the preview
    // stays readable regardless of how deep the current note is.
    const exampleNote = "a/b/c.md";
    this.previewEl.empty();

    try {
      const { display, base } = describeTargetFolder(
        exampleNote,
        this.plugin.settings
      );

      this.previewEl.createDiv({
        cls: "load-image-preview-label",
        text:
          base === "note"
            ? t("preview.noteBase", { note: exampleNote })
            : t("preview.vaultBase"),
      });
      this.previewEl.createEl("code", { text: display });
      if (base === "note") {
        this.previewEl.createDiv({
          cls: "load-image-preview-hint",
          text: t("preview.noteHint"),
        });
      }
    } catch (error) {
      this.previewEl.createDiv({
        cls: "load-image-preview-error",
        text: error instanceof Error ? error.message : t("preview.invalid"),
      });
    }
  }
}

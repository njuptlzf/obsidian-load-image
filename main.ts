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
    this.addSettingTab(new LoadImageSettingTab(this.app, this));

    // Only image pastes are intercepted; text / file pastes stay untouched.
    this.registerEvent(
      this.app.workspace.on(
        "editor-paste",
        (evt: ClipboardEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
          const files = extractImageFiles(evt);
          if (files.length === 0) return;

          evt.preventDefault();
          void this.handlePaste(files, editor, info);
        }
      )
    );

    this.addCommand({
      id: "paste-image-from-clipboard",
      name: "从剪贴板粘贴图片",
      editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
        void this.pasteFromClipboard(editor, ctx);
      },
    });
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
        new Notice("剪贴板中没有图片");
        return;
      }
      await this.handlePaste(files, editor, ctx);
    } catch (error) {
      console.error("[load-image] clipboard read failed", error);
      new Notice("无法读取剪贴板，请使用 Ctrl/Cmd+V 直接粘贴");
    }
  }

  private async handlePaste(
    files: File[],
    editor: Editor,
    ctx: MarkdownView | MarkdownFileInfo
  ): Promise<void> {
    const noteFile = ctx?.file ?? this.app.workspace.getActiveFile();
    if (!noteFile) {
      new Notice("请先打开一个笔记再粘贴图片");
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
        links.length === 1 ? "图片已保存" : `${links.length} 张图片已保存`
      );
    }
  }
}

function formatSaveError(error: unknown): string {
  if (error instanceof PathResolutionError) return error.message;
  const detail = error instanceof Error ? error.message : String(error);
  return `保存图片失败：${detail}`;
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

class LoadImageSettingTab extends PluginSettingTab {
  private readonly plugin: LoadImagePlugin;
  private previewEl: HTMLElement | null = null;

  constructor(app: App, plugin: LoadImagePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("load-image-settings");

    containerEl.createEl("h2", { text: "Load Image 设置" });

    const folderSetting = new Setting(containerEl)
      .setName("粘贴图片的存放目录")
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
          .setTooltip("恢复默认值 ./assets")
          .onClick(async () => {
            this.plugin.settings.imageFolder = DEFAULT_SETTINGS.imageFolder;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    // 三种写法分条描述，避免挤在一行看不清。
    const folderDesc = folderSetting.descEl;
    folderDesc.empty();
    folderDesc.createEl("div", { text: "1. 留空 —— 保存到当前 Markdown 笔记的同级目录" });
    folderDesc.createEl("div", { text: "2. 相对路径（以 ./ 或 ../ 开头）—— 以当前笔记所在目录为基准" });
    folderDesc.createEl("div", { text: "3. 绝对路径（如 /assets、assets/images）—— 以 Obsidian 仓库根目录为基准" });
    folderDesc.createEl("div", {
      cls: "load-image-desc-note",
      text: "目录不存在时自动创建。",
    });

    this.previewEl = containerEl.createDiv({ cls: "load-image-preview" });

    new Setting(containerEl)
      .setName("插入链接格式")
      .setDesc("Markdown 相对路径兼容性最好；Wiki 嵌入使用仓库内完整路径。")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("markdown", "Markdown：![](assets/a.png)")
          .addOption("wiki", "Wiki：![[assets/a.png]]")
          .setValue(this.plugin.settings.linkStyle)
          .onChange(async (value) => {
            this.plugin.settings.linkStyle =
              value === "wiki" ? "wiki" : "markdown";
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("图片名模板")
      .setDesc(
        "留空：使用剪贴板中的原文件名。可用占位符：{name} 原文件名、{timestamp} 时间戳、" +
          "{date} 日期、{time} 时间、{note} 笔记名。重名时自动追加 -1、-2。"
      )
      .addText((text) =>
        text
          .setPlaceholder("留空 = 使用原文件名")
          .setValue(this.plugin.settings.fileNameTemplate)
          .onChange(async (value) => {
            this.plugin.settings.fileNameTemplate = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("保存后显示提示")
      .setDesc("在右上角弹出“图片已保存”的通知。")
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

      this.previewEl.createEl("div", {
        cls: "load-image-preview-label",
        text:
          base === "note"
            ? `以笔记 "${exampleNote}" 为例，图片将保存到：`
            : "图片将保存到（仓库根目录起算）：",
      });
      this.previewEl.createEl("code", { text: display });
      if (base === "note") {
        this.previewEl.createEl("div", {
          cls: "load-image-preview-hint",
          text: "实际落点随当前笔记所在位置变化。",
        });
      }
    } catch (error) {
      this.previewEl.createEl("div", {
        cls: "load-image-preview-error",
        text: error instanceof Error ? error.message : "路径无效",
      });
    }
  }
}
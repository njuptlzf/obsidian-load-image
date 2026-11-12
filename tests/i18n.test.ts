import { describe, it, expect, afterEach } from "vitest";
import { t, setLocale, getLocale } from "../src/i18n";

describe("i18n", () => {
  afterEach(() => setLocale("en"));

  it("returns English by default and for the en preference", () => {
    setLocale("en");
    expect(t("settings.heading")).toBe("Load Image settings");
    expect(getLocale()).toBe("en");
  });

  it("switches to Chinese when requested", () => {
    setLocale("zh");
    expect(t("settings.heading")).toBe("Load Image 设置");
    expect(getLocale()).toBe("zh");
  });

  it("interpolates {params}", () => {
    setLocale("en");
    expect(t("preview.noteBase", { note: "a/b/c.md" })).toBe(
      'Example note "a/b/c.md": images will be saved to:'
    );
  });

  it("falls back to the English dictionary for missing keys", () => {
    setLocale("zh");
    expect(t("totally.unknown.key")).toBe("totally.unknown.key");
  });

  it("changes the rendered string when the locale changes", () => {
    setLocale("en");
    const enText = t("cmd.paste.name");
    setLocale("zh");
    const zhText = t("cmd.paste.name");
    expect(enText).toBe("Paste image from clipboard");
    expect(zhText).toBe("从剪贴板粘贴图片");
    expect(enText).not.toBe(zhText);
  });
});

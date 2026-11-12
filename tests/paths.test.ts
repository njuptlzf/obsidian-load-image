import { describe, expect, it } from "vitest";
import {
  PathResolutionError,
  buildImageLink,
  buildUniquePath,
  formatTimestamp,
  inferExtension,
  normalizeVaultPath,
  parentFolder,
  relativeFromNote,
  resolveImageFolder,
  sanitizeFileName,
} from "../src/paths";
import { DEFAULT_SETTINGS, expandFileNameTemplate, normalizeSettings } from "../src/settings";

describe("normalizeVaultPath", () => {
  it("drops leading and trailing separators", () => {
    expect(normalizeVaultPath("/assets/")).toBe("assets");
    expect(normalizeVaultPath("./assets/./img")).toBe("assets/img");
    expect(normalizeVaultPath("\\\\assets\\\\img")).toBe("assets/img");
  });

  it("collapses duplicate separators", () => {
    expect(normalizeVaultPath("a//b///c")).toBe("a/b/c");
  });

  it("maps the root to an empty string", () => {
    expect(normalizeVaultPath("")).toBe("");
    expect(normalizeVaultPath("/")).toBe("");
    expect(normalizeVaultPath(".")).toBe("");
  });

  it("resolves parent segments", () => {
    expect(normalizeVaultPath("a/b/../c")).toBe("a/c");
  });

  it("rejects paths escaping the vault", () => {
    expect(() => normalizeVaultPath("../outside")).toThrow(PathResolutionError);
  });
});

describe("parentFolder", () => {
  it("returns the containing folder", () => {
    expect(parentFolder("notes/daily/2026-11-12.md")).toBe("notes/daily");
  });

  it("returns an empty string for root notes", () => {
    expect(parentFolder("note.md")).toBe("");
  });
});

describe("resolveImageFolder", () => {
  const note = "notes/daily/2026-11-12.md";

  it("uses the note folder when the setting is empty", () => {
    expect(resolveImageFolder(note, "")).toEqual({
      folder: "notes/daily",
      base: "note",
    });
    expect(resolveImageFolder(note, "   ").folder).toBe("notes/daily");
  });

  it("resolves ./ against the note folder", () => {
    expect(resolveImageFolder(note, "./assets")).toEqual({
      folder: "notes/daily/assets",
      base: "note",
    });
  });

  it("resolves ../ against the note folder", () => {
    expect(resolveImageFolder(note, "../assets")).toEqual({
      folder: "notes/assets",
      base: "note",
    });
    expect(resolveImageFolder(note, "../../assets").folder).toBe("assets");
  });

  it("treats a leading slash as vault-absolute", () => {
    expect(resolveImageFolder(note, "/assets")).toEqual({
      folder: "assets",
      base: "vault",
    });
    expect(resolveImageFolder(note, "/images/2026").folder).toBe("images/2026");
  });

  it("treats a bare path as vault-relative by default", () => {
    expect(resolveImageFolder(note, "assets")).toEqual({
      folder: "assets",
      base: "vault",
    });
  });

  it("accepts Windows separators", () => {
    expect(resolveImageFolder(note, ".\\assets\\img").folder).toBe(
      "notes/daily/assets/img"
    );
  });

  it("handles a note at the vault root", () => {
    expect(resolveImageFolder("note.md", "./assets").folder).toBe("assets");
    expect(resolveImageFolder("note.md", "").folder).toBe("");
  });

  it("throws when ../ climbs above the vault", () => {
    expect(() => resolveImageFolder("note.md", "../../x")).toThrow(
      PathResolutionError
    );
  });
});

describe("sanitizeFileName", () => {
  it("replaces illegal characters", () => {
    expect(sanitizeFileName('a:b*c?d"e<f>g|h')).toBe("a-b-c-d-e-f-g-h");
  });

  it("collapses whitespace into single dashes", () => {
    expect(sanitizeFileName("my  pasted   image")).toBe("my-pasted-image");
  });

  it("keeps Chinese characters intact", () => {
    expect(sanitizeFileName("截图 2026")).toBe("截图-2026");
  });

  it("never returns an empty name", () => {
    expect(sanitizeFileName("...")).toBe("image");
    expect(sanitizeFileName("")).toBe("image");
  });

  it("keeps dots inside the name", () => {
    expect(sanitizeFileName("v1.2.screenshot")).toBe("v1.2.screenshot");
  });
});

describe("formatTimestamp", () => {
  it("produces a sortable, filesystem-safe stamp", () => {
    const date = new Date(2026, 10, 12, 9, 5, 3, 47);
    expect(formatTimestamp(date)).toBe("20261112-090503047");
  });
});

describe("buildUniquePath", () => {
  it("uses the plain name when free", () => {
    expect(buildUniquePath("assets", "image-1", "png", () => false)).toBe(
      "assets/image-1.png"
    );
  });

  it("appends a counter on collision", () => {
    const taken = new Set(["assets/image-1.png", "assets/image-1-1.png"]);
    expect(buildUniquePath("assets", "image-1", "png", (p) => taken.has(p))).toBe(
      "assets/image-1-2.png"
    );
  });

  it("normalizes the extension", () => {
    expect(buildUniquePath("assets", "a", ".PNG", () => false)).toBe("assets/a.PNG");
    expect(buildUniquePath("", "a", "jpg", () => false)).toBe("a.jpg");
  });
});

describe("relativeFromNote", () => {
  it("returns the in-folder relative path", () => {
    expect(relativeFromNote("notes/a.md", "notes/assets/x.png")).toBe("assets/x.png");
  });

  it("climbs out of the note folder", () => {
    expect(relativeFromNote("notes/daily/a.md", "assets/x.png")).toBe(
      "../../assets/x.png"
    );
  });

  it("handles the vault root", () => {
    expect(relativeFromNote("a.md", "assets/x.png")).toBe("assets/x.png");
  });
});

describe("buildImageLink", () => {
  it("builds a markdown link relative to the note", () => {
    expect(
      buildImageLink({
        notePath: "notes/daily/a.md",
        imagePath: "notes/daily/assets/img.png",
        style: "markdown",
      })
    ).toBe("![](assets/img.png)");
  });

  it("builds a wiki embed with the vault path", () => {
    expect(
      buildImageLink({
        notePath: "notes/daily/a.md",
        imagePath: "notes/daily/assets/img.png",
        style: "wiki",
      })
    ).toBe("![[notes/daily/assets/img.png]]");
  });

  it("supports alt text", () => {
    expect(
      buildImageLink({
        notePath: "a.md",
        imagePath: "assets/img.png",
        style: "markdown",
        alt: "截图",
      })
    ).toBe("![截图](assets/img.png)");
    expect(
      buildImageLink({
        notePath: "a.md",
        imagePath: "assets/img.png",
        style: "wiki",
        alt: "截图",
      })
    ).toBe("![[assets/img.png|截图]]");
  });

  it("percent-encodes spaces and CJK file names", () => {
    expect(
      buildImageLink({
        notePath: "a.md",
        imagePath: "assets/my image 截图.png",
        style: "markdown",
      })
    ).toBe("![](assets/my%20image%20%E6%88%AA%E5%9B%BE.png)");
  });
});

describe("inferExtension", () => {
  it("maps known mime types", () => {
    expect(inferExtension("image/png")).toBe("png");
    expect(inferExtension("image/jpeg")).toBe("jpg");
    expect(inferExtension("IMAGE/WEBP")).toBe("webp");
  });

  it("falls back to the file name", () => {
    expect(inferExtension("application/octet-stream", "shot.jpeg")).toBe("jpg");
  });

  it("defaults to png", () => {
    expect(inferExtension("", undefined)).toBe("png");
    expect(inferExtension("application/octet-stream", "blob")).toBe("png");
  });
});

describe("normalizeSettings", () => {
  it("returns defaults for missing data", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps the default relative assets folder", () => {
    expect(DEFAULT_SETTINGS.imageFolder).toBe("./assets");
  });

  it("trims user input and maps . / / to empty", () => {
    expect(normalizeSettings({ imageFolder: "  ./img  " }).imageFolder).toBe("./img");
    expect(normalizeSettings({ imageFolder: "." }).imageFolder).toBe("");
    expect(normalizeSettings({ imageFolder: "/" }).imageFolder).toBe("");
  });

  it("rejects invalid link styles", () => {
    expect(normalizeSettings({ linkStyle: "html" }).linkStyle).toBe("markdown");
    expect(normalizeSettings({ linkStyle: "wiki" }).linkStyle).toBe("wiki");
  });

  it("treats a blank template as empty (keep original file name)", () => {
    expect(normalizeSettings({ fileNameTemplate: "   " }).fileNameTemplate).toBe(
      ""
    );
    expect(DEFAULT_SETTINGS.fileNameTemplate).toBe("");
  });
});

describe("expandFileNameTemplate", () => {
  const ctx = {
    timestamp: "20261112-090503047",
    originalName: "Screenshot 2026.png",
    noteName: "日报",
  };

  it("expands every placeholder", () => {
    expect(expandFileNameTemplate("{date}-{time}-{name}-{note}", ctx)).toBe(
      "20261112-090503047-Screenshot 2026-日报"
    );
  });

  it("uses the raw name without extension", () => {
    expect(expandFileNameTemplate("{name}", ctx)).toBe("Screenshot 2026");
  });

  it("leaves plain templates untouched", () => {
    expect(expandFileNameTemplate("img-{timestamp}", ctx)).toBe(
      "img-20261112-090503047"
    );
  });
});
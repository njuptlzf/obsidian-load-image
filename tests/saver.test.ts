import { describe, expect, it } from "vitest";
import { VaultPort, ensureFolder, saveImage } from "../src/saver";
import { DEFAULT_SETTINGS, LoadImageSettings } from "../src/settings";

/**
 * In-memory vault that mimics the Obsidian API surface used by the saver.
 * Records folder creations and binary writes so tests can assert on effects.
 */
class FakeVault implements VaultPort {
  files = new Map<string, unknown>();
  folders = new Set<string>();
  createdFolders: string[] = [];
  binaryWrites: { path: string; size: number }[] = [];
  /** Inject failures to exercise error handling. */
  failFolderCreate = false;

  getAbstractFileByPath(path: string): unknown {
    if (this.folders.has(path)) return { kind: "folder", path };
    if (this.files.has(path)) return this.files.get(path);
    return null;
  }

  isFolder(entry: unknown): boolean {
    return (
      typeof entry === "object" &&
      entry !== null &&
      (entry as { kind?: string }).kind === "folder"
    );
  }

  async createFolder(path: string): Promise<unknown> {
    if (this.failFolderCreate) throw new Error("EACCES: permission denied");
    this.folders.add(path);
    this.createdFolders.push(path);
    return { kind: "folder", path };
  }

  async createBinary(path: string, data: ArrayBuffer): Promise<unknown> {
    const entry = { kind: "file", path };
    this.files.set(path, entry);
    this.binaryWrites.push({ path, size: data.byteLength });
    return entry;
  }

  /** Seed a folder plus all of its ancestors, like a real vault tree. */
  seedFolder(path: string): void {
    const segments = path.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      this.folders.add(current);
    }
  }

  seedFile(path: string): void {
    this.files.set(path, { kind: "file", path });
  }
}

/** Minimal stand-in for a clipboard File. */
function imageFile(name = "image.png", type = "image/png", bytes = 8): File {
  return {
    name,
    type,
    size: bytes,
    arrayBuffer: async () => new ArrayBuffer(bytes),
  } as unknown as File;
}

const settings = (
  overrides: Partial<LoadImageSettings> = {}
): LoadImageSettings => ({
  ...DEFAULT_SETTINGS,
  // Most tests assert on deterministic timestamp names; the shipped default
  // (empty = original file name) is covered by its own test below.
  fileNameTemplate: "image-{timestamp}",
  ...overrides,
});

describe("ensureFolder", () => {
  it("creates every missing segment in order", async () => {
    const vault = new FakeVault();
    await ensureFolder(vault, "a/b/c");
    expect(vault.createdFolders).toEqual(["a", "a/b", "a/b/c"]);
  });

  it("skips folders that already exist", async () => {
    const vault = new FakeVault();
    vault.seedFolder("a");
    await ensureFolder(vault, "a/b");
    expect(vault.createdFolders).toEqual(["a/b"]);
  });

  it("does nothing for the vault root", async () => {
    const vault = new FakeVault();
    await ensureFolder(vault, "");
    expect(vault.createdFolders).toEqual([]);
  });

  it("refuses to shadow an existing file", async () => {
    const vault = new FakeVault();
    vault.seedFile("a");
    await expect(ensureFolder(vault, "a/b")).rejects.toThrow(
      /is occupied by a file with the same name/
    );
  });

  it("propagates a real creation failure", async () => {
    const vault = new FakeVault();
    vault.failFolderCreate = true;
    await expect(ensureFolder(vault, "a")).rejects.toThrow(/permission denied/);
  });
});

describe("saveImage — folder resolution", () => {
  it("saves next to the note when the setting is empty", async () => {
    const vault = new FakeVault();
    vault.seedFolder("notes/daily");

    const result = await saveImage(vault, imageFile(), {
      notePath: "notes/daily/2026-11-12.md",
      settings: settings({ imageFolder: "" }),
      now: new Date(2026, 10, 12, 9, 5, 3, 47),
    });

    expect(result.folder).toBe("notes/daily");
    expect(result.imagePath).toBe("notes/daily/image-20261112-090503047.png");
    expect(result.link).toBe("![](image-20261112-090503047.png)");
    expect(vault.createdFolders).toEqual([]);
  });

  it("saves into ./assets relative to the note by default", async () => {
    const vault = new FakeVault();
    vault.seedFolder("notes/daily");

    const result = await saveImage(vault, imageFile(), {
      notePath: "notes/daily/2026-11-12.md",
      settings: settings(),
      now: new Date(2026, 10, 12, 9, 5, 3, 47),
    });

    expect(result.imagePath).toBe(
      "notes/daily/assets/image-20261112-090503047.png"
    );
    expect(result.link).toBe("![](assets/image-20261112-090503047.png)");
    expect(vault.createdFolders).toEqual(["notes/daily/assets"]);
  });

  it("creates a deep relative folder tree", async () => {
    const vault = new FakeVault();
    vault.seedFolder("a/b"); // the note's own folder always exists
    const result = await saveImage(vault, imageFile(), {
      notePath: "a/b/note.md",
      settings: settings({ imageFolder: "./img/pasted/2026" }),
    });

    expect(result.folder).toBe("a/b/img/pasted/2026");
    expect(vault.createdFolders).toEqual([
      "a/b/img",
      "a/b/img/pasted",
      "a/b/img/pasted/2026",
    ]);
  });

  it("saves into a vault-absolute folder", async () => {
    const vault = new FakeVault();
    const result = await saveImage(vault, imageFile(), {
      notePath: "notes/deep/note.md",
      settings: settings({ imageFolder: "/assets/img" }),
    });

    expect(result.imagePath.startsWith("assets/img/")).toBe(true);
    expect(result.link.startsWith("![](../../assets/img/")).toBe(true);
    expect(vault.createdFolders).toEqual(["assets", "assets/img"]);
  });

  it("handles a note at the vault root", async () => {
    const vault = new FakeVault();
    const result = await saveImage(vault, imageFile(), {
      notePath: "note.md",
      settings: settings({ imageFolder: "" }),
    });
    expect(result.imagePath.startsWith("image-")).toBe(true);
  });
});

describe("saveImage — file naming", () => {
  it("writes the actual bytes from the clipboard file", async () => {
    const vault = new FakeVault();
    await saveImage(vault, imageFile("x.png", "image/png", 128), {
      notePath: "n.md",
      settings: settings({ imageFolder: "" }),
    });
    expect(vault.binaryWrites[0].size).toBe(128);
  });

  it("derives the extension from the mime type", async () => {
    const vault = new FakeVault();
    const result = await saveImage(vault, imageFile("blob", "image/jpeg"), {
      notePath: "n.md",
      settings: settings({ imageFolder: "" }),
      now: new Date(2026, 10, 12, 1, 2, 3, 4),
    });
    expect(result.imagePath.endsWith(".jpg")).toBe(true);
  });

  it("avoids overwriting an existing file", async () => {
    const vault = new FakeVault();
    vault.seedFile("assets/image-20261112-090503047.png");

    const result = await saveImage(vault, imageFile(), {
      notePath: "n.md",
      settings: settings({ imageFolder: "assets" }),
      now: new Date(2026, 10, 12, 9, 5, 3, 47),
    });

    expect(result.imagePath).toBe("assets/image-20261112-090503047-1.png");
  });

  it("avoids collisions inside one paste batch via the reserved set", async () => {
    const vault = new FakeVault();
    const reserved = new Set<string>();
    const now = new Date(2026, 10, 12, 9, 5, 3, 47);
    const opts = {
      notePath: "n.md",
      settings: settings({ imageFolder: "assets" }),
      reserved,
      now,
    };

    const first = await saveImage(vault, imageFile(), opts);
    const second = await saveImage(vault, imageFile(), opts);

    expect(first.imagePath).toBe("assets/image-20261112-090503047.png");
    expect(second.imagePath).toBe("assets/image-20261112-090503047-1.png");
  });

  it("sanitizes template output into a safe file name", async () => {
    const vault = new FakeVault();
    const result = await saveImage(vault, imageFile("a:b?.png"), {
      notePath: "n.md",
      settings: settings({ imageFolder: "", fileNameTemplate: "{note}" }),
    });
    expect(result.imagePath).toBe("n.png");
  });

  it("keeps the original file name when the template is empty (shipped default)", async () => {
    const vault = new FakeVault();
    const result = await saveImage(vault, imageFile("Screenshot 2026-11-12 135007.png"), {
      notePath: "n.md",
      settings: { ...DEFAULT_SETTINGS, imageFolder: "" },
    });
    expect(result.imagePath).toBe("Screenshot-2026-11-12-135007.png");
  });

  it("falls back to image.png for anonymous clipboard files with empty template", async () => {
    const vault = new FakeVault();
    const result = await saveImage(vault, imageFile(""), {
      notePath: "n.md",
      settings: { ...DEFAULT_SETTINGS, imageFolder: "" },
    });
    expect(result.imagePath).toBe("image.png");
  });
});

describe("saveImage — link styles", () => {
  it("inserts a wiki embed with the vault path", async () => {
    const vault = new FakeVault();
    const result = await saveImage(vault, imageFile(), {
      notePath: "notes/note.md",
      settings: settings({ imageFolder: "./assets", linkStyle: "wiki" }),
      now: new Date(2026, 10, 12, 9, 5, 3, 47),
    });
    expect(result.link).toBe("![[notes/assets/image-20261112-090503047.png]]");
  });

  it("produces a link that resolves relative to the note", async () => {
    const vault = new FakeVault();
    const result = await saveImage(vault, imageFile(), {
      notePath: "a/b/c.md",
      settings: settings({ imageFolder: "/media" }),
    });
    // ../../media/<name>.png from a/b/ -> vault-relative media/<name>.png
    const match = /^!\[.*\]\(\.\.\/\.\.\/media\/(.+)\)$/.exec(result.link);
    expect(match?.[1]).toBe(result.imagePath.replace("media/", ""));
  });
});

describe("saveImage — failure handling", () => {
  it("surfaces a folder creation error and writes nothing", async () => {
    const vault = new FakeVault();
    vault.failFolderCreate = true;

    await expect(
      saveImage(vault, imageFile(), {
        notePath: "n.md",
        settings: settings({ imageFolder: "assets" }),
      })
    ).rejects.toThrow(/permission denied/);

    expect(vault.binaryWrites).toHaveLength(0);
  });

  it("rejects paths escaping the vault", async () => {
    const vault = new FakeVault();
    await expect(
      saveImage(vault, imageFile(), {
        notePath: "n.md",
        settings: settings({ imageFolder: "../../outside" }),
      })
    ).rejects.toThrow(/goes outside the Obsidian vault root/);
  });
});
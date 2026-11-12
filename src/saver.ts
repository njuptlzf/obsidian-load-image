/**
 * Service layer: persists a clipboard image into the vault.
 *
 * Only depends on a tiny `VaultPort` interface instead of the Obsidian `Vault`
 * class, so the whole pipeline (folder resolution -> dir creation -> unique
 * naming -> binary write -> link building) can be exercised in tests with a
 * fake vault, no Obsidian runtime required.
 */

import {
  buildImageLink,
  buildUniquePath,
  formatTimestamp,
  inferExtension,
  joinVaultPath,
  resolveImageFolder,
} from "./paths";
import { LoadImageSettings, expandFileNameTemplate } from "./settings";
import { t } from "./i18n";

/** The subset of `obsidian.Vault` this service needs. */
export interface VaultPort {
  /** Returns a truthy entry when the path exists, otherwise null. */
  getAbstractFileByPath(path: string): unknown;
  createFolder(path: string): Promise<unknown>;
  createBinary(path: string, data: ArrayBuffer): Promise<unknown>;
  isFolder(entry: unknown): boolean;
}

export interface SaveImageOptions {
  /** Vault-relative path of the note that receives the image. */
  notePath: string;
  settings: LoadImageSettings;
  /** Paths already claimed in this batch (same-millisecond pastes). */
  reserved?: Set<string>;
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

export interface SaveImageResult {
  /** Vault-relative path of the created file. */
  imagePath: string;
  /** Text inserted at the cursor. */
  link: string;
  /** Vault-relative folder that received the file. */
  folder: string;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Create `folder` and every missing parent inside the vault.
 * Walks segment by segment because `createFolder` does not guarantee
 * intermediate directories on every platform.
 */
export async function ensureFolder(vault: VaultPort, folder: string): Promise<void> {
  if (!folder) return;

  const segments = folder.split("/").filter(Boolean);
  let current = "";

  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    const existing = vault.getAbstractFileByPath(current);

    if (existing) {
      if (vault.isFolder(existing)) continue;
      throw new Error(t("error.folderOccupied", { path: current }));
    }

    try {
      await vault.createFolder(current);
    } catch (error) {
      // A concurrent writer may have created it between check and call.
      const created = vault.getAbstractFileByPath(current);
      if (!created || !vault.isFolder(created)) {
        throw toError(error);
      }
    }
  }
}

/** Resolve the target path for the next image, reserving it for this batch. */
export function planImagePath(
  vault: VaultPort,
  reserved: Set<string>,
  notePath: string,
  settings: LoadImageSettings,
  file: { name: string; type: string },
  now: Date = new Date()
): { imagePath: string; folder: string } {
  const { folder } = resolveImageFolder(notePath, settings.imageFolder);
  const timestamp = formatTimestamp(now);

  // Empty template = keep the original clipboard file name.
  const baseName = settings.fileNameTemplate
    .trim()
    ? expandFileNameTemplate(settings.fileNameTemplate, {
        timestamp,
        originalName: file.name,
        noteName: notePath.split("/").pop()?.replace(/\.md$/i, "") ?? "",
      })
    : file.name.replace(/\.[^.]+$/, "") || "image";

  const imagePath = buildUniquePath(
    folder,
    baseName,
    inferExtension(file.type, file.name),
    (candidate) => reserved.has(candidate) || vault.getAbstractFileByPath(candidate) !== null
  );

  return { imagePath, folder };
}

/** Save one image and return the link text for the editor. */
export async function saveImage(
  vault: VaultPort,
  file: File,
  options: SaveImageOptions
): Promise<SaveImageResult> {
  const { notePath, settings } = options;
  const reserved = options.reserved ?? new Set<string>();

  const { imagePath, folder } = planImagePath(
    vault,
    reserved,
    notePath,
    settings,
    file,
    options.now
  );

  // Reserve before the async write so parallel pastes cannot pick the same name.
  reserved.add(imagePath);

  await ensureFolder(vault, folder);
  const buffer = await file.arrayBuffer();
  await vault.createBinary(imagePath, buffer);

  const link = buildImageLink({
    notePath,
    imagePath,
    style: settings.linkStyle,
  });

  return { imagePath, link, folder };
}

/** Best-effort folder description used by the settings preview. */
export function describeTargetFolder(
  notePath: string,
  settings: LoadImageSettings
): { folder: string; display: string; base: "note" | "vault" } {
  const { folder, base } = resolveImageFolder(notePath, settings.imageFolder);
  return {
    folder,
    base,
    display: folder === "" ? t("preview.vaultRoot") : joinVaultPath(folder),
  };
}
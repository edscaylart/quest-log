import { open, save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

/** A file type for the picker, e.g. { name: "PDF", extension: "pdf" }. */
export type FileType = { name: string; extension: string };

const filters = (type: FileType) => [{ name: type.name, extensions: [type.extension] }];

/** Asks where to save; null when cancelled. */
export const pickSavePath = (defaultPath: string, type: FileType) => save({ defaultPath, filters: filters(type) });

/** Asks for a file to open; null when cancelled. */
export const pickFile = (type: FileType) => open({ filters: filters(type) });

/** Asks where to save, then writes `bytes()`; cancelling builds and writes nothing. True when saved. */
export async function saveBytes(defaultPath: string, type: FileType, bytes: () => Promise<Uint8Array>) {
  const path = await pickSavePath(defaultPath, type);
  if (!path) return false;
  await writeFile(path, await bytes());
  return true;
}

// Hand-mirrored from src-tauri/src/core/progress.rs. Canonical domain terms only.

/** XP is one per tracked minute; `levelXp`/`nextLevelXp` bound the current Level. */
export type Progress = { level: number; xp: number; levelXp: number; nextLevelXp: number; /** A new highest Level not yet celebrated. */ levelUp: number | null };

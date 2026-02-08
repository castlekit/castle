import { NextResponse } from "next/server";
import { existsSync, statSync, readdirSync } from "fs";
import { join } from "path";
import { getCastleDir } from "@/lib/config";
import { getStorageStats } from "@/lib/db/queries";
import { getDbPath } from "@/lib/db/index";

/**
 * Recursively calculate total size of a directory.
 */
function getDirSize(dir: string): number {
  if (!existsSync(dir)) return 0;

  let total = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += getDirSize(fullPath);
    } else {
      try {
        total += statSync(fullPath).size;
      } catch {
        // Skip files we can't stat
      }
    }
  }
  return total;
}

// ============================================================================
// GET /api/openclaw/chat/storage — Storage stats
// ============================================================================

export async function GET() {
  try {
    const stats = getStorageStats();

    // Get actual DB file size
    const dbPath = getDbPath();
    let dbSizeBytes = 0;
    if (existsSync(dbPath)) {
      dbSizeBytes = statSync(dbPath).size;
    }

    // Get actual attachments directory size
    const attachmentsDir = join(getCastleDir(), "data", "attachments");
    const attachmentsDirSize = getDirSize(attachmentsDir);

    // Define warning thresholds
    const WARN_DB_SIZE = 500 * 1024 * 1024;       // 500MB
    const WARN_ATTACHMENTS = 2 * 1024 * 1024 * 1024; // 2GB
    const warnings: string[] = [];

    if (dbSizeBytes > WARN_DB_SIZE) {
      warnings.push(`Database is ${(dbSizeBytes / 1024 / 1024).toFixed(0)}MB — consider archiving old messages`);
    }
    if (attachmentsDirSize > WARN_ATTACHMENTS) {
      warnings.push(`Attachments using ${(attachmentsDirSize / 1024 / 1024 / 1024).toFixed(1)}GB of disk space`);
    }

    return NextResponse.json({
      ...stats,
      dbSizeBytes,
      attachmentsDirBytes: attachmentsDirSize,
      warnings,
    });
  } catch (err) {
    console.error("[Storage] Stats failed:", (err as Error).message);
    return NextResponse.json(
      { error: "Failed to get storage stats" },
      { status: 500 }
    );
  }
}

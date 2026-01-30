import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import { getEnv, mustGetEnv } from "./env";

const DEBUG_INGEST =
  "http://127.0.0.1:7243/ingest/9acac06f-fa87-45a6-af60-73458650b939";
const DEBUG_LOG_PATH = path.join(process.cwd(), ".cursor", "debug.log");
function debugLog(payload: Record<string, unknown>) {
  const line =
    JSON.stringify({
      ...payload,
      timestamp: Date.now(),
      sessionId: "debug-session",
    }) + "\n";
  fetch(DEBUG_INGEST, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: line.trim(),
  }).catch(() => {});
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, line);
  } catch {
    // ignore
  }
}

export type DriveReport = {
  name: string;
  url: string;
  lastUpdated: string;
  author?: string;
};

function getDriveClient() {
  // Service account JSON (целиком) кладём в env как строку.
  // В Vercel это удобно хранить в переменной окружения.
  const credsRaw = mustGetEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  const creds = JSON.parse(credsRaw);

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  return google.drive({ version: "v3", auth });
}

/** Собирает ID папки и всех подпапок рекурсивно (поиск отчётов во вложенных папках). */
async function listFolderIdsRecursive(
  drive: ReturnType<typeof getDriveClient>,
  parentId: string,
): Promise<string[]> {
  const ids: string[] = [parentId];
  let pageToken: string | undefined = undefined;

  do {
    const resp: any = await drive.files.list({
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      pageSize: 100,
      pageToken,
      fields: "nextPageToken, files(id)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    } as any);

    for (const f of resp.data.files || []) {
      if (f.id) {
        const childIds = await listFolderIdsRecursive(drive, f.id);
        ids.push(...childIds);
      }
    }

    pageToken = resp.data.nextPageToken || undefined;
  } while (pageToken);

  return ids;
}

export async function collectReports(days: number): Promise<DriveReport[]> {
  // #region agent log
  debugLog({
    location: "lib/googleDrive.ts:collectReports:entry",
    message: "collectReports entry (first line)",
    data: { days },
    hypothesisId: "H1-H2",
  });
  // #endregion

  const folderId = mustGetEnv("FOLDER_ID");
  const drive = getDriveClient();

  // Не фильтруем по modifiedTime: при добавлении строк (колонка «Отметка времени»)
  // метаданные файла в Drive могут не обновляться — берём все таблицы «(Ответы)» в папке.
  // Параметр days оставлен для совместимости и текста в боте («за последние N дн.»).

  const folderIds = await listFolderIdsRecursive(drive, folderId);

  // #region agent log
  debugLog({
    location: "lib/googleDrive.ts:collectReports:afterListFolders",
    message: "folder ids listed",
    data: {
      folderIdsCount: folderIds.length,
      firstTwoIds: folderIds.slice(0, 2),
    },
    hypothesisId: "H2",
  });
  // #endregion

  const seenIds = new Set<string>();
  const out: DriveReport[] = [];

  let totalFromApi = 0;
  let skippedNoOtveti = 0;
  let skippedOther = 0;
  let firstFileSample: { name?: string; modifiedTime?: string } | null = null;

  for (const fid of folderIds) {
    const q = `'${fid}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;

    let pageToken: string | undefined = undefined;

    do {
      const resp: any = await drive.files.list({
        q,
        pageSize: 100,
        pageToken,
        fields:
          "nextPageToken, files(id,name,modifiedTime,webViewLink,owners(displayName))",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      } as any);

      const files = resp.data.files || [];
      totalFromApi += files.length;
      if (files.length > 0 && !firstFileSample)
        firstFileSample = {
          name: files[0].name,
          modifiedTime: files[0].modifiedTime,
        };

      for (const f of files) {
        if (!f.id || seenIds.has(f.id)) continue;
        if (!f.webViewLink || !f.modifiedTime || !f.name) {
          skippedOther++;
          continue;
        }
        // Подстрока в названии: по умолчанию «(Ответы)»; можно задать REPORT_NAME_SUBSTRING в .env (например «Ответы»)
        const nameSubstring =
          (getEnv("REPORT_NAME_SUBSTRING") || "").trim() || "(Ответы)";
        if (!f.name.includes(nameSubstring)) {
          skippedNoOtveti++;
          continue;
        }
        seenIds.add(f.id);
        out.push({
          name: f.name,
          url: f.webViewLink,
          lastUpdated: f.modifiedTime,
          author: f.owners?.[0]?.displayName,
        });
      }

      pageToken = resp.data.nextPageToken || undefined;
    } while (pageToken);
  }

  // #region agent log
  debugLog({
    location: "lib/googleDrive.ts:collectReports:afterQueries",
    message: "drive queries done",
    data: {
      totalFromApi,
      skippedNoOtveti,
      skippedOther,
      outCount: out.length,
      firstFileSample,
    },
    hypothesisId: "H3-H4-H5",
  });
  // #endregion

  out.sort(
    (a, b) =>
      new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime(),
  );

  // #region agent log
  debugLog({
    location: "lib/googleDrive.ts:collectReports:exit",
    message: "collectReports exit",
    data: { reportsCount: out.length },
    hypothesisId: "all",
  });
  // #endregion
  return out;
}

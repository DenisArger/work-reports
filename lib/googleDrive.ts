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
  id: string;
  name: string;
  url: string;
  lastUpdated: string;
  author?: string;
};

const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
];

function getAuth() {
  const credsRaw = mustGetEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  const creds = JSON.parse(credsRaw);
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: SCOPES,
  });
}

function getDriveClient() {
  return google.drive({ version: "v3", auth: getAuth() });
}

function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

/** Читает первый лист таблицы: первая строка — заголовки, остальные — данные. */
async function getSheetValues(
  spreadsheetId: string,
): Promise<{ headers: string[]; rows: string[][] }> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "A1:ZZ1000",
  });
  const raw = (res.data.values || []) as string[][];
  if (raw.length === 0) return { headers: [], rows: [] };
  const headers = raw[0].map((c) => String(c ?? "").trim());
  const rows = raw
    .slice(1)
    .map((row) => headers.map((_, i) => String(row[i] ?? "").trim()));
  return { headers, rows };
}

const TIMESTAMP_HEADER = "Отметка времени";

function parseTimestamp(value: string): Date | null {
  if (!value || !value.trim()) return null;
  const s = value.trim();
  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return new Date(iso);
  const ru = s.match(
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/,
  );
  if (ru) {
    const [, d, m, y, h, min, sec] = ru;
    const date = new Date(
      parseInt(y!, 10),
      parseInt(m!, 10) - 1,
      parseInt(d!, 10),
      parseInt(h!, 10),
      parseInt(min!, 10),
      parseInt(sec || "0", 10),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export type UnifiedReportRow = {
  date: string;
  source: string;
  cells: string[];
};

export type UnifiedReportHeaders = string[];

/** Собирает данные из листов «(Ответы)», фильтрует по колонке «Отметка времени» за последние days дней. */
export async function collectReportsData(
  days: number,
): Promise<{ headers: UnifiedReportHeaders; rows: UnifiedReportRow[] }> {
  const reports = await collectReports(days);
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const allHeaders: UnifiedReportHeaders = [];
  const allRows: UnifiedReportRow[] = [];

  for (const r of reports) {
    let sheet: { headers: string[]; rows: string[][] };
    try {
      sheet = await getSheetValues(r.id);
    } catch {
      continue;
    }
    if (sheet.headers.length === 0 || sheet.rows.length === 0) continue;

    const tsIndex = sheet.headers.findIndex(
      (h) => h === TIMESTAMP_HEADER || h.trim() === TIMESTAMP_HEADER,
    );
    if (tsIndex < 0) continue;

    const otherHeaders = sheet.headers.filter((_, i) => i !== tsIndex);
    if (allHeaders.length === 0) allHeaders.push(...otherHeaders);

    for (const row of sheet.rows) {
      const tsVal = row[tsIndex];
      const date = parseTimestamp(tsVal);
      if (!date || date < since) continue;
      const dateStr = date.toISOString().slice(0, 16).replace("T", " ");
      const cells = row.filter((_, i) => i !== tsIndex);
      allRows.push({
        date: dateStr,
        source: r.name,
        cells,
      });
    }
  }

  return { headers: allHeaders, rows: allRows };
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
          id: f.id,
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

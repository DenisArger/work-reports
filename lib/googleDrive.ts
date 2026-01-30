import { google } from "googleapis";
import { mustGetEnv } from "./env";

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
  const folderId = mustGetEnv("FOLDER_ID");
  const drive = getDriveClient();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString();

  const folderIds = await listFolderIdsRecursive(drive, folderId);

  const seenIds = new Set<string>();
  const out: DriveReport[] = [];

  for (const fid of folderIds) {
    const q = `'${fid}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and modifiedTime > '${cutoffIso}' and trashed=false`;

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

      for (const f of resp.data.files || []) {
        if (!f.id || seenIds.has(f.id)) continue;
        if (!f.webViewLink || !f.modifiedTime || !f.name) continue;
        // Только таблицы с ответами из форм (название содержит «(Ответы)»)
        if (!f.name.includes("(Ответы)")) continue;
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

  out.sort(
    (a, b) =>
      new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime(),
  );
  return out;
}

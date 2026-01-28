import { google } from 'googleapis';
import { mustGetEnv } from './env.js';
function getDriveClient() {
    // Service account JSON (целиком) кладём в env как строку.
    // В Vercel это удобно хранить в переменной окружения.
    const credsRaw = mustGetEnv('GOOGLE_SERVICE_ACCOUNT_JSON');
    const creds = JSON.parse(credsRaw);
    const auth = new google.auth.GoogleAuth({
        credentials: creds,
        scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });
    return google.drive({ version: 'v3', auth });
}
export async function collectReports(days) {
    const folderId = mustGetEnv('FOLDER_ID');
    const drive = getDriveClient();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffIso = cutoff.toISOString();
    const q = `'${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and modifiedTime > '${cutoffIso}' and trashed=false`;
    const out = [];
    let pageToken = undefined;
    do {
        const resp = await drive.files.list({
            q,
            pageSize: 100,
            pageToken,
            fields: 'nextPageToken, files(id,name,modifiedTime,webViewLink,owners(displayName))',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });
        for (const f of resp.data.files || []) {
            if (!f.webViewLink || !f.modifiedTime || !f.name)
                continue;
            out.push({
                name: f.name,
                url: f.webViewLink,
                lastUpdated: f.modifiedTime,
                author: f.owners?.[0]?.displayName
            });
        }
        pageToken = resp.data.nextPageToken || undefined;
    } while (pageToken);
    out.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
    return out;
}

/**
 * Создаёт сводный отчёт за последние 7 дней и возвращает URL документа или null.
 * FOLDER_ID можно задать в свойствах проекта (ScriptApp.getScriptProperties().getProperty("FOLDER_ID"))
 * или оставить захардкоженным ниже.
 */
function collectReportsFromLastWeek() {
  const folderId =
    PropertiesService.getScriptProperties().getProperty("FOLDER_ID") ||
    "1R2xsrh6W8s8eAiidtAABfNLnxcth8N3o";
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();
  const today = new Date();
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(today.getDate() - 6);

  const table = [["Имя", "Что сделано", "Нужна ли помощь", "Планы на неделю"]];

  function stripTime(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  let fileCount = 0;

  if (!files.hasNext()) {
    Logger.log("❌ В папке нет файлов.");
    return null;
  }

  while (files.hasNext()) {
    const file = files.next();
    fileCount++;

    const name = file.getName().split(".")[0];

    // Пропускаем файлы, которые не являются Google Sheets
    if (file.getMimeType() !== MimeType.GOOGLE_SHEETS) {
      continue;
    }

    const spreadsheet = SpreadsheetApp.openById(file.getId());
    const sheet = spreadsheet.getSheets()[0];
    const data = sheet.getDataRange().getValues();

    const header = data[0];
    const timeIdx = header.findIndex((h) =>
      h.toString().toLowerCase().includes("отметка времени"),
    );
    const doneIdx = header.findIndex((h) =>
      h.toString().toLowerCase().includes("что было сделано"),
    );
    const helpIdx = header.findIndex((h) =>
      h.toString().toLowerCase().includes("нужна ли какая-то помощь"),
    );
    const planIdx = header.findIndex((h) =>
      h.toString().toLowerCase().includes("какие планы"),
    );

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rawDate = row[timeIdx];

      if (!rawDate) continue;

      let parsedDate;

      if (typeof rawDate === "string") {
        parsedDate = new Date(
          rawDate.replace(/(\d{2})\.(\d{2})\.(\d{4})/, "$2/$1/$3"),
        );
      } else if (typeof rawDate === "number") {
        parsedDate = new Date(
          Date.UTC(1899, 11, 30) + rawDate * 24 * 60 * 60 * 1000,
        );
      } else {
        parsedDate = new Date(rawDate);
      }

      if (isNaN(parsedDate)) {
        continue;
      }

      const d = stripTime(parsedDate);
      const from = stripTime(oneWeekAgo);
      const to = stripTime(today);

      if (d >= from && d <= to) {
        table.push([
          name,
          row[doneIdx] || "",
          row[helpIdx] || "",
          row[planIdx] || "",
        ]);
      }
    }
  }

  if (fileCount === 0) {
    Logger.log("❌ Нет файлов для обработки.");
  }

  // Если только заголовок — данных нет
  if (table.length <= 1) {
    return null;
  }

  // Получаем папку "Отчеты" или создаем её, если она не существует
  let reportFolder;
  const folders = folder.getFoldersByName("Отчеты");
  if (folders.hasNext()) {
    reportFolder = folders.next();
    Logger.log('Папка "Отчеты" найдена');
  } else {
    reportFolder = folder.createFolder("Отчеты");
    Logger.log('Папка "Отчеты" была создана');
  }

  // Форматирование даты для имени документа
  const dateFormatted = Utilities.formatDate(
    today,
    Session.getScriptTimeZone(),
    "yyyy-MM-dd",
  );
  const docName = "Сводный отчет " + dateFormatted;

  // Создание документа и добавление данных в таблицу
  const doc = DocumentApp.create(docName);
  const body = doc.getBody();
  const wordTable = body.appendTable(table);
  wordTable.getRow(0).editAsText().setBold(true);

  // Перемещаем документ в папку "Отчеты"
  const docFile = DriveApp.getFileById(doc.getId());
  reportFolder.addFile(docFile);
  DriveApp.getRootFolder().removeFile(docFile); // Убираем файл из корня

  const url = doc.getUrl();
  Logger.log("✅ Отчет успешно создан: " + url);
  return url;
}

/**
 * Web App: POST с телом JSON { "token": "секрет" }.
 * Вызывает collectReportsFromLastWeek() и возвращает JSON { "url": "..." } или { "error": "..." }.
 * Секрет задаётся в Script Properties: APPS_SCRIPT_SECRET.
 */
function doPost(e) {
  let token = (e && e.parameter && e.parameter.token) || "";
  if (!token && e && e.postData && e.postData.contents) {
    try {
      const body = JSON.parse(e.postData.contents);
      token = body.token || "";
    } catch (err) {
      // ignore
    }
  }
  const secret =
    PropertiesService.getScriptProperties().getProperty("APPS_SCRIPT_SECRET") ||
    "";
  if (secret && token !== secret) {
    return ContentService.createTextOutput(
      JSON.stringify({ error: "Unauthorized" }),
    ).setMimeType(ContentService.MimeType.JSON);
  }
  try {
    const url = collectReportsFromLastWeek();
    if (!url) {
      return ContentService.createTextOutput(
        JSON.stringify({ error: "no_data", url: null }),
      ).setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(
      JSON.stringify({ url: url }),
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ error: String(err.message || err) }),
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

import {ReportError, fail} from "./accounting.mjs";
const DRIVE = "https://www.googleapis.com/drive/v3";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
export function workbookRows(report) {
  return {summary: [["Team", "Month", "Valid Views", "Percent of Site Views"],
    ...report.teams.map((team) => [team.teamName, report.month, team.validViews, report.totalValidViews ? team.validViews / report.totalValidViews : 0]),
    ["TOTAL", report.month, report.totalValidViews, report.totalValidViews ? 1 : 0]],
  mangas: [["Team", "Manga", "Valid Views"], ...report.mangas.map((row) => [row.teamName, row.mangaTitle, row.validViews]), ["TOTAL", "", report.totalValidViews]]};
}
const fileFields = "id,mimeType,parents,appProperties,trashed,ownedByMe,permissions(role,type)";
const safeId = (id) => {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(id)) fail("failed-precondition", "Invalid Google file configuration");
  return encodeURIComponent(id);
};
export function createGoogleExporter({clientId, clientSecret, refreshToken, fetchImpl = fetch, deadline = Date.now() + 480000}) {
  let token; let expires = 0; let checkedFolder;
  function requestSignal() {
    const remaining = deadline - Date.now();
    if (remaining <= 0) fail("deadline-exceeded", "Export time budget exhausted; retry the incomplete report");
    return AbortSignal.timeout(Math.min(20000, remaining));
  }
  async function accessToken() {
    if (token && expires > Date.now() + 60000) return token;
    const response = await fetchImpl("https://oauth2.googleapis.com/token", {method: "POST", signal: requestSignal(),
      body: new URLSearchParams({client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token"})});
    if (!response.ok) throw new ReportError("failed-precondition", "Google authorization needs owner attention");
    const result = await response.json();
    if (!result.access_token) throw new ReportError("failed-precondition", "Google authorization unavailable");
    token = result.access_token; expires = Date.now() + Number(result.expires_in || 3600) * 1000;
    return token;
  }
  async function request(method, url, body) {
    const authorization = await accessToken();
    const response = await fetchImpl(url, {method, signal: requestSignal(), headers: {"Authorization": `Bearer ${authorization}`, "Content-Type": "application/json"},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    if (!response.ok) {
      const error = new ReportError("unavailable", "Google report export failed; check owner access and API configuration");
      // HTTP rejections prove this create did not succeed; timeouts/5xx do not.
      error.definitiveRejection = [400, 401, 403, 404, 422, 429].includes(response.status);
      throw error;
    }
    return response.status === 204 ? {} : response.json();
  }
  async function folder(report) {
    if (checkedFolder === report.driveFolderId) return;
    const row = await request("GET", `${DRIVE}/files/${safeId(report.driveFolderId)}?fields=${encodeURIComponent(fileFields)}`);
    if (row.mimeType !== "application/vnd.google-apps.folder" || row.trashed || !row.ownedByMe || (!Array.isArray(row.permissions) || row.permissions.some((permission) => permission.role !== "owner"))) fail("failed-precondition", "Report folder must be private and owned by the authorized owner");
    checkedFolder = report.driveFolderId;
  }
  async function find(report) {
    await folder(report);
    const q = `trashed = false and appProperties has { key='heliumReportKey' and value='${report.exportKey}' }`;
    const query = new URLSearchParams({q, spaces: "drive", pageSize: "100", fields: "files(id),nextPageToken"});
    const result = await request("GET", `${DRIVE}/files?${query}`);
    if (result.nextPageToken) fail("failed-precondition", "Export files require owner reconciliation");
    return result.files || [];
  }
  async function verify(id, report) {
    await folder(report);
    const row = await request("GET", `${DRIVE}/files/${safeId(id)}?fields=${encodeURIComponent(fileFields)}`);
    if (row.mimeType !== "application/vnd.google-apps.spreadsheet" || row.trashed || !row.ownedByMe || !row.parents?.includes(report.driveFolderId) ||
      row.appProperties?.heliumReportKey !== report.exportKey || row.appProperties?.snapshotHash !== report.snapshotHash || (!Array.isArray(row.permissions) || row.permissions.some((permission) => permission.role !== "owner"))) fail("failed-precondition", "Export file requires owner reconciliation");
    return row;
  }
  async function create(report) {
    return request("POST", `${DRIVE}/files?fields=id`, {name: `HeliumTG Monthly Views - ${report.month}`, mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [report.driveFolderId], appProperties: {heliumReportKey: report.exportKey, snapshotHash: report.snapshotHash}});
  }
  async function populate(id, report) {
    const url = `${SHEETS}/${safeId(id)}`;
    const existing = await request("GET", `${url}?fields=sheets.properties`);
    const titles = ["Team Summary", "Manga Breakdown"];
    const requests = []; const ids = [];
    let nextId = Math.max(0, ...existing.sheets.map((sheet) => sheet.properties.sheetId)) + 1;
    for (const title of titles) {
      const sheet = existing.sheets.find((item) => item.properties.title === title);
      const sheetId = sheet?.properties.sheetId ?? nextId++;
      ids.push(sheetId);
      if (!sheet) requests.push({addSheet: {properties: {sheetId, title}}});
    }
    const rows = workbookRows(report);
    const datasets = [rows.summary, rows.mangas];
    for (let index = 0; index < ids.length; index++) {
      requests.push({updateSheetProperties: {properties: {sheetId: ids[index], gridProperties: {frozenRowCount: 1, rowCount: Math.max(100, datasets[index].length), columnCount: 4}}, fields: "gridProperties"}});
    }
    await request("POST", `${url}:batchUpdate`, {requests});
    // RAW values prevent team/manga names beginning '=' becoming spreadsheet formulas.
    for (const [index, data] of datasets.entries()) {
      for (let offset = 0; offset < data.length; offset += 200) {
        await request("POST", `${url}/values:batchUpdate`, {valueInputOption: "RAW", data: [{range: `'${titles[index]}'!A${offset + 1}`, values: data.slice(offset, offset + 200)}]});
      }
    }
    const formatting = [];
    for (const [index, sheetId] of ids.entries()) {
      const columns = index === 0 ? 4 : 3;
      for (const [startRowIndex, endRowIndex] of [[0, 1], [datasets[index].length - 1, datasets[index].length]]) {
        formatting.push({repeatCell: {range: {sheetId, startRowIndex, endRowIndex, startColumnIndex: 0, endColumnIndex: columns},
          cell: {userEnteredFormat: {textFormat: {bold: true}, backgroundColor: {red: 0.85, green: 0.9, blue: 0.98}}}, fields: "userEnteredFormat"}});
      }
      formatting.push({repeatCell: {range: {sheetId, startRowIndex: 1, endRowIndex: datasets[index].length, startColumnIndex: 2, endColumnIndex: 3},
        cell: {userEnteredFormat: {numberFormat: {type: "NUMBER", pattern: "#,##0"}}}, fields: "userEnteredFormat.numberFormat"}});
      formatting.push({autoResizeDimensions: {dimensions: {sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: columns}}});
      formatting.push({updateDimensionProperties: {range: {sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: index === 0 ? 1 : 2}, properties: {pixelSize: 260}, fields: "pixelSize"}});
    }
    formatting.push({repeatCell: {range: {sheetId: ids[0], startRowIndex: 1, endRowIndex: rows.summary.length, startColumnIndex: 3, endColumnIndex: 4},
      cell: {userEnteredFormat: {numberFormat: {type: "PERCENT", pattern: "0.00%"}}}, fields: "userEnteredFormat.numberFormat"}});
    await request("POST", `${url}:batchUpdate`, {requests: formatting});
  }
  return {find, verify, create, populate};
}

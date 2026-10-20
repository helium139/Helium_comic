import { requireStaff } from '../assets/js/adminGuard.js';
import { showStaffAccessError } from '../assets/js/staff-access.js';
import { getMonthlyViewReports, retryMonthlyViewReport, generateMonthlyViewReport } from './api/monthly-reports.js';

export function createReportsPage({staff, dom = document, history = getMonthlyViewReports, retry = retryMonthlyViewReport,
    generate = data => generateMonthlyViewReport(data), confirmAction = message => window.confirm(message)}) {
    if (staff.role !== 'admin') throw new Error('Permission denied: reports are admin-only.');
    const rows = dom.getElementById('report-rows'), status = dom.getElementById('reports-status'), more = dom.getElementById('reports-more');
    let cursor = null, generation = 0, busy = false, retrying = false;
    const selector = dom.getElementById('report-month'), button = dom.getElementById('report-generate'),
        open = dom.getElementById('report-open'), message = dom.getElementById('report-generation-status');
    let selected = null, selecting = 0, generating = false;
    async function selection() {
        const version = ++selecting, month = selector.value;
        button.disabled = true; open.hidden = true;
        if (!month) return;
        message.textContent = 'Loading month?';
        try {
            const result = await history({month});
            if (version !== selecting) return;
            selected = result.report;
            const generated = selected?.status === 'generated';
            button.textContent = selected && !generated ? 'Retry' : 'Generate Report';
            button.disabled = generating || generated || !result.firstEligibleMonth || month < result.firstEligibleMonth || month >= result.currentMonth;
            if (generated && /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit$/.test(selected.spreadsheetUrl || '')) {
                open.href = selected.spreadsheetUrl; open.hidden = false;
            }
            message.textContent = generated ? 'Generated.' : selected ? 'Incomplete. Retry preserves the existing recovery state.' : 'Not generated.';
        } catch { message.textContent = 'Cannot load month. Refresh and try again.'; }
    }
    selector.addEventListener('change', selection);
    button.addEventListener('click', async () => {
        if (generating || button.disabled) return;
        generating = true; button.disabled = true; selector.disabled = true;
        message.textContent = 'Generating export? This may take several minutes.';
        let outcome;
        try {
            const result = await (selected ? retry : generate)({month: selector.value});
            outcome = result?.retryRequired ? 'Report exists. Use Retry to recover it.' : 'Report generated successfully.';
            await load(true);
        } catch { outcome = 'Generation failed or is running. Refresh to inspect recovery status.'; }
        finally {
            generating = false; selector.disabled = !selector.children.length;
            await selection(); message.textContent = outcome;
        }
    });
    function populateMonths(result) {
        if (!result.currentMonth) return;
        const previous = selector.value;
        selector.replaceChildren();
        for (let month = result.lastEligibleMonth; result.firstEligibleMonth && month >= result.firstEligibleMonth;) {
            const option = dom.createElement('option'); option.value = month; option.textContent = month; selector.appendChild(option);
            const [year, number] = month.split('-').map(Number);
            month = number === 1 ? String(year - 1) + '-12' : year + '-' + String(number - 1).padStart(2, '0');
        }
        selector.value = previous >= result.firstEligibleMonth && previous <= result.lastEligibleMonth ? previous : result.lastEligibleMonth;
        selector.disabled = generating || !selector.children.length;
        if (selector.children.length) void selection();
        else { button.disabled = true; message.textContent = 'No eligible completed months since trusted accounting activation.'; }
    }
    function cell(text) {const item = dom.createElement('td'); item.textContent = text; return item;}
    function render(report) {
        const row = dom.createElement('tr');
        row.append(cell(report.month), cell(report.totalValidViews == null ? 'Not snapshotted' : Number(report.totalValidViews).toLocaleString()),
            cell(report.teamCount == null ? '—' : String(report.teamCount)), cell(report.status),
            cell(report.generatedAt == null ? '—' : new Date(report.generatedAt).toISOString()));
        const action = cell('');
        if (report.status === 'generated' && /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit$/.test(report.spreadsheetUrl || '')) {
            const link = dom.createElement('a'); link.textContent = 'Open Sheet'; link.href = report.spreadsheetUrl;
            link.target = '_blank'; link.rel = 'noopener noreferrer'; action.appendChild(link);
        } else if (['failed', 'pending', 'generating'].includes(report.status)) {
            const button = dom.createElement('button'); button.type = 'button'; button.textContent = 'Retry safely';
            button.addEventListener('click', async () => {
                if (retrying || !confirmAction(`Retry report ${report.month}? The snapshot will not change.`)) return;
                retrying = true; button.disabled = true; status.textContent = 'Generating export… This may take several minutes.';
                try { await retry({month: report.month}); await load(true); }
                catch { status.textContent = 'Generation is running or needs owner attention. Refresh history before retrying.'; }
                finally { retrying = false; button.disabled = false; }
            }); action.appendChild(button);
        }
        row.appendChild(action); rows.appendChild(row);
        if (report.error) {const note = dom.createElement('tr'); const message = cell(report.error); message.colSpan = 6; note.appendChild(message); rows.appendChild(note);}
    }
    async function load(reset = false) {
        if (busy && !reset) return;
        if (reset) {++generation; cursor = null; rows.replaceChildren();}
        const version = generation; busy = true; more.disabled = true;
        try {
            const result = await history({cursor}); if (version !== generation) return;
            if (reset) populateMonths(result);
            for (const report of result.reports) render(report);
            cursor = result.nextCursor; more.hidden = !cursor;
            status.textContent = rows.children.length ? 'UTC reports · Firestore snapshots are authoritative; Sheets are exports.' : 'No monthly reports yet.';
        } catch {if (version === generation) status.textContent = 'Cannot load reports. Check admin claims and try Refresh.';}
        finally {if (version === generation) {busy = false; more.disabled = false;}}
    }
    more.addEventListener('click', () => load());
    dom.getElementById('reports-refresh').addEventListener('click', () => load(true));
    return {load: () => load(true)};
}
const staff = await requireStaff();
try {
    const reports = createReportsPage({staff});
    document.getElementById('reports-content').hidden = false;
    await reports.load();
} catch (error) {showStaffAccessError(error);}

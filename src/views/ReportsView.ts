import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import { VIEW_TYPE_REPORTS, TimeEntry, TimeTrackerSettings, TimeRangePreset, CategoryReportItem, CategoryReportSummary } from '../types';
import { DataManager } from '../data/DataManager';
import { TableParser } from '../data/TableParser';
import { ReportAggregator, getEntryFieldValue } from '../data/ReportAggregator';
import { Logger } from '../utils/Logger';

/** Maximum days allowed for report range to prevent performance issues */
const MAX_REPORT_DAYS = 90;

/**
 * Reports view showing time spent on each category for the selected time range
 */
export class ReportsView extends ItemView {
    private settings: TimeTrackerSettings;
    private dataManager: DataManager;

    // Current report state
    private selectedPreset: TimeRangePreset = 'this-month';
    private customStartDate: Date | null = null;
    private customEndDate: Date | null = null;

    // Category report data
    private reportSummary: CategoryReportSummary = {
        activeDaysCount: 0,
        categoriesCount: 0,
        topCategoryName: '(None)',
        topCategoryMinutes: 0,
        items: [],
    };
    private currentEntries: TimeEntry[] = [];
    private currentRangeStart: Date | null = null;
    private currentRangeEnd: Date | null = null;

    // Expanded category names
    private expandedCategories: Set<string> = new Set();

    // DOM references
    private contentContainer: HTMLElement;
    private rangeSelector: HTMLElement;
    private customDateInputs: HTMLElement;
    private summaryContainer: HTMLElement;
    private categoryTableContainer: HTMLElement;

    constructor(
        leaf: WorkspaceLeaf,
        settings: TimeTrackerSettings,
        dataManager: DataManager
    ) {
        super(leaf);
        this.settings = settings;
        this.dataManager = dataManager;
    }

    getViewType(): string {
        return VIEW_TYPE_REPORTS;
    }

    getDisplayText(): string {
        return 'Reports';
    }

    getIcon(): string {
        return 'pie-chart';
    }

    async onOpen(): Promise<void> {
        this.render();
        await this.loadReport();
    }

    async onClose(): Promise<void> {
        await super.onClose();
    }

    updateSettings(settings: TimeTrackerSettings): void {
        this.settings = settings;
        void this.loadReport();
    }

    async refresh(): Promise<void> {
        await this.loadReport();
    }

    /**
     * Main render function
     */
    private render(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('time-tracker-reports');

        // Header
        this.renderHeader(container);

        // Content container
        this.contentContainer = container.createDiv('reports-content');

        // Range selector
        this.rangeSelector = this.contentContainer.createDiv('reports-range-selector');
        this.renderRangeSelector();

        // Custom date inputs (hidden by default unless custom is selected)
        this.customDateInputs = this.contentContainer.createDiv('reports-custom-dates');
        this.customDateInputs.addClass('is-hidden');
        this.renderCustomDateInputs();

        // Summary KPI cards section (top category, active days, categories count)
        this.summaryContainer = this.contentContainer.createDiv('reports-summary');

        // Category breakdown table container
        this.categoryTableContainer = this.contentContainer.createDiv('reports-table-container');
    }

    /**
     * Render the header with title and export controls
     */
    private renderHeader(container: HTMLElement): void {
        const header = container.createDiv('reports-header');

        const titleSection = header.createDiv('reports-header-title');
        titleSection.createEl('h2', { text: 'Category reports' });

        const controls = header.createDiv('reports-header-controls');

        // Export CSV button
        const exportCsvBtn = controls.createEl('button', {
            text: 'Export CSV',
            cls: 'reports-btn',
        });
        exportCsvBtn.addEventListener('click', () => { void this.exportToCSV(); });

        // Export JSON button
        const exportJsonBtn = controls.createEl('button', {
            text: 'Export JSON',
            cls: 'reports-btn',
        });
        exportJsonBtn.addEventListener('click', () => { void this.exportToJSON(); });

        // Refresh button
        const refreshBtn = controls.createEl('button', {
            text: 'Refresh',
            cls: 'reports-btn',
        });
        refreshBtn.addEventListener('click', () => { void this.loadReport(); });
    }

    /**
     * Render time range preset buttons
     */
    private renderRangeSelector(): void {
        this.rangeSelector.empty();

        const presets: { value: TimeRangePreset; label: string }[] = [
            { value: 'today', label: 'Today' },
            { value: 'yesterday', label: 'Yesterday' },
            { value: 'this-week', label: 'This Week' },
            { value: 'last-week', label: 'Last Week' },
            { value: 'this-month', label: 'This Month' },
            { value: 'last-month', label: 'Last Month' },
            { value: 'custom', label: 'Custom' },
        ];

        for (const preset of presets) {
            const btn = this.rangeSelector.createEl('button', {
                text: preset.label,
                cls: `reports-range-btn ${this.selectedPreset === preset.value ? 'is-active' : ''}`,
            });
            btn.addEventListener('click', () => this.selectPreset(preset.value));
        }
    }

    /**
     * Render custom date inputs
     */
    private renderCustomDateInputs(): void {
        this.customDateInputs.empty();

        const parseLocalDateInput = (value: string): Date | null => {
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
            if (!match) return null;
            return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        };

        const startLabel = this.customDateInputs.createEl('label', { text: 'From: ' });
        const startInput = startLabel.createEl('input', { type: 'date' });
        if (this.customStartDate) {
            startInput.value = TableParser.getDateString(this.customStartDate);
        }
        startInput.addEventListener('change', (e) => {
            const parsed = parseLocalDateInput((e.target as HTMLInputElement).value);
            if (parsed) {
                this.customStartDate = parsed;
                void this.loadReport();
            }
        });

        const endLabel = this.customDateInputs.createEl('label', { text: 'To: ' });
        const endInput = endLabel.createEl('input', { type: 'date' });
        if (this.customEndDate) {
            endInput.value = TableParser.getDateString(this.customEndDate);
        }
        endInput.addEventListener('change', (e) => {
            const parsed = parseLocalDateInput((e.target as HTMLInputElement).value);
            if (parsed) {
                this.customEndDate = parsed;
                void this.loadReport();
            }
        });
    }

    /**
     * Select a time range preset
     */
    private selectPreset(preset: TimeRangePreset): void {
        this.selectedPreset = preset;
        this.renderRangeSelector();

        if (preset === 'custom') {
            this.customDateInputs.removeClass('is-hidden');
            if (!this.customStartDate || !this.customEndDate) {
                const { start, end } = this.getDateRange('this-month');
                this.customStartDate = start;
                this.customEndDate = end;
                this.renderCustomDateInputs();
            }
        } else {
            this.customDateInputs.addClass('is-hidden');
        }

        void this.loadReport();
    }

    /**
     * Get date range for a preset
     */
    private getDateRange(preset: TimeRangePreset): { start: Date; end: Date } {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        switch (preset) {
            case 'today':
                return {
                    start: today,
                    end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1),
                };

            case 'yesterday': {
                const yesterday = new Date(today);
                yesterday.setDate(today.getDate() - 1);
                const yesterdayEnd = new Date(yesterday);
                yesterdayEnd.setHours(23, 59, 59, 999);
                return { start: yesterday, end: yesterdayEnd };
            }

            case 'this-week': {
                const dayOfWeek = today.getDay();
                const mondayOffset = this.settings.weekStart === 'monday'
                    ? (dayOfWeek === 0 ? -6 : 1 - dayOfWeek)
                    : -dayOfWeek;
                const weekStart = new Date(today);
                weekStart.setDate(today.getDate() + mondayOffset);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 6);
                weekEnd.setHours(23, 59, 59, 999);
                return { start: weekStart, end: weekEnd };
            }

            case 'last-week': {
                const dayOfWeek = today.getDay();
                const mondayOffset = this.settings.weekStart === 'monday'
                    ? (dayOfWeek === 0 ? -6 : 1 - dayOfWeek)
                    : -dayOfWeek;
                const thisWeekStart = new Date(today);
                thisWeekStart.setDate(today.getDate() + mondayOffset);
                const lastWeekStart = new Date(thisWeekStart);
                lastWeekStart.setDate(thisWeekStart.getDate() - 7);
                const lastWeekEnd = new Date(lastWeekStart);
                lastWeekEnd.setDate(lastWeekStart.getDate() + 6);
                lastWeekEnd.setHours(23, 59, 59, 999);
                return { start: lastWeekStart, end: lastWeekEnd };
            }

            case 'this-month': {
                const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
                monthEnd.setHours(23, 59, 59, 999);
                return { start: monthStart, end: monthEnd };
            }

            case 'last-month': {
                const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
                lastMonthEnd.setHours(23, 59, 59, 999);
                return { start: lastMonthStart, end: lastMonthEnd };
            }

            case 'custom': {
                const rawStart = this.customStartDate || today;
                const rawEnd = this.customEndDate || today;
                const customStart = rawStart <= rawEnd ? new Date(rawStart) : new Date(rawEnd);
                customStart.setHours(0, 0, 0, 0);
                const customEndEOD = rawStart <= rawEnd ? new Date(rawEnd) : new Date(rawStart);
                customEndEOD.setHours(23, 59, 59, 999);
                return { start: customStart, end: customEndEOD };
            }

            default: {
                const defaultEnd = new Date(today);
                defaultEnd.setHours(23, 59, 59, 999);
                return { start: today, end: defaultEnd };
            }
        }
    }

    /**
     * Load report data for the selected time range
     */
    private async loadReport(): Promise<void> {
        const { start, end } = this.getDateRange(this.selectedPreset);

        // Check if range exceeds maximum
        const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff > MAX_REPORT_DAYS) {
            new Notice(`Report range limited to ${MAX_REPORT_DAYS} days for performance. Please select a shorter range.`);
            return;
        }

        Logger.log('ReportsView: Loading report for', start.toDateString(), 'to', end.toDateString());

        // Load entries for date range
        const entries = await this.dataManager.loadDateRange(start, end);

        Logger.log('ReportsView: Found', entries.length, 'entries');

        this.currentEntries = entries;
        this.currentRangeStart = start;
        this.currentRangeEnd = end;

        const schema = this.dataManager.getSchema();

        this.reportSummary = ReportAggregator.calculateCategoryReport({
            entries,
            schema,
            rangeStart: start,
            rangeEnd: end,
            getEffectiveDuration: (entry, s, e) => this.dataManager.getEffectiveDuration(entry, s, e),
        });

        // Auto-expand categories by default if not set
        if (this.expandedCategories.size === 0) {
            for (const item of this.reportSummary.items) {
                this.expandedCategories.add(item.category);
            }
        }

        // Render summary and category breakdown table
        this.renderSummary(start, end);
        this.renderCategoryTable();
    }

    /**
     * Render the summary KPI section
     * Highlights category focus and time allocation
     */
    private renderSummary(start: Date, end: Date): void {
        this.summaryContainer.empty();

        // Date range label
        const rangeLabel = this.summaryContainer.createDiv('reports-range-label');
        rangeLabel.setText(this.formatDateRange(start, end));

        // Top Category
        const focusCard = this.summaryContainer.createDiv('reports-summary-card reports-top-category-card');
        focusCard.createDiv({ text: 'Top Category', cls: 'reports-summary-label' });
        const focusText = this.reportSummary.topCategoryMinutes > 0
            ? `${this.reportSummary.topCategoryName} (${this.formatDuration(this.reportSummary.topCategoryMinutes)})`
            : '(None)';
        focusCard.createDiv({ text: focusText, cls: 'reports-summary-value' });

        // Active Days
        const daysCard = this.summaryContainer.createDiv('reports-summary-card');
        daysCard.createDiv({ text: 'Active Days', cls: 'reports-summary-label' });
        daysCard.createDiv({
            text: `${this.reportSummary.activeDaysCount} ${this.reportSummary.activeDaysCount === 1 ? 'day' : 'days'}`,
            cls: 'reports-summary-value',
        });

        // Categories Tracked
        const catCountCard = this.summaryContainer.createDiv('reports-summary-card');
        catCountCard.createDiv({ text: 'Categories Tracked', cls: 'reports-summary-label' });
        catCountCard.createDiv({
            text: `${this.reportSummary.categoriesCount} ${this.reportSummary.categoriesCount === 1 ? 'category' : 'categories'}`,
            cls: 'reports-summary-value',
        });
    }

    /**
     * Render the category breakdown table showing time spent per category
     */
    private renderCategoryTable(): void {
        this.categoryTableContainer.empty();

        if (this.reportSummary.items.length === 0) {
            this.categoryTableContainer.createDiv({
                text: 'No time entries found for this period.',
                cls: 'reports-empty',
            });
            return;
        }

        const table = this.categoryTableContainer.createEl('table', { cls: 'reports-table' });

        // Header
        const thead = table.createEl('thead');
        const headerRow = thead.createEl('tr');

        headerRow.createEl('th', { text: 'Category / Activity' });
        headerRow.createEl('th', { text: 'Time Spent', cls: 'reports-col-hours' });
        headerRow.createEl('th', { text: 'Share', cls: 'reports-col-percent' });
        headerRow.createEl('th', { text: 'Distribution', cls: 'reports-col-bar' });

        // Body
        const tbody = table.createEl('tbody');

        for (const item of this.reportSummary.items) {
            const hasActivities = item.activities && item.activities.length > 0;
            const isExpanded = this.expandedCategories.has(item.category);

            // Category row
            const catRow = tbody.createEl('tr', { cls: 'reports-category-row' });
            if (hasActivities) {
                catRow.addEventListener('click', () => {
                    if (this.expandedCategories.has(item.category)) {
                        this.expandedCategories.delete(item.category);
                    } else {
                        this.expandedCategories.add(item.category);
                    }
                    this.renderCategoryTable();
                });
            }

            const nameCell = catRow.createEl('td', { cls: 'reports-category-name' });

            // Expand icon
            const expandIcon = nameCell.createSpan('reports-expand-icon');
            if (hasActivities) {
                expandIcon.setText(isExpanded ? '▼' : '▶');
            } else {
                expandIcon.setText(' ');
            }

            // Category color dot
            const colorDot = nameCell.createSpan('reports-color-dot');
            colorDot.style.backgroundColor = item.color;

            // Category label & entry count
            const labelSpan = nameCell.createSpan({ text: item.category, cls: 'reports-category-title' });
            if (item.entryCount > 1) {
                nameCell.createSpan({ text: ` (${item.entryCount} sessions)`, cls: 'reports-entry-count' });
            }

            // Time spent
            catRow.createEl('td', {
                text: this.formatDuration(item.totalMinutes),
                cls: 'reports-col-hours reports-category-hours',
            });

            // Share of tracked time
            catRow.createEl('td', {
                text: `${item.percentageOfTime.toFixed(1)}%`,
                cls: 'reports-col-percent',
            });

            // Distribution bar
            const barCell = catRow.createEl('td', { cls: 'reports-col-bar' });
            const bar = barCell.createDiv('reports-bar');
            bar.style.width = `${Math.min(100, Math.max(1, item.percentageOfTime))}%`;
            bar.style.backgroundColor = item.color;

            // Nested activity rows if expanded
            if (hasActivities && isExpanded) {
                for (const act of item.activities) {
                    const actRow = tbody.createEl('tr', { cls: 'reports-activity-nested-row' });

                    const actNameCell = actRow.createEl('td', { cls: 'reports-activity-nested-name' });
                    actNameCell.style.paddingLeft = '36px';

                    const actDot = actNameCell.createSpan('reports-color-dot');
                    actDot.style.backgroundColor = act.color;

                    actNameCell.createSpan({ text: act.name });

                    actRow.createEl('td', {
                        text: this.formatDuration(act.totalMinutes),
                        cls: 'reports-col-hours',
                    });

                    actRow.createEl('td', {
                        text: `${act.percentageOfCategory.toFixed(1)}%`,
                        cls: 'reports-col-percent',
                    });

                    const actBarCell = actRow.createEl('td', { cls: 'reports-col-bar' });
                    const actBar = actBarCell.createDiv('reports-bar reports-bar-nested');
                    actBar.style.width = `${Math.min(100, Math.max(1, act.percentageOfCategory))}%`;
                    actBar.style.backgroundColor = act.color;
                }
            }
        }
    }

    // Helper formatting methods

    private formatDuration(minutes: number): string {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (hours === 0) return `${mins}m`;
        if (mins === 0) return `${hours}h`;
        return `${hours}h ${mins}m`;
    }

    private formatDateRange(start: Date, end: Date): string {
        const sameDay = start.toDateString() === end.toDateString();
        const options: Intl.DateTimeFormatOptions = {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        };

        if (sameDay) {
            return start.toLocaleDateString(undefined, options);
        }

        return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString(undefined, options)}`;
    }

    /**
     * Export current report data to CSV
     */
    private async exportToCSV(): Promise<void> {
        const { start, end } = this.getDateRange(this.selectedPreset);
        const entries = await this.dataManager.loadDateRange(start, end);

        if (entries.length === 0) {
            new Notice('No entries to export');
            return;
        }

        const csv = this.generateCSV(entries);
        const startStr = TableParser.getDateString(start);
        const endStr = TableParser.getDateString(end);
        const filename = `category-entries-${startStr}-to-${endStr}.csv`;

        this.downloadCSV(csv, filename);
    }

    /**
     * Generate CSV content with dynamic schema fields
     */
    private generateCSV(entries: TimeEntry[]): string {
        const schema = this.dataManager.getSchema();
        const exportFields = schema.fields;
        const headers = ['Start', 'End', 'Duration', ...exportFields.map(f => f.label)];

        const sorted = [...entries].sort((a, b) =>
            a.startDateTime.getTime() - b.startDateTime.getTime()
        );

        const rows: string[][] = [headers];

        for (const entry of sorted) {
            const row: string[] = [
                TableParser.formatDateTime(entry.startDateTime),
                TableParser.formatDateTime(entry.endDateTime),
                this.formatDuration(entry.durationMinutes),
            ];

            for (const field of exportFields) {
                const val = getEntryFieldValue(entry, field.id, schema);
                row.push(val === '(None)' ? '' : val);
            }

            rows.push(row);
        }

        return rows.map(row =>
            row.map(cell => this.escapeCSVCell(cell)).join(',')
        ).join('\n');
    }

    private escapeCSVCell(value: string): string {
        if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
            return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
    }

    private downloadCSV(content: string, filename: string): void {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = createEl('a');
        link.href = url;
        link.download = filename;
        link.classList.add('is-hidden');

        activeDocument.body.appendChild(link);
        link.click();
        activeDocument.body.removeChild(link);

        URL.revokeObjectURL(url);
        Logger.log('ReportsView: Exported CSV -', filename);
    }

    /**
     * Export current report data to JSON
     */
    private async exportToJSON(): Promise<void> {
        const { start, end } = this.getDateRange(this.selectedPreset);
        const entries = await this.dataManager.loadDateRange(start, end);

        if (entries.length === 0) {
            new Notice('No entries to export');
            return;
        }

        const json = this.generateJSON(entries, start, end);
        const startStr = TableParser.getDateString(start);
        const endStr = TableParser.getDateString(end);
        const filename = `category-entries-${startStr}-to-${endStr}.json`;

        this.downloadJSON(json, filename);
    }

    /**
     * Generate JSON content from time entries
     */
    private generateJSON(entries: TimeEntry[], start: Date, end: Date): string {
        const schema = this.dataManager.getSchema();
        const exportFields = schema.fields;
        const sorted = [...entries].sort((a, b) =>
            a.startDateTime.getTime() - b.startDateTime.getTime()
        );

        const summary = ReportAggregator.calculateCategoryReport({
            entries,
            schema,
            rangeStart: start,
            rangeEnd: end,
            getEffectiveDuration: (entry, s, e) => this.dataManager.getEffectiveDuration(entry, s, e),
        });

        const exportData = {
            exportedAt: new Date().toISOString(),
            dateRange: {
                start: TableParser.getDateString(start),
                end: TableParser.getDateString(end),
            },
            totalEntries: sorted.length,
            activeDays: summary.activeDaysCount,
            categoriesTracked: summary.categoriesCount,
            categories: summary.items.map(cat => ({
                category: cat.category,
                timeSpentMinutes: cat.totalMinutes,
                percentageOfTime: cat.percentageOfTime,
                entryCount: cat.entryCount,
                activities: cat.activities.map(act => ({
                    activity: act.name,
                    timeSpentMinutes: act.totalMinutes,
                    percentageOfCategory: act.percentageOfCategory,
                })),
            })),
            entries: sorted.map(entry => {
                const dynamicFields: Record<string, string> = {};
                for (const field of exportFields) {
                    const val = getEntryFieldValue(entry, field.id, schema);
                    if (val !== '(None)') {
                        dynamicFields[field.id] = val;
                    }
                }
                return {
                    date: entry.date,
                    start: entry.start,
                    end: entry.end,
                    durationMinutes: entry.durationMinutes,
                    ...dynamicFields,
                };
            }),
        };

        return JSON.stringify(exportData, null, 2);
    }

    private downloadJSON(content: string, filename: string): void {
        const blob = new Blob([content], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = createEl('a');
        link.href = url;
        link.download = filename;
        link.classList.add('is-hidden');

        activeDocument.body.appendChild(link);
        link.click();
        activeDocument.body.removeChild(link);

        URL.revokeObjectURL(url);
        Logger.log('ReportsView: Exported JSON -', filename);
    }
}

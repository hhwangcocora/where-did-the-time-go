import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import { VIEW_TYPE_REPORTS, TimeEntry, TimeTrackerSettings, TimeRangePreset, CategoryReportItem, CategoryReportSummary, DailyDiary } from '../types';
import { DataManager } from '../data/DataManager';
import { TableParser } from '../data/TableParser';
import { ReportAggregator, getEntryFieldValue, getNodeColor } from '../data/ReportAggregator';
import { DiaryModal } from '../modals/DiaryModal';
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
    private currentDiaries: Map<string, DailyDiary> = new Map();
    private currentRangeStart: Date | null = null;
    private currentRangeEnd: Date | null = null;

    // Expanded category names
    private expandedCategories: Set<string> = new Set();

    // DOM references
    private contentContainer: HTMLElement;
    private rangeSelector: HTMLElement;
    private customDateInputs: HTMLElement;
    private summaryContainer: HTMLElement;
    private chartContainer: HTMLElement;
    private categoryTableContainer: HTMLElement;
    private diaryTimelineContainer: HTMLElement;

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

        // Summary KPI cards section (Avg sleep, active days, categories count)
        this.summaryContainer = this.contentContainer.createDiv('reports-summary');

        // Pie chart container
        this.chartContainer = this.contentContainer.createDiv('reports-chart-container');

        // Category breakdown table container (List view)
        this.categoryTableContainer = this.contentContainer.createDiv('reports-table-container');

        // Daily diary timeline container (below the category / activity list view)
        this.diaryTimelineContainer = this.contentContainer.createDiv('reports-diary-timeline-container');
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

        // Load entries and diaries for date range
        const [entries, diaries] = await Promise.all([
            this.dataManager.loadDateRange(start, end),
            this.dataManager.loadDiariesForRange(start, end),
        ]);

        Logger.log('ReportsView: Found', entries.length, 'entries,', diaries.size, 'diaries');

        this.currentEntries = entries;
        this.currentDiaries = diaries;
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

        // Render summary, pie chart, category breakdown table, and daily diary timeline
        // Category / activity list view remains collapsed by default
        this.renderSummary(start, end);
        this.renderPieChart();
        this.renderCategoryTable();
        this.renderDiaryTimeline(start, end);
    }

    /**
     * Render the summary KPI section
     * Highlights average sleep hours per day, active days, and categories tracked
     */
    private renderSummary(start: Date, end: Date): void {
        this.summaryContainer.empty();

        // Date range label
        const rangeLabel = this.summaryContainer.createDiv('reports-range-label');
        rangeLabel.setText(this.formatDateRange(start, end));

        // Average Sleep per Day (replaces Top Category)
        const sleepStats = this.reportSummary.averageSleep || {
            totalSleepMinutes: 0,
            sleepDaysCount: 0,
            averageSleepMinutes: 0,
            averageSleepHours: 0,
        };

        const sleepCard = this.summaryContainer.createDiv('reports-summary-card reports-sleep-card');
        sleepCard.createDiv({ text: 'Avg Sleep / Day', cls: 'reports-summary-label' });
        const sleepText = sleepStats.averageSleepHours > 0
            ? `${sleepStats.averageSleepHours.toFixed(1)} hrs`
            : '0 hrs';
        sleepCard.createDiv({ text: sleepText, cls: 'reports-summary-value' });
        if (sleepStats.sleepDaysCount > 0) {
            sleepCard.title = `Based on ${sleepStats.sleepDaysCount} ${sleepStats.sleepDaysCount === 1 ? 'day' : 'days'} with sleep (total: ${this.formatDuration(Math.round(sleepStats.totalSleepMinutes))})`;
        } else {
            sleepCard.title = 'No sleep entries tracked in this period';
        }

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
     * Render pie chart showing top 8 categories by time spent, with remainder grouped as 'Others'
     */
    private renderPieChart(): void {
        this.chartContainer.empty();

        if (this.reportSummary.items.length === 0) {
            return;
        }

        const distribution = ReportAggregator.calculateCategoryDistribution(this.reportSummary.items, 8);
        if (distribution.slices.length === 0 || distribution.totalMinutes === 0) {
            return;
        }

        const card = this.chartContainer.createDiv('reports-chart-card');

        // Header
        const header = card.createDiv('reports-chart-header');
        header.createEl('h3', { text: 'Time Allocation', cls: 'reports-chart-title' });

        // Body
        const body = card.createDiv('reports-chart-body');

        // Pie container
        const pieContainer = body.createDiv('reports-pie-container');

        const size = 220;
        const cx = 110;
        const cy = 110;
        const rOuter = 95;
        const rInner = 55;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
        svg.setAttribute('width', `${size}`);
        svg.setAttribute('height', `${size}`);
        svg.setAttribute('class', 'reports-pie-svg');

        let currentAngle = -Math.PI / 2;
        const sliceElements: SVGPathElement[] = [];

        const createDonutPath = (startA: number, endA: number): string => {
            if (endA - startA >= 2 * Math.PI - 0.001) {
                return `M ${cx} ${cy - rOuter} A ${rOuter} ${rOuter} 0 1 1 ${cx} ${cy + rOuter} A ${rOuter} ${rOuter} 0 1 1 ${cx} ${cy - rOuter} M ${cx} ${cy - rInner} A ${rInner} ${rInner} 0 1 0 ${cx} ${cy + rInner} A ${rInner} ${rInner} 0 1 0 ${cx} ${cy - rInner} Z`;
            }
            const x1 = cx + rOuter * Math.cos(startA);
            const y1 = cy + rOuter * Math.sin(startA);
            const x2 = cx + rOuter * Math.cos(endA);
            const y2 = cy + rOuter * Math.sin(endA);
            const x3 = cx + rInner * Math.cos(endA);
            const y3 = cy + rInner * Math.sin(endA);
            const x4 = cx + rInner * Math.cos(startA);
            const y4 = cy + rInner * Math.sin(startA);
            const largeArc = endA - startA > Math.PI ? 1 : 0;
            return `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4} ${y4} Z`;
        };

        // Center text group
        const centerGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        centerGroup.setAttribute('class', 'reports-pie-center');

        const titleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        titleText.setAttribute('x', `${cx}`);
        titleText.setAttribute('y', `${cy - 8}`);
        titleText.setAttribute('class', 'reports-pie-center-title');
        titleText.textContent = 'Total';

        const valueText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        valueText.setAttribute('x', `${cx}`);
        valueText.setAttribute('y', `${cy + 12}`);
        valueText.setAttribute('class', 'reports-pie-center-value');
        valueText.textContent = this.formatDuration(distribution.totalMinutes);

        const subText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        subText.setAttribute('x', `${cx}`);
        subText.setAttribute('y', `${cy + 28}`);
        subText.setAttribute('class', 'reports-pie-center-sub');
        subText.textContent = '';

        centerGroup.appendChild(titleText);
        centerGroup.appendChild(valueText);
        centerGroup.appendChild(subText);

        const legendContainer = body.createDiv('reports-pie-legend');
        const legendItems: HTMLElement[] = [];

        // Reset center function
        const resetCenter = () => {
            titleText.textContent = 'Total';
            valueText.textContent = this.formatDuration(distribution.totalMinutes);
            subText.textContent = '';
            for (const el of sliceElements) el.classList.remove('is-highlighted');
            for (const item of legendItems) item.classList.remove('is-highlighted');
        };

        // Highlight slice function
        const highlightSlice = (index: number) => {
            const s = distribution.slices[index];
            if (!s) return;
            const displayName = s.name.length > 15 ? s.name.slice(0, 14) + '…' : s.name;
            titleText.textContent = displayName;
            valueText.textContent = this.formatDuration(s.minutes);
            subText.textContent = `${s.percentage.toFixed(1)}%`;

            for (let i = 0; i < sliceElements.length; i++) {
                if (i === index) sliceElements[i].classList.add('is-highlighted');
                else sliceElements[i].classList.remove('is-highlighted');
            }
            for (let i = 0; i < legendItems.length; i++) {
                if (i === index) legendItems[i].classList.add('is-highlighted');
                else legendItems[i].classList.remove('is-highlighted');
            }
        };

        // Render slices
        for (let i = 0; i < distribution.slices.length; i++) {
            const slice = distribution.slices[i];
            const angleDelta = (slice.percentage / 100) * 2 * Math.PI;
            const nextAngle = currentAngle + angleDelta;

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', createDonutPath(currentAngle, nextAngle));
            path.setAttribute('fill', slice.color);
            path.setAttribute('class', 'reports-pie-slice');
            path.setAttribute('data-index', `${i}`);

            path.addEventListener('mouseenter', () => highlightSlice(i));
            path.addEventListener('mouseleave', () => resetCenter());

            svg.appendChild(path);
            sliceElements.push(path);
            currentAngle = nextAngle;
        }

        svg.appendChild(centerGroup);
        pieContainer.appendChild(svg);

        // Render legend items
        for (let i = 0; i < distribution.slices.length; i++) {
            const slice = distribution.slices[i];
            const legendItem = legendContainer.createDiv('reports-legend-item');
            legendItem.setAttribute('data-index', `${i}`);

            const dot = legendItem.createSpan('reports-legend-dot');
            dot.style.backgroundColor = slice.color;

            legendItem.createSpan({ text: slice.name, cls: 'reports-legend-name', title: slice.name });
            legendItem.createSpan({ text: this.formatDuration(slice.minutes), cls: 'reports-legend-time' });
            legendItem.createSpan({ text: `${slice.percentage.toFixed(1)}%`, cls: 'reports-legend-percent' });

            legendItem.addEventListener('mouseenter', () => highlightSlice(i));
            legendItem.addEventListener('mouseleave', () => resetCenter());

            legendItems.push(legendItem);
        }
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

    /**
     * Render the daily diary timeline section below the category table
     * Shows daily reflections and activity time summaries in descending date order
     */
    private renderDiaryTimeline(start: Date, end: Date): void {
        this.diaryTimelineContainer.empty();

        const sectionHeader = this.diaryTimelineContainer.createDiv('reports-section-header');
        sectionHeader.createEl('h3', { text: 'Daily Diaries & Activities', cls: 'reports-section-title' });

        // Calculate all dates in the range, ordered descending (from latest to start)
        const now = new Date();
        const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const endMidnight = new Date(end.getFullYear(), end.getMonth(), end.getDate());

        let latestDay = endMidnight > todayMidnight && startMidnight <= todayMidnight ? todayMidnight : endMidnight;

        // If there are entries beyond latestDay up to endMidnight, include them
        for (const entry of this.currentEntries) {
            const eDate = new Date(entry.startDateTime.getFullYear(), entry.startDateTime.getMonth(), entry.startDateTime.getDate());
            if (eDate > latestDay && eDate <= endMidnight) {
                latestDay = eDate;
            }
        }

        const datesDesc: string[] = [];
        const current = new Date(latestDay);
        while (current >= startMidnight) {
            datesDesc.push(TableParser.getDateString(current));
            current.setDate(current.getDate() - 1);
        }

        if (datesDesc.length === 0) {
            this.diaryTimelineContainer.createDiv({
                text: 'No days in selected period.',
                cls: 'reports-empty',
            });
            return;
        }

        // Map entries by date
        const dayEntriesMap = new Map<string, TimeEntry[]>();
        for (const entry of this.currentEntries) {
            const dateStr = entry.date || TableParser.getDateString(entry.startDateTime);
            if (!dateStr) continue;
            let list = dayEntriesMap.get(dateStr);
            if (!list) {
                list = [];
                dayEntriesMap.set(dateStr, list);
            }
            list.push(entry);
        }

        const schema = this.dataManager.getSchema();
        const categoryField = schema.fields.find(f => f.ui?.timelineRole === 'color')
            || schema.fields.find(f => f.id === 'category')
            || schema.fields[0];
        const activityField = schema.fields.find(f => f.ui?.timelineRole === 'title')
            || schema.fields.find(f => f.id === 'activity_name');

        const timeline = this.diaryTimelineContainer.createDiv('reports-timeline');

        const todayStr = TableParser.getDateString(now);
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const yesterdayStr = TableParser.getDateString(yesterday);

        for (const dateStr of datesDesc) {
            const dayItem = timeline.createDiv('reports-timeline-item');

            // Timeline spine marker
            const marker = dayItem.createDiv('reports-timeline-marker');
            marker.createSpan('reports-timeline-dot');

            // Day card
            const card = dayItem.createDiv('reports-timeline-card');

            // Header: Date & action
            const cardHeader = card.createDiv('reports-timeline-header');
            const dateWrapper = cardHeader.createDiv('reports-timeline-date-wrapper');

            const [year, month, day] = dateStr.split('-').map(Number);
            const dateObj = new Date(year, month - 1, day);
            const friendlyDate = dateObj.toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
            });

            dateWrapper.createSpan({ text: dateStr, cls: 'reports-timeline-date-iso' });
            dateWrapper.createSpan({ text: ` (${friendlyDate})`, cls: 'reports-timeline-date-friendly' });

            if (dateStr === todayStr) {
                cardHeader.createSpan({ text: 'Today', cls: 'reports-timeline-badge reports-timeline-badge-today' });
            } else if (dateStr === yesterdayStr) {
                cardHeader.createSpan({ text: 'Yesterday', cls: 'reports-timeline-badge' });
            }

            const diary = this.currentDiaries.get(dateStr);
            const hasDiary = !!(diary && diary.content && diary.content.trim().length > 0);

            const editBtn = cardHeader.createEl('button', {
                cls: 'reports-timeline-diary-btn reports-btn',
                text: hasDiary ? 'Edit Diary' : 'Write Diary',
            });
            editBtn.addEventListener('click', () => {
                new DiaryModal(this.app, this.dataManager, dateStr, () => {
                    void this.loadReport();
                }).open();
            });

            // Diary reflection section
            const diarySection = card.createDiv('reports-timeline-diary-section');

            if (hasDiary) {
                const diaryText = diarySection.createDiv('reports-timeline-diary-text');
                diaryText.setText(diary!.content.trim());
            } else {
                diarySection.createDiv({ text: '(None)', cls: 'reports-timeline-empty-text' });
            }

            // Activities summary section
            const activitiesSection = card.createDiv('reports-timeline-activities-section');
            const actHeadingRow = activitiesSection.createDiv('reports-timeline-activities-header');
            actHeadingRow.createDiv({ text: 'Activities (time spent)', cls: 'reports-timeline-subheading' });

            const dayEntries = dayEntriesMap.get(dateStr) || [];
            if (dayEntries.length === 0) {
                activitiesSection.createDiv({ text: '(None)', cls: 'reports-timeline-empty-text' });
            } else {
                const dayTotalMinutes = dayEntries.reduce((sum, e) => sum + e.durationMinutes, 0);
                actHeadingRow.createSpan({
                    text: `Total: ${this.formatDuration(dayTotalMinutes)}`,
                    cls: 'reports-timeline-total-badge',
                });

                const actList = activitiesSection.createDiv('reports-timeline-activities-list');

                // Aggregate by activity name + category
                const actMap = new Map<string, {
                    name: string;
                    category: string;
                    color: string;
                    durationMinutes: number;
                }>();

                for (const entry of dayEntries) {
                    const catVal = categoryField ? getEntryFieldValue(entry, categoryField.id, schema) : '(Unspecified)';
                    const actVal = activityField ? getEntryFieldValue(entry, activityField.id, schema) : '(None)';
                    const displayName = (actVal && actVal !== '(None)') ? actVal : catVal;
                    const key = `${catVal}:::${displayName}`;

                    let existing = actMap.get(key);
                    if (!existing) {
                        const color = categoryField ? getNodeColor(categoryField.id, catVal, schema) : '#888888';
                        existing = {
                            name: displayName,
                            category: catVal,
                            color,
                            durationMinutes: 0,
                        };
                        actMap.set(key, existing);
                    }
                    existing.durationMinutes += entry.durationMinutes;
                }

                const sortedActs = Array.from(actMap.values())
                    .sort((a, b) => b.durationMinutes - a.durationMinutes);

                for (const act of sortedActs) {
                    const pill = actList.createDiv('reports-timeline-act-pill');
                    const dot = pill.createSpan('reports-color-dot');
                    dot.style.backgroundColor = act.color;

                    pill.createSpan({ text: act.name, cls: 'reports-timeline-act-name' });
                    if (act.category && act.category !== act.name && act.category !== '(Unspecified)') {
                        pill.createSpan({ text: `(${act.category})`, cls: 'reports-timeline-act-cat' });
                    }
                    pill.createSpan({
                        text: this.formatDuration(act.durationMinutes),
                        cls: 'reports-timeline-act-time',
                    });
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

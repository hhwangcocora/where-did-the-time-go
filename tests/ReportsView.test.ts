import { jest } from '@jest/globals';
import { JSDOM } from 'jsdom';
import { WorkspaceLeaf } from 'obsidian';
import { setupDomPrototypes } from './__mocks__/obsidian';
import { ReportsView } from '../src/views/ReportsView';
import { DataManager } from '../src/data/DataManager';
import { DEFAULT_SETTINGS, TimeEntry, TrackingSchemaConfig, DailyDiary } from '../src/types';

describe('ReportsView UI', () => {
    let dom: JSDOM;
    let leaf: WorkspaceLeaf;
    let dataManager: DataManager;

    const mockSchema: TrackingSchemaConfig = {
        version: 1,
        fields: [
            {
                id: 'category',
                label: 'Category',
                type: 'enum',
                required: true,
                multiple: false,
                options: [
                    { id: 'sleep', label: '🌙 Sleep', color: '#6366f1' },
                    { id: 'deep-work', label: 'Deep Work', color: '#3b82f6' },
                    { id: 'fitness', label: 'Fitness', color: '#10b981' },
                    { id: 'learning', label: 'Learning', color: '#f59e0b' },
                    { id: 'leisure', label: 'Leisure', color: '#ec4899' },
                    { id: 'chores', label: 'Chores', color: '#8b5cf6' },
                    { id: 'work', label: 'Work', color: '#14b8a6' },
                    { id: 'finance', label: 'Finance', color: '#f97316' },
                    { id: 'travel', label: 'Travel', color: '#06b6d4' },
                    { id: 'entertainment', label: 'Entertainment', color: '#a855f7' },
                ],
                ui: { timelineRole: 'color' },
            },
            {
                id: 'activity_name',
                label: 'Activity Name',
                type: 'string',
                required: true,
                multiple: false,
                ui: { timelineRole: 'title' },
            },
        ],
        defaultReportGrouping: ['category', 'activity_name'],
    };

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body><div id="leaf"><div class="header"></div><div class="content"></div></div></body></html>');
        (global as any).document = dom.window.document;
        (global as any).HTMLElement = dom.window.HTMLElement;
        (global as any).window = dom.window;
        (global as any).activeDocument = dom.window.document;
        setupDomPrototypes();

        leaf = {
            view: null as any,
        } as unknown as WorkspaceLeaf;

        dataManager = {
            getSchema: () => mockSchema,
            loadDateRange: jest.fn(),
            loadDiariesForRange: jest.fn<any>().mockResolvedValue(new Map()),
            getEffectiveDuration: (entry: TimeEntry, start: Date, end: Date) => entry.durationMinutes,
        } as unknown as DataManager;
    });

    const createTestEntry = (params: {
        date: string;
        category: string;
        activity: string;
        durationMinutes: number;
    }): TimeEntry => {
        const startDateTime = new Date(`${params.date}T08:00:00`);
        const endDateTime = new Date(startDateTime.getTime() + params.durationMinutes * 60000);
        return {
            date: params.date,
            start: '08:00',
            end: '09:00',
            startDateTime,
            endDateTime,
            durationMinutes: params.durationMinutes,
            lineNumber: 1,
            description: params.activity,
            project: params.activity,
            activity: params.category,
            linkedNote: '',
            fields: {
                category: params.category,
                activity_name: params.activity,
            },
        };
    };

    it('renders Avg Sleep / Day card instead of Top Category card', async () => {
        const entries: TimeEntry[] = [
            createTestEntry({ date: '2026-10-15', category: '🌙 Sleep', activity: 'Sleep', durationMinutes: 480 }), // 8 hrs
            createTestEntry({ date: '2026-10-16', category: '🌙 Sleep', activity: 'Sleep', durationMinutes: 420 }), // 7 hrs
            createTestEntry({ date: '2026-10-16', category: 'Deep Work', activity: 'Coding', durationMinutes: 120 }),
        ];

        (dataManager.loadDateRange as any).mockResolvedValue(entries);

        const view = new ReportsView(leaf, DEFAULT_SETTINGS, dataManager);
        (view as any).containerEl = dom.window.document.getElementById('leaf') as HTMLElement;

        await view.onOpen();

        const container = (view as any).containerEl as HTMLElement;

        // Verify Top Category card is NOT present
        const topCategoryCard = container.querySelector('.reports-top-category-card');
        expect(topCategoryCard).toBeNull();
        expect(container.textContent).not.toContain('Top Category');

        // Verify Avg Sleep / Day card IS present
        const sleepCard = container.querySelector('.reports-sleep-card');
        expect(sleepCard).not.toBeNull();
        expect(sleepCard?.textContent).toContain('Avg Sleep / Day');
        // Average of 8h (480m) + 7h (420m) over 2 days = 7.5 hrs
        expect(sleepCard?.textContent).toContain('7.5 hrs');
    });

    it('renders pie chart with top 8 categories and groups the rest into Others', async () => {
        // Create 10 distinct categories with different durations
        const categories = [
            'Deep Work', 'Work', 'Fitness', 'Learning', 'Leisure',
            'Chores', 'Finance', 'Travel', 'Entertainment', '🌙 Sleep'
        ];

        const entries: TimeEntry[] = categories.map((cat, idx) =>
            createTestEntry({
                date: '2026-10-15',
                category: cat,
                activity: `Activity ${idx}`,
                durationMinutes: (10 - idx) * 60, // 10h, 9h, ..., 1h
            })
        );

        (dataManager.loadDateRange as any).mockResolvedValue(entries);

        const view = new ReportsView(leaf, DEFAULT_SETTINGS, dataManager);
        (view as any).containerEl = dom.window.document.getElementById('leaf') as HTMLElement;

        await view.onOpen();

        const container = (view as any).containerEl as HTMLElement;

        // Verify chart card is rendered
        const chartCard = container.querySelector('.reports-chart-card');
        expect(chartCard).not.toBeNull();

        // Verify SVG pie chart is present
        const svg = chartCard?.querySelector('svg.reports-pie-svg');
        expect(svg).not.toBeNull();

        // Slices: top 8 categories + 1 "Others" slice = 9 slices
        const slices = svg?.querySelectorAll('path.reports-pie-slice');
        expect(slices?.length).toBe(9);

        // Verify Legend has 9 items, ending with Others
        const legendItems = chartCard?.querySelectorAll('.reports-legend-item');
        expect(legendItems?.length).toBe(9);

        const lastLegendItem = legendItems?.[8];
        expect(lastLegendItem?.textContent).toContain('Others');
        // Categories 9 & 10 have 2h + 1h = 3h total (180m)
        expect(lastLegendItem?.textContent).toContain('3h');

        // Verify the list view table is still rendered alongside
        const table = container.querySelector('.reports-table');
        expect(table).not.toBeNull();
    });

    it('collapses category/activity list view by default and expands on click', async () => {
        const entries: TimeEntry[] = [
            createTestEntry({ date: '2026-10-15', category: 'Deep Work', activity: 'Coding', durationMinutes: 120 }),
            createTestEntry({ date: '2026-10-15', category: 'Deep Work', activity: 'Code Review', durationMinutes: 60 }),
            createTestEntry({ date: '2026-10-15', category: 'Fitness', activity: 'Running', durationMinutes: 45 }),
        ];

        (dataManager.loadDateRange as any).mockResolvedValue(entries);

        const view = new ReportsView(leaf, DEFAULT_SETTINGS, dataManager);
        (view as any).containerEl = dom.window.document.getElementById('leaf') as HTMLElement;

        await view.onOpen();

        const container = (view as any).containerEl as HTMLElement;

        // By default, nested activity rows should NOT be in the DOM
        let nestedRows = container.querySelectorAll('.reports-activity-nested-row');
        expect(nestedRows.length).toBe(0);

        // Category rows should be present
        const categoryRows = container.querySelectorAll('.reports-category-row');
        expect(categoryRows.length).toBe(2); // Deep Work and Fitness

        // Click on first category row (Deep Work)
        categoryRows[0].dispatchEvent(new dom.window.Event('click'));

        // Now nested rows for Deep Work should be expanded
        nestedRows = container.querySelectorAll('.reports-activity-nested-row');
        expect(nestedRows.length).toBe(2);
        expect(container.textContent).toContain('Coding');
        expect(container.textContent).toContain('Code Review');

        // Click again to collapse
        const updatedCategoryRows = container.querySelectorAll('.reports-category-row');
        updatedCategoryRows[0].dispatchEvent(new dom.window.Event('click'));

        nestedRows = container.querySelectorAll('.reports-activity-nested-row');
        expect(nestedRows.length).toBe(0);
    });

    it('renders daily diary timeline in descending date order below category list view', async () => {
        const entries: TimeEntry[] = [
            createTestEntry({ date: '2026-10-16', category: 'Fitness', activity: 'Climbing', durationMinutes: 60 }),
            createTestEntry({ date: '2026-10-18', category: 'Deep Work', activity: 'Coding', durationMinutes: 90 }),
            createTestEntry({ date: '2026-10-18', category: '🌙 Sleep', activity: 'Night Sleep', durationMinutes: 480 }),
        ];

        const diariesMap = new Map<string, DailyDiary>([
            ['2026-10-18', { date: '2026-10-18', content: 'Reflection for Oct 18' }],
            ['2026-10-16', { date: '2026-10-16', content: 'Climbing was great today' }],
        ]);

        (dataManager.loadDateRange as any).mockResolvedValue(entries);
        (dataManager.loadDiariesForRange as any).mockResolvedValue(diariesMap);

        const view = new ReportsView(leaf, DEFAULT_SETTINGS, dataManager);
        (view as any).containerEl = dom.window.document.getElementById('leaf') as HTMLElement;

        // Set custom date range Oct 16 to Oct 18
        (view as any).selectedPreset = 'custom';
        (view as any).customStartDate = new Date(2026, 9, 16);
        (view as any).customEndDate = new Date(2026, 9, 18);

        await view.onOpen();

        const container = (view as any).containerEl as HTMLElement;

        // Verify timeline section is below table
        const timelineContainer = container.querySelector('.reports-diary-timeline-container');
        expect(timelineContainer).not.toBeNull();

        // Check timeline items are ordered DESC: 2026-10-18, 2026-10-17, 2026-10-16
        const timelineItems = timelineContainer?.querySelectorAll('.reports-timeline-item');
        expect(timelineItems?.length).toBe(3);

        // Day 1: 2026-10-18 (has diary + activities)
        const day1 = timelineItems?.[0];
        expect(day1?.textContent).toContain('2026-10-18');
        expect(day1?.textContent).toContain('Reflection for Oct 18');
        expect(day1?.textContent).toContain('Coding');
        expect(day1?.textContent).toContain('Night Sleep');

        // Verify "Daily Diary" subheading is removed and diary content is right beneath the date
        const diarySection = day1?.querySelector('.reports-timeline-diary-section');
        expect(diarySection).not.toBeNull();
        expect(diarySection?.querySelector('.reports-timeline-subheading')).toBeNull();
        const diaryText = diarySection?.querySelector('.reports-timeline-diary-text');
        expect(diaryText?.textContent).toBe('Reflection for Oct 18');

        // Verify activities chips exist in the list
        const actPills = day1?.querySelectorAll('.reports-timeline-act-pill');
        expect(actPills?.length).toBeGreaterThan(0);

        // Day 2: 2026-10-17 (missing diary and missing activities -> shows (None), does not skip day)
        const day2 = timelineItems?.[1];
        expect(day2?.textContent).toContain('2026-10-17');
        expect(day2?.textContent).toContain('(None)');

        // Day 3: 2026-10-16 (has diary + activities)
        const day3 = timelineItems?.[2];
        expect(day3?.textContent).toContain('2026-10-16');
        expect(day3?.textContent).toContain('Climbing was great today');
        expect(day3?.textContent).toContain('Climbing');
    });
});

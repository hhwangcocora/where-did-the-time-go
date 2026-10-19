import { ReportAggregator, getEntryFieldValue, getNodeColor } from '../src/data/ReportAggregator';
import { DEFAULT_SCHEMA_CONFIG, TimeEntry, TrackingSchemaConfig } from '../src/types';

describe('ReportAggregator', () => {
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
                    { id: 'deep-work', label: 'Deep Work', color: '#6366f1' },
                    { id: 'fitness', label: 'Fitness', color: '#10b981' },
                    { id: 'leisure', label: 'Leisure', color: '#f59e0b' },
                ],
                ui: { widget: 'dropdown', timelineRole: 'color' },
            },
            {
                id: 'activity_name',
                label: 'Activity Name',
                type: 'string',
                required: true,
                multiple: false,
                ui: { widget: 'text', timelineRole: 'title' },
            },
            {
                id: 'location',
                label: 'Location',
                type: 'enum',
                required: false,
                multiple: false,
                options: [
                    { id: 'home', label: 'Home Office', color: '#3b82f6' },
                    { id: 'gym', label: 'Gym', color: '#ef4444' },
                ],
                ui: { widget: 'dropdown', timelineRole: 'badge' },
            },
            {
                id: 'tags',
                label: 'Tags',
                type: 'string',
                required: false,
                multiple: true,
                ui: { widget: 'tags', timelineRole: 'hidden' },
            },
        ],
        defaultReportGrouping: ['category', 'activity_name', 'location'],
    };

    const createEntry = (params: {
        date: string;
        start: string;
        end: string;
        durationMinutes: number;
        category?: string;
        activity_name?: string;
        location?: string;
        tags?: string[];
    }): TimeEntry => {
        const startDateTime = new Date(`${params.date}T${params.start}:00`);
        const endDateTime = new Date(`${params.date}T${params.end}:00`);

        const fields: Record<string, string | string[]> = {};
        if (params.category !== undefined) fields.category = params.category;
        if (params.activity_name !== undefined) fields.activity_name = params.activity_name;
        if (params.location !== undefined) fields.location = params.location;
        if (params.tags !== undefined) fields.tags = params.tags;

        return {
            date: params.date,
            start: params.start,
            end: params.end,
            startDateTime,
            endDateTime,
            durationMinutes: params.durationMinutes,
            lineNumber: 1,
            description: params.activity_name || '',
            project: params.activity_name || '',
            activity: params.category || '',
            linkedNote: '',
            fields,
        };
    };

    const rangeStart = new Date('2026-10-01T00:00:00');
    const rangeEnd = new Date('2026-10-31T23:59:59');

    describe('getEntryFieldValue & getNodeColor', () => {
        it('extracts direct fields and composite multi-value fields', () => {
            const entry = createEntry({
                date: '2026-10-15',
                start: '09:00',
                end: '10:00',
                durationMinutes: 60,
                category: 'Deep Work',
                tags: ['coding', 'planning'],
            });

            expect(getEntryFieldValue(entry, 'category', mockSchema)).toBe('Deep Work');
            expect(getEntryFieldValue(entry, 'tags', mockSchema)).toBe('coding, planning');
            expect(getEntryFieldValue(entry, 'location', mockSchema)).toBe('(None)');
        });

        it('resolves configured enum color or fallback deterministic color', () => {
            expect(getNodeColor('category', 'Deep Work', mockSchema)).toBe('#6366f1');
            expect(getNodeColor('category', 'Fitness', mockSchema)).toBe('#10b981');
            expect(getNodeColor('category', '(None)', mockSchema)).toBe('#888888');

            const unconfiguredColor = getNodeColor('activity_name', 'Random Task', mockSchema);
            expect(unconfiguredColor).toMatch(/^#[0-9a-f]{6}$/i);
        });
    });

    describe('1-Level Aggregation', () => {
        it('aggregates entries by single dimension (category)', () => {
            const entries: TimeEntry[] = [
                createEntry({ date: '2026-10-15', start: '09:00', end: '11:00', durationMinutes: 120, category: 'Deep Work' }),
                createEntry({ date: '2026-10-15', start: '11:00', end: '12:00', durationMinutes: 60, category: 'Fitness' }),
                createEntry({ date: '2026-10-16', start: '14:00', end: '15:00', durationMinutes: 60, category: 'Deep Work' }),
            ];

            const result = ReportAggregator.calculateAggregation({
                entries,
                dimensions: ['category'],
                schema: mockSchema,
                rangeStart,
                rangeEnd,
            });

            expect(result.activeDimensions).toEqual(['category']);
            expect(result.stats.totalMinutes).toBe(240);
            expect(result.stats.activeDaysCount).toBe(2);
            expect(result.stats.dailyAverageMinutes).toBe(120); // 240 / 2 days
            expect(result.stats.topFocusLabel).toBe('Deep Work');
            expect(result.stats.topFocusMinutes).toBe(180);

            expect(result.tree).toHaveLength(2);
            // Deep Work
            expect(result.tree[0].label).toBe('Deep Work');
            expect(result.tree[0].totalMinutes).toBe(180);
            expect(result.tree[0].percentageOfTotal).toBe(75);
            expect(result.tree[0].percentageOfParent).toBe(75);
            expect(result.tree[0].depth).toBe(0);
            expect(result.tree[0].children).toEqual([]);

            // Fitness
            expect(result.tree[1].label).toBe('Fitness');
            expect(result.tree[1].totalMinutes).toBe(60);
            expect(result.tree[1].percentageOfTotal).toBe(25);
            expect(result.tree[1].depth).toBe(0);
        });
    });

    describe('2-Level Aggregation', () => {
        it('nests secondary dimension under primary dimension', () => {
            const entries: TimeEntry[] = [
                createEntry({ date: '2026-10-15', start: '09:00', end: '11:00', durationMinutes: 120, category: 'Deep Work', activity_name: 'Plugin Dev' }),
                createEntry({ date: '2026-10-15', start: '11:00', end: '12:00', durationMinutes: 60, category: 'Deep Work', activity_name: 'Code Review' }),
                createEntry({ date: '2026-10-16', start: '08:00', end: '09:00', durationMinutes: 60, category: 'Fitness', activity_name: 'Morning Run' }),
            ];

            const result = ReportAggregator.calculateAggregation({
                entries,
                dimensions: ['category', 'activity_name'],
                schema: mockSchema,
                rangeStart,
                rangeEnd,
            });

            expect(result.activeDimensions).toEqual(['category', 'activity_name']);
            expect(result.tree).toHaveLength(2);

            const deepWork = result.tree[0];
            expect(deepWork.label).toBe('Deep Work');
            expect(deepWork.totalMinutes).toBe(180);
            expect(deepWork.children).toHaveLength(2);

            // Sub-item 1: Plugin Dev (120m out of 180m = 66.67% of parent, 50% of total)
            const pluginDev = deepWork.children[0];
            expect(pluginDev.label).toBe('Plugin Dev');
            expect(pluginDev.totalMinutes).toBe(120);
            expect(pluginDev.percentageOfParent).toBeCloseTo(66.67, 1);
            expect(pluginDev.percentageOfTotal).toBe(50);
            expect(pluginDev.depth).toBe(1);

            // Sub-item 2: Code Review (60m out of 180m = 33.33% of parent, 25% of total)
            const codeReview = deepWork.children[1];
            expect(codeReview.label).toBe('Code Review');
            expect(codeReview.totalMinutes).toBe(60);
            expect(codeReview.percentageOfParent).toBeCloseTo(33.33, 1);
            expect(codeReview.percentageOfTotal).toBe(25);
            expect(codeReview.depth).toBe(1);
        });
    });

    describe('3-Level Aggregation', () => {
        it('nests 3 dimensions deeply: category -> activity_name -> location', () => {
            const entries: TimeEntry[] = [
                createEntry({
                    date: '2026-10-15',
                    start: '09:00',
                    end: '11:00',
                    durationMinutes: 120,
                    category: 'Deep Work',
                    activity_name: 'Plugin Dev',
                    location: 'Home Office',
                }),
                createEntry({
                    date: '2026-10-16',
                    start: '09:00',
                    end: '10:00',
                    durationMinutes: 60,
                    category: 'Deep Work',
                    activity_name: 'Plugin Dev',
                    location: 'Gym',
                }),
            ];

            const result = ReportAggregator.calculateAggregation({
                entries,
                dimensions: ['category', 'activity_name', 'location'],
                schema: mockSchema,
                rangeStart,
                rangeEnd,
            });

            expect(result.activeDimensions).toEqual(['category', 'activity_name', 'location']);
            const root = result.tree[0];
            expect(root.label).toBe('Deep Work');
            expect(root.totalMinutes).toBe(180);

            const activity = root.children[0];
            expect(activity.label).toBe('Plugin Dev');
            expect(activity.totalMinutes).toBe(180);
            expect(activity.children).toHaveLength(2);

            const loc1 = activity.children[0];
            expect(loc1.label).toBe('Home Office');
            expect(loc1.totalMinutes).toBe(120);
            expect(loc1.percentageOfParent).toBeCloseTo(66.67, 1);
            expect(loc1.depth).toBe(2);

            const loc2 = activity.children[1];
            expect(loc2.label).toBe('Gym');
            expect(loc2.totalMinutes).toBe(60);
            expect(loc2.percentageOfParent).toBeCloseTo(33.33, 1);
            expect(loc2.depth).toBe(2);
        });
    });

    describe('Edge Cases', () => {
        it('handles empty entries gracefully', () => {
            const result = ReportAggregator.calculateAggregation({
                entries: [],
                dimensions: ['category'],
                schema: mockSchema,
                rangeStart,
                rangeEnd,
            });

            expect(result.tree).toEqual([]);
            expect(result.stats.totalMinutes).toBe(0);
            expect(result.stats.dailyAverageMinutes).toBe(0);
            expect(result.stats.activeDaysCount).toBe(0);
            expect(result.stats.topFocusLabel).toBe('(None)');
            expect(result.stats.topFocusMinutes).toBe(0);
        });

        it('filters empty dimension strings and defaults if all empty', () => {
            const entries: TimeEntry[] = [
                createEntry({ date: '2026-10-15', start: '09:00', end: '10:00', durationMinutes: 60, category: 'Deep Work', location: 'Home Office' }),
            ];

            const result = ReportAggregator.calculateAggregation({
                entries,
                dimensions: ['category', '', 'location'],
                schema: mockSchema,
                rangeStart,
                rangeEnd,
            });

            // Empty middle dimension should be filtered out, leaving 2 levels
            expect(result.activeDimensions).toEqual(['category', 'location']);
            expect(result.tree[0].label).toBe('Deep Work');
            expect(result.tree[0].children[0].label).toBe('Home Office');
        });

        it('uses schema defaultReportGrouping when empty dimensions array is passed', () => {
            const entries: TimeEntry[] = [
                createEntry({ date: '2026-10-15', start: '09:00', end: '10:00', durationMinutes: 60, category: 'Deep Work' }),
            ];

            const result = ReportAggregator.calculateAggregation({
                entries,
                dimensions: [],
                schema: mockSchema,
                rangeStart,
                rangeEnd,
            });

            expect(result.activeDimensions).toEqual(mockSchema.defaultReportGrouping);
        });
    });

    describe('calculateCategoryReport', () => {
        it('calculates time spent on each category with activity sub-breakdown', () => {
            const entries: TimeEntry[] = [
                createEntry({ date: '2026-10-15', start: '09:00', end: '11:00', durationMinutes: 120, category: 'Deep Work', activity_name: 'Plugin Dev' }),
                createEntry({ date: '2026-10-15', start: '11:00', end: '12:00', durationMinutes: 60, category: 'Deep Work', activity_name: 'Code Review' }),
                createEntry({ date: '2026-10-16', start: '08:00', end: '09:00', durationMinutes: 60, category: 'Fitness', activity_name: 'Morning Run' }),
                createEntry({ date: '2026-10-16', start: '10:00', end: '11:00', durationMinutes: 60, category: 'Personal', activity_name: 'Meditation' }),
            ];

            const report = ReportAggregator.calculateCategoryReport({
                entries,
                schema: mockSchema,
                rangeStart,
                rangeEnd,
            });

            expect(report.categoriesCount).toBe(3);
            expect(report.activeDaysCount).toBe(2);
            expect(report.topCategoryName).toBe('Deep Work');
            expect(report.topCategoryMinutes).toBe(180);

            expect(report.items).toHaveLength(3);

            // Deep Work: 180m (60% of 300m)
            const deepWork = report.items[0];
            expect(deepWork.category).toBe('Deep Work');
            expect(deepWork.totalMinutes).toBe(180);
            expect(deepWork.percentageOfTime).toBe(60);
            expect(deepWork.entryCount).toBe(2);
            expect(deepWork.activities).toHaveLength(2);
            expect(deepWork.activities[0].name).toBe('Plugin Dev');
            expect(deepWork.activities[0].totalMinutes).toBe(120);
            expect(deepWork.activities[0].percentageOfCategory).toBeCloseTo(66.67, 1);
            expect(deepWork.activities[1].name).toBe('Code Review');
            expect(deepWork.activities[1].totalMinutes).toBe(60);
            expect(deepWork.activities[1].percentageOfCategory).toBeCloseTo(33.33, 1);

            // Fitness: 60m (20% of 300m)
            const fitness = report.items[1];
            expect(fitness.category).toBe('Fitness');
            expect(fitness.totalMinutes).toBe(60);
            expect(fitness.percentageOfTime).toBe(20);

            // Personal: 60m (20% of 300m)
            const personal = report.items[2];
            expect(personal.category).toBe('Personal');
            expect(personal.totalMinutes).toBe(60);
            expect(personal.percentageOfTime).toBe(20);
        });

        it('handles empty entries without error', () => {
            const report = ReportAggregator.calculateCategoryReport({
                entries: [],
                schema: mockSchema,
                rangeStart,
                rangeEnd,
            });

            expect(report.categoriesCount).toBe(0);
            expect(report.activeDaysCount).toBe(0);
            expect(report.topCategoryName).toBe('(None)');
            expect(report.topCategoryMinutes).toBe(0);
            expect(report.items).toEqual([]);
        });

        it('normalizes enum option slug IDs and display labels into the same category', () => {
            const entries: TimeEntry[] = [
                createEntry({ date: '2026-10-15', start: '09:00', end: '10:00', durationMinutes: 60, category: 'Deep Work', activity_name: 'Coding' }),
                createEntry({ date: '2026-10-15', start: '10:00', end: '11:30', durationMinutes: 90, category: 'deep-work', activity_name: 'Coding' }),
            ];

            const report = ReportAggregator.calculateCategoryReport({
                entries,
                schema: mockSchema,
                rangeStart,
                rangeEnd,
            });

            expect(report.categoriesCount).toBe(1);
            expect(report.topCategoryName).toBe('Deep Work');
            expect(report.topCategoryMinutes).toBe(150);
            expect(report.items).toHaveLength(1);
            expect(report.items[0].category).toBe('Deep Work');
            expect(report.items[0].totalMinutes).toBe(150);
            expect(report.items[0].entryCount).toBe(2);
        });
    });
});

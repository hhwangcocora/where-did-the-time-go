import { jest } from '@jest/globals';
import { JSDOM } from 'jsdom';
import { WorkspaceLeaf } from 'obsidian';
import { setupDomPrototypes } from './__mocks__/obsidian';
import { TimelineView } from '../src/views/TimelineView';
import { DataManager } from '../src/data/DataManager';
import { DEFAULT_SETTINGS, TimeEntry, TrackingSchemaConfig } from '../src/types';
import { getColorForValue, FIXED_LOCATION_COLOR } from '../src/utils/colors';

describe('TimelineView Dynamic Card Helpers', () => {
    let view: TimelineView;
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
                    { id: 'Deep Work', label: 'Deep Work', color: '#4f46e5' },
                    { id: 'Fitness', label: 'Fitness', color: '#059669' },
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
            {
                id: 'location',
                label: 'Location',
                type: 'enum',
                required: false,
                multiple: false,
                options: [
                    { id: 'Home Office', label: 'Home Office', color: FIXED_LOCATION_COLOR },
                ],
                ui: { timelineRole: 'badge' },
            },
            {
                id: 'tags',
                label: 'Tags',
                type: 'string',
                required: false,
                multiple: true,
                ui: { timelineRole: 'content' },
            },
            {
                id: 'notes',
                label: 'Notes',
                type: 'string',
                required: false,
                multiple: false,
                ui: { timelineRole: 'content' },
            },
        ],
        defaultReportGrouping: ['category', 'activity_name', 'location'],
    };

    beforeEach(() => {
        const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        (global as any).window = dom.window;
        (global as any).document = dom.window.document;
        (global as any).HTMLElement = dom.window.HTMLElement;
        setupDomPrototypes();

        dataManager = {
            getSchema: () => mockSchema,
        } as unknown as DataManager;

        view = new TimelineView(new WorkspaceLeaf(), DEFAULT_SETTINGS, dataManager);
    });

    const createSampleEntry = (overrides?: Partial<TimeEntry>): TimeEntry => ({
        date: '2026-01-15',
        start: '09:00',
        end: '10:30',
        description: 'Legacy description',
        client: 'Internal',
        startDateTime: new Date(2026, 0, 15, 9, 0),
        endDateTime: new Date(2026, 0, 15, 10, 30),
        lineNumber: 1,
        durationMinutes: 90,
        fields: {
            category: 'Deep Work',
            activity_name: 'Core System Refactor',
            location: 'Home Office',
            tags: ['typescript', 'architecture'],
            notes: 'Detailed notes on changes',
        },
        ...overrides,
    });

    describe('getEntryColor', () => {
        it('returns explicit color from enum option when configured', () => {
            const entry = createSampleEntry({ fields: { category: 'Deep Work' } });
            const color = (view as any).getEntryColor(entry);
            expect(color).toBe('#4f46e5');
        });

        it('returns deterministic hashed color when option has no explicit color', () => {
            const entry = createSampleEntry({ fields: { category: 'Creative' } });
            const color = (view as any).getEntryColor(entry);
            expect(color).toBe(getColorForValue('Creative'));
        });

        it('falls back to default color when field is absent', () => {
            const entry = createSampleEntry({ fields: {}, activity: undefined, client: '' });
            const color = (view as any).getEntryColor(entry);
            expect(color).toBe('#4f46e5');
        });
    });

    describe('getEntryTitle', () => {
        it('uses title field value when populated', () => {
            const entry = createSampleEntry();
            const title = (view as any).getEntryTitle(entry);
            expect(title).toBe('Core System Refactor');
        });

        it('falls back to description when title field is missing', () => {
            const entry = createSampleEntry({
                description: 'Fallback description',
                fields: { category: 'Deep Work' },
            });
            const title = (view as any).getEntryTitle(entry);
            expect(title).toBe('Fallback description');
        });

        it('returns (Untitled) when both title field and description are missing', () => {
            const entry = createSampleEntry({
                description: '',
                fields: {},
            });
            const title = (view as any).getEntryTitle(entry);
            expect(title).toBe('(Untitled)');
        });
    });

    describe('getEntryBadges', () => {
        it('extracts location badge in fixed color and excludes tags from colored card badges', () => {
            const entry = createSampleEntry();
            const badges = (view as any).getEntryBadges(entry);

            expect(badges).toHaveLength(1);
            expect(badges[0]).toEqual({
                label: 'Location',
                text: 'Home Office',
                color: FIXED_LOCATION_COLOR,
                isLocation: true,
            });
        });

        it('ensures all locations use the same fixed color while categories have different colors', () => {
            const entry1 = createSampleEntry({ fields: { category: 'Deep Work', location: 'Coffee Shop' } });
            const entry2 = createSampleEntry({ fields: { category: 'Fitness', location: 'Gym' } });
            const badges1 = (view as any).getEntryBadges(entry1);
            const badges2 = (view as any).getEntryBadges(entry2);

            expect(badges1[0].color).toBe(FIXED_LOCATION_COLOR);
            expect(badges2[0].color).toBe(FIXED_LOCATION_COLOR);
            expect(badges1[0].color).toBe(badges2[0].color);
        });

        it('returns empty array when badge fields are empty', () => {
            const entry = createSampleEntry({
                project: undefined,
                activity: undefined,
                fields: {
                    category: 'Deep Work',
                    activity_name: 'Solo work',
                },
            });
            const badges = (view as any).getEntryBadges(entry);
            expect(badges).toEqual([]);
        });
    });

    describe('getEntryNotesAndTags', () => {
        it('formats content fields inside the note section as separate lines (FieldName: value(s))', () => {
            const entry = createSampleEntry();
            const noteContent: string = (view as any).getEntryNotesAndTags(entry);

            expect(noteContent).toBe('Tags: typescript, architecture\nNotes: Detailed notes on changes');
        });

        it('formats single content field when other content fields are empty', () => {
            const entry = createSampleEntry({
                fields: {
                    tags: ['design', 'review'],
                },
            });
            const noteContent: string = (view as any).getEntryNotesAndTags(entry);

            expect(noteContent).toBe('Tags: design, review');
        });

        it('does not format hidden fields in card content', () => {
            const schemaWithHidden: TrackingSchemaConfig = {
                ...mockSchema,
                fields: [
                    ...mockSchema.fields,
                    {
                        id: 'internal_id',
                        label: 'Internal ID',
                        type: 'string',
                        required: false,
                        multiple: false,
                        ui: { timelineRole: 'hidden' },
                    },
                ],
            };
            (view as any).dataManager = {
                getSchema: () => schemaWithHidden,
            };

            const entry = createSampleEntry({
                fields: {
                    tags: ['design'],
                    internal_id: 'secret-123',
                },
            });
            const noteContent: string = (view as any).getEntryNotesAndTags(entry);

            expect(noteContent).toBe('Tags: design');
            expect(noteContent).not.toContain('secret-123');
        });
    });

    describe('getEntryTooltip', () => {
        it('generates rich tooltip with title, time, duration, and populated schema attributes', () => {
            const entry = createSampleEntry();
            const tooltip: string = (view as any).getEntryTooltip(entry);

            expect(tooltip).toContain('Core System Refactor');
            expect(tooltip).toContain('09:00 – 10:30');
            expect(tooltip).toContain('Category: Deep Work');
            expect(tooltip).toContain('Location: Home Office');
            expect(tooltip).toContain('Tags: typescript, architecture');
            expect(tooltip).toContain('Notes: Detailed notes on changes');
            // Shouldn't mention freelance Client
            expect(tooltip).not.toContain('Client:');
        });
    });

    describe('Regular category behavior for Sleep', () => {
        it('renders sleep entries as regular cards without collapsible behavior', () => {
            const sleepEntry = createSampleEntry({
                start: '23:00',
                end: '07:00',
                durationMinutes: 480,
                fields: { category: 'Sleep', activity_name: 'Sleep' },
            });

            const container = document.createElement('div');
            (view as any).entriesContainer = container;
            (view as any).renderEntryCard(sleepEntry, 0);

            const card = container.querySelector('.timeline-entry-card') as HTMLElement;
            expect(card).toBeDefined();
            expect(card.classList.contains('entry-sleep')).toBe(false);
            expect(card.classList.contains('entry-sleep-collapsed')).toBe(false);
            // 480 mins at default 200px/hr = 8 * 200 = 1600px
            expect(parseFloat(card.style.height)).toBe(1600);
            expect(card.querySelector('.entry-sleep-tag')).toBeNull();
            expect(card.querySelector('.entry-icon-toggle')).toBeNull();
        });
    });

    describe('scrollToToday and vertical centering', () => {
        it('scrollToToday centers 10:00 AM vertically in the viewport', async () => {
            const container = document.createElement('div');
            Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
            (view as any).timelineContainer = container;
            (view as any).visibleDaysBuffer = 3;
            (view as any).dayHeight = 24 * 200;
            (view as any).settings.hourHeight = 200;

            (view as any).loadVisibleRange = jest.fn().mockImplementation(async () => {});
            (view as any).renderVisibleDays = jest.fn().mockImplementation(() => {});
            (view as any).updateVisibleDateLabel = jest.fn();

            view.scrollToToday();
            await new Promise(resolve => setTimeout(resolve, 0));

            // targetScroll = (3 * 4800 + 10 * 200) - (600 / 2) = 14400 + 2000 - 300 = 16100
            expect(container.scrollTop).toBe(16100);
        });

        it('scrollToDate positions dayStartHour at the top when centerHour is not provided', async () => {
            const container = document.createElement('div');
            Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
            (view as any).timelineContainer = container;
            (view as any).visibleDaysBuffer = 3;
            (view as any).dayHeight = 24 * 200;
            (view as any).settings.hourHeight = 200;
            (view as any).settings.dayStartHour = 6;

            (view as any).loadVisibleRange = jest.fn().mockImplementation(async () => {});
            (view as any).renderVisibleDays = jest.fn().mockImplementation(() => {});
            (view as any).updateVisibleDateLabel = jest.fn();

            view.scrollToDate(new Date(2026, 9, 18));
            await new Promise(resolve => setTimeout(resolve, 0));

            // targetOffset = 3 * 4800 + 6 * 200 = 14400 + 1200 = 15600
            expect(container.scrollTop).toBe(15600);
        });
    });
});

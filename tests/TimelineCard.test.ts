import { jest } from '@jest/globals';
import { JSDOM } from 'jsdom';
import { WorkspaceLeaf } from 'obsidian';
import { setupDomPrototypes } from './__mocks__/obsidian';
import { TimelineView } from '../src/views/TimelineView';
import { DataManager } from '../src/data/DataManager';
import { DEFAULT_SETTINGS, TimeEntry, TrackingSchemaConfig } from '../src/types';
import { getColorForValue } from '../src/utils/colors';

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
                    { id: 'Home Office', label: 'Home Office', color: '#0284c7' },
                ],
                ui: { timelineRole: 'badge' },
            },
            {
                id: 'tags',
                label: 'Tags',
                type: 'string',
                required: false,
                multiple: true,
                ui: { timelineRole: 'hidden' },
            },
            {
                id: 'notes',
                label: 'Notes',
                type: 'string',
                required: false,
                multiple: false,
                ui: { timelineRole: 'hidden' },
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
        it('extracts location badge and excludes tags from colored card badges', () => {
            const entry = createSampleEntry();
            const badges = (view as any).getEntryBadges(entry);

            expect(badges).toHaveLength(1);
            expect(badges[0]).toEqual({
                label: 'Location',
                text: 'Home Office',
                color: '#0284c7',
            });
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
        it('formats notes and tags for inside the note section', () => {
            const entry = createSampleEntry();
            const noteContent: string = (view as any).getEntryNotesAndTags(entry);

            expect(noteContent).toBe('Detailed notes on changes · #typescript #architecture');
        });

        it('formats tags only when notes is empty', () => {
            const entry = createSampleEntry({
                fields: {
                    tags: ['design', 'review'],
                },
            });
            const noteContent: string = (view as any).getEntryNotesAndTags(entry);

            expect(noteContent).toBe('#design #review');
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
});

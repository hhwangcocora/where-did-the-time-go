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
            // 480 mins at default 100px/hr = 8 * 100 = 800px
            expect(parseFloat(card.style.height)).toBe(800);
            expect(card.querySelector('.entry-sleep-tag')).toBeNull();
            expect(card.querySelector('.entry-icon-toggle')).toBeNull();
        });

        it('renders 15-minute entries with proportional 25px height at 100px/hr', () => {
            const shortEntry = createSampleEntry({
                start: '09:00',
                end: '09:15',
                durationMinutes: 15,
                fields: { category: 'Deep Work', activity_name: 'Quick Standup' },
            });

            const container = document.createElement('div');
            (view as any).entriesContainer = container;
            (view as any).renderEntryCard(shortEntry, 0);

            const card = container.querySelector('.timeline-entry-card') as HTMLElement;
            expect(card).toBeDefined();
            expect(card.classList.contains('entry-15m')).toBe(true);
            expect(parseFloat(card.style.height)).toBe(25);
        });

        it('renders 15-minute entries with full category, location, and activity name in compact header', () => {
            const shortEntry = createSampleEntry({
                start: '09:00',
                end: '09:15',
                durationMinutes: 15,
                fields: {
                    category: 'Deep Work',
                    location: 'Home Office',
                    activity_name: 'Quick Standup',
                },
            });

            const container = document.createElement('div');
            (view as any).entriesContainer = container;
            (view as any).renderEntryCard(shortEntry, 0);

            const card = container.querySelector('.timeline-entry-card') as HTMLElement;
            expect(card).toBeDefined();
            expect(card.classList.contains('entry-15m')).toBe(true);

            const compactDetails = card.querySelector('.entry-compact-details') as HTMLElement;
            expect(compactDetails).not.toBeNull();

            // 1. Category (full name)
            const catEl = compactDetails.querySelector('.entry-compact-category') as HTMLElement;
            expect(catEl).not.toBeNull();
            expect(catEl.textContent).toBe('Deep Work');
            expect(catEl.getAttribute('title')).toBe('Deep Work');

            // 2. Location (full name - not truncated to 3 letters)
            const locEl = compactDetails.querySelector('.entry-compact-location') as HTMLElement;
            expect(locEl).not.toBeNull();
            expect(locEl.textContent).toBe('Home Office');
            expect(locEl.textContent).not.toBe('HOM');
            expect(locEl.getAttribute('title')).toBe('Home Office');

            // 3. Activity name (full name)
            const actEl = compactDetails.querySelector('.entry-compact-activity') as HTMLElement;
            expect(actEl).not.toBeNull();
            expect(actEl.textContent).toBe('Quick Standup');
            expect(actEl.getAttribute('title')).toBe('Quick Standup');

            // Verify order in compactDetails: Category -> Location -> Activity
            const children = Array.from(compactDetails.children);
            expect(children[0]).toBe(catEl);
            expect(children[1]).toBe(locEl);
            expect(children[2]).toBe(actEl);
        });

        it('renders compact line when location is omitted', () => {
            const shortEntry = createSampleEntry({
                start: '14:00',
                end: '14:15',
                durationMinutes: 15,
                fields: {
                    category: 'Fitness',
                    activity_name: 'Stretch Break',
                },
            });

            const container = document.createElement('div');
            (view as any).entriesContainer = container;
            (view as any).renderEntryCard(shortEntry, 0);

            const card = container.querySelector('.timeline-entry-card') as HTMLElement;
            const compactDetails = card.querySelector('.entry-compact-details') as HTMLElement;
            expect(compactDetails).not.toBeNull();

            const catEl = compactDetails.querySelector('.entry-compact-category') as HTMLElement;
            expect(catEl.textContent).toBe('Fitness');

            const locEl = compactDetails.querySelector('.entry-compact-location');
            expect(locEl).toBeNull();

            const actEl = compactDetails.querySelector('.entry-compact-activity') as HTMLElement;
            expect(actEl.textContent).toBe('Stretch Break');
        });
    });

    describe('scrollToToday, scrollToNow, and date navigation to 9:00 AM at top', () => {
        it('scrollToToday positions 9:00 AM at the top of the viewport', async () => {
            const container = document.createElement('div');
            Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
            (view as any).timelineContainer = container;
            (view as any).visibleDaysBuffer = 3;
            (view as any).dayHeight = 24 * 100;
            (view as any).settings.hourHeight = 100;
            (view as any).settings.dayStartHour = 9;

            (view as any).loadVisibleRange = jest.fn().mockImplementation(async () => {});
            (view as any).renderVisibleDays = jest.fn().mockImplementation(() => {});
            (view as any).updateVisibleDateLabel = jest.fn();

            view.scrollToToday();
            await new Promise(resolve => setTimeout(resolve, 0));

            // targetOffset = 3 * 2400 + 9 * 100 = 7200 + 900 = 8100
            expect(container.scrollTop).toBe(8100);
        });

        it('scrollToNow centers the current time indicator in the viewport', async () => {
            jest.useFakeTimers();
            jest.setSystemTime(new Date(2026, 9, 18, 14, 30, 0));

            const container = document.createElement('div');
            Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
            (view as any).timelineContainer = container;
            (view as any).visibleDaysBuffer = 3;
            (view as any).dayHeight = 24 * 100;
            (view as any).settings.hourHeight = 100;
            (view as any).settings.dayStartHour = 9;

            (view as any).loadVisibleRange = jest.fn().mockImplementation(async () => {});
            (view as any).renderVisibleDays = jest.fn().mockImplementation(() => {});
            (view as any).updateVisibleDateLabel = jest.fn();

            view.scrollToNow();
            await Promise.resolve();

            // nowOffset = 3 * 2400 + 14.5 * 100 = 7200 + 1450 = 8650
            // targetScroll = 8650 - (600 / 2) = 8350
            expect(container.scrollTop).toBe(8350);

            jest.useRealTimers();
        });

        it('scrollToDate positions 9:00 AM at the top of the viewport by default', async () => {
            const container = document.createElement('div');
            Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
            (view as any).timelineContainer = container;
            (view as any).visibleDaysBuffer = 3;
            (view as any).dayHeight = 24 * 100;
            (view as any).settings.hourHeight = 100;
            (view as any).settings.dayStartHour = 9;

            (view as any).loadVisibleRange = jest.fn().mockImplementation(async () => {});
            (view as any).renderVisibleDays = jest.fn().mockImplementation(() => {});
            (view as any).updateVisibleDateLabel = jest.fn();

            view.scrollToDate(new Date(2026, 9, 18));
            await new Promise(resolve => setTimeout(resolve, 0));

            // targetOffset = 3 * 2400 + 9 * 100 = 7200 + 900 = 8100
            expect(container.scrollTop).toBe(8100);
        });

        it('navigateDays positions 9:00 AM at the top of the viewport', async () => {
            const container = document.createElement('div');
            Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
            (view as any).timelineContainer = container;
            (view as any).visibleDaysBuffer = 3;
            (view as any).dayHeight = 24 * 100;
            (view as any).settings.hourHeight = 100;
            (view as any).settings.dayStartHour = 9;
            (view as any).centerDate = new Date(2026, 9, 18);

            (view as any).loadVisibleRange = jest.fn().mockImplementation(async () => {});
            (view as any).renderVisibleDays = jest.fn().mockImplementation(() => {});
            (view as any).updateVisibleDateLabel = jest.fn();

            (view as any).navigateDays(1);
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(container.scrollTop).toBe(8100);
        });
    });

    describe('finalizeEntryDrag minute rounding', () => {
        it('snaps 55-minute drag position to next hour (:00) instead of invalid HH:60', async () => {
            const updateEntryMock = jest.fn<any>().mockResolvedValue(undefined);
            (view as any).dataManager = {
                getSchema: () => mockSchema,
                updateEntry: updateEntryMock,
            };
            (view as any).refresh = jest.fn<any>().mockResolvedValue(undefined);
            (view as any).visibleDaysBuffer = 1;
            (view as any).dayHeight = 24 * 100;
            (view as any).settings.hourHeight = 100;
            (view as any).centerDate = new Date(2026, 0, 15);

            const entry = createSampleEntry({
                date: '2026-01-15',
                start: '09:00',
                end: '10:00',
                durationMinutes: 60,
            });

            const card = document.createElement('div');
            // 1 day offset (2400px) + 9h 55m (991.67px) = 3391.67px -> should snap start to 10:00, end to 11:00
            card.style.top = `${2400 + (9 * 60 + 55) * (100 / 60)}px`;
            card.style.height = '100px';

            (view as any).entryDragMode = 'move';
            (view as any).entryDragEntry = entry;
            (view as any).entryDragCard = card;
            (view as any).entryDragStartY = 100;

            await (view as any).finalizeEntryDrag(200);

            expect(updateEntryMock).toHaveBeenCalledWith(
                entry,
                expect.objectContaining({
                    date: '2026-01-15',
                    start: '2026-01-15 10:00',
                    end: '2026-01-15 11:00',
                })
            );
        });
    });

    describe('Linked note attachment icon interaction', () => {
        it('renders noteIcon with aria-label, title, and stops mousedown propagation', () => {
            const entryWithNote = createSampleEntry({
                linkedNote: 'My Attached Note',
            });

            const container = document.createElement('div');
            (view as any).entriesContainer = container;
            (view as any).renderEntryCard(entryWithNote, 0);

            const card = container.querySelector('.timeline-entry-card') as HTMLElement;
            const noteIcon = card.querySelector('.entry-icon-note') as HTMLElement;
            expect(noteIcon).not.toBeNull();
            expect(noteIcon.getAttribute('aria-label')).toBe('Open: My Attached Note');
            expect(noteIcon.getAttribute('title')).toBe('Open: My Attached Note');

            // Test that mousedown on noteIcon stops propagation
            const mousedownEvent = new (window as any).MouseEvent('mousedown', { bubbles: true, cancelable: true });
            const stopPropagationSpy = jest.spyOn(mousedownEvent, 'stopPropagation');
            noteIcon.dispatchEvent(mousedownEvent);
            expect(stopPropagationSpy).toHaveBeenCalled();
        });

        it('immediately triggers openLinkedNote on click without drag interference', () => {
            const entryWithNote = createSampleEntry({
                linkedNote: '[[Project Roadmap]]',
            });

            const container = document.createElement('div');
            (view as any).entriesContainer = container;

            const openLinkedNoteSpy = jest.spyOn(view as any, 'openLinkedNote').mockImplementation(() => {});

            (view as any).renderEntryCard(entryWithNote, 0);

            const card = container.querySelector('.timeline-entry-card') as HTMLElement;
            const noteIcon = card.querySelector('.entry-icon-note') as HTMLElement;

            // Trigger click immediately
            const clickEvent = new (window as any).MouseEvent('click', { bubbles: true, cancelable: true });
            noteIcon.dispatchEvent(clickEvent);

            expect(openLinkedNoteSpy).toHaveBeenCalledWith('[[Project Roadmap]]');
        });

        it('openLinkedNote strips wiki brackets and resolves file in leaf or via openLinkText', () => {
            const openLinkTextMock = jest.fn();
            const openFileMock = jest.fn();

            (view as any).app = {
                vault: {
                    getAbstractFileByPath: jest.fn().mockReturnValue(null),
                },
                metadataCache: {
                    getFirstLinkpathDest: jest.fn().mockImplementation((path: string) => {
                        if (path === 'Subfolder/MyNote') {
                            return { path: 'Subfolder/MyNote.md' };
                        }
                        return null;
                    }),
                },
                workspace: {
                    getLeaf: jest.fn().mockReturnValue({
                        openFile: openFileMock,
                    }),
                    openLinkText: openLinkTextMock,
                },
            };

            // Call with wikilink
            (view as any).openLinkedNote('[[Subfolder/MyNote]]');
            expect(openFileMock).toHaveBeenCalledWith({ path: 'Subfolder/MyNote.md' });

            // Call with non-existing note (fallback to openLinkText)
            (view as any).openLinkedNote('NonExistentNote');
            expect(openLinkTextMock).toHaveBeenCalledWith('NonExistentNote', '', false);
        });
    });
});

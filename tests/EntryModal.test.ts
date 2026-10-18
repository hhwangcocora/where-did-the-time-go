import { jest } from '@jest/globals';
import { JSDOM } from 'jsdom';
import { App } from 'obsidian';
import { setupDomPrototypes } from './__mocks__/obsidian';
import { DataManager } from '../src/data/DataManager';
import { EntryModal } from '../src/modals/EntryModal';
import { DEFAULT_SETTINGS, TrackingSchemaConfig, TimeEntry } from '../src/types';

describe('EntryModal Dynamic Schema', () => {
    let dom: JSDOM;
    let dataManager: DataManager;
    let createEntryMock: jest.Mock<any>;
    let updateEntryMock: jest.Mock<any>;

    const testSchema: TrackingSchemaConfig = {
        version: 1,
        fields: [
            {
                id: 'category',
                label: 'Category',
                type: 'enum',
                required: true,
                multiple: false,
                defaultValue: 'Deep Work',
                options: [
                    { id: 'Deep Work', label: 'Deep Work' },
                    { id: 'Fitness', label: 'Fitness' },
                ],
            },
            {
                id: 'activity_name',
                label: 'Activity Name',
                type: 'string',
                required: true,
                multiple: false,
            },
            {
                id: 'tags',
                label: 'Tags',
                type: 'string',
                required: false,
                multiple: true,
            },
            {
                id: 'with_who',
                label: 'With Who',
                type: 'enum',
                required: false,
                multiple: true,
                options: [
                    { id: 'alice', label: 'Alice' },
                    { id: 'bob', label: 'Bob' },
                    { id: 'charlie', label: 'Charlie' },
                ],
            },
        ],
        defaultReportGrouping: ['category', 'activity_name'],
    };

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        (global as any).window = dom.window;
        (global as any).document = dom.window.document;
        (global as any).HTMLElement = dom.window.HTMLElement;
        setupDomPrototypes();

        createEntryMock = jest.fn<any>().mockResolvedValue(undefined);
        updateEntryMock = jest.fn<any>().mockResolvedValue(undefined);

        dataManager = {
            createEntry: createEntryMock,
            updateEntry: updateEntryMock,
            findAdjacentEntries: async (): Promise<{ previous: any; next: any }> => ({ previous: null, next: null }),
            findOverlaps: async (): Promise<{ startOverlap: any; endOverlap: any; encompassedEntry: any }> => ({
                startOverlap: null,
                endOverlap: null,
                encompassedEntry: null,
            }),
            getSchema: () => testSchema,
        } as unknown as DataManager;
    });

    it('initializes dynamic default values in create mode', () => {
        const modal = new EntryModal(
            {} as App,
            DEFAULT_SETTINGS,
            dataManager,
            { mode: 'create', date: new Date(2025, 11, 1), startTime: '09:00', endTime: '10:00' },
            () => {}
        );

        expect(modal['fieldValues']['category']).toBe('Deep Work');
        expect(modal['fieldValues']['tags']).toEqual([]);
    });

    it('renders input elements for all schema fields in onOpen', () => {
        const modal = new EntryModal(
            {} as App,
            DEFAULT_SETTINGS,
            dataManager,
            { mode: 'create', date: new Date(2025, 11, 1), startTime: '09:00', endTime: '10:00' },
            () => {}
        );

        modal.onOpen();

        const content = modal.contentEl.textContent || '';
        expect(content).toContain('Category *');
        expect(content).toContain('Activity Name *');
        expect(content).toContain('Tags');
    });

    it('prevents saving when required schema field is empty', async () => {
        const modal = new EntryModal(
            {} as App,
            DEFAULT_SETTINGS,
            dataManager,
            { mode: 'create', date: new Date(2025, 11, 1), startTime: '09:00', endTime: '10:00' },
            () => {}
        );

        // activity_name is left empty
        await modal['handleSave']();

        expect(createEntryMock).not.toHaveBeenCalled();
    });

    it('saves entry with dynamic fields when valid', async () => {
        const onSave = jest.fn();
        const modal = new EntryModal(
            {} as App,
            DEFAULT_SETTINGS,
            dataManager,
            { mode: 'create', date: new Date(2025, 11, 1), startTime: '09:00', endTime: '10:00' },
            onSave
        );

        modal['fieldValues']['activity_name'] = 'System Architecture Design';
        modal['fieldValues']['tags'] = ['architecture', 'planning'];

        await modal['handleSave']();

        expect(createEntryMock).toHaveBeenCalledWith(
            expect.objectContaining({
                date: '2025-12-01',
                start: '2025-12-01 09:00',
                end: '2025-12-01 10:00',
                description: 'System Architecture Design',
                fields: expect.objectContaining({
                    category: 'Deep Work',
                    activity_name: 'System Architecture Design',
                    tags: ['architecture', 'planning'],
                }),
            })
        );
        expect(onSave).toHaveBeenCalled();
    });

    it('populates and updates fields in edit mode', async () => {
        const existingEntry: TimeEntry = {
            date: '2025-12-01',
            start: '09:00',
            end: '10:00',
            description: 'Original Task',
            client: '',
            startDateTime: new Date(2025, 11, 1, 9, 0),
            endDateTime: new Date(2025, 11, 1, 10, 0),
            durationMinutes: 60,
            lineNumber: 1,
            fields: {
                category: 'Deep Work',
                activity_name: 'Original Task',
                tags: ['original'],
            },
        };

        const onSave = jest.fn();
        const modal = new EntryModal(
            {} as App,
            DEFAULT_SETTINGS,
            dataManager,
            { mode: 'edit', entry: existingEntry },
            onSave
        );

        expect(modal['fieldValues']['activity_name']).toBe('Original Task');

        modal['fieldValues']['activity_name'] = 'Refactored Task';
        await modal['handleSave']();

        expect(updateEntryMock).toHaveBeenCalledWith(
            existingEntry,
            expect.objectContaining({
                description: 'Refactored Task',
                fields: expect.objectContaining({
                    activity_name: 'Refactored Task',
                }),
            })
        );
        expect(onSave).toHaveBeenCalled();
    });

    describe('interactive multi-select enum chips', () => {
        it('renders clickable chips for all predefined options and supports toggle selection', () => {
            const modal = new EntryModal(
                {} as App,
                DEFAULT_SETTINGS,
                dataManager,
                { mode: 'create', date: new Date(2025, 11, 1), startTime: '09:00', endTime: '10:00' },
                () => {}
            );

            modal.onOpen();

            const chips = Array.from(modal.contentEl.querySelectorAll('.multi-select-chip')) as HTMLElement[];
            expect(chips.length).toBe(3); // Alice, Bob, Charlie

            const aliceChip = chips.find(c => c.textContent?.includes('Alice'))!;
            const bobChip = chips.find(c => c.textContent?.includes('Bob'))!;

            expect(aliceChip.classList.contains('is-selected')).toBe(false);
            expect(bobChip.classList.contains('is-selected')).toBe(false);

            // Click Alice to select
            aliceChip.click();
            expect(aliceChip.classList.contains('is-selected')).toBe(true);
            expect(modal['fieldValues']['with_who']).toEqual(['Alice']);

            // Click Bob to select
            bobChip.click();
            expect(bobChip.classList.contains('is-selected')).toBe(true);
            expect(modal['fieldValues']['with_who']).toEqual(['Alice', 'Bob']);

            // Click Alice again to deselect
            aliceChip.click();
            expect(aliceChip.classList.contains('is-selected')).toBe(false);
            expect(modal['fieldValues']['with_who']).toEqual(['Bob']);
        });

        it('pre-selects chips and renders custom chips in edit mode', () => {
            const existingEntry: TimeEntry = {
                date: '2025-12-01',
                start: '09:00',
                end: '10:00',
                description: 'Collab meeting',
                client: '',
                startDateTime: new Date(2025, 11, 1, 9, 0),
                endDateTime: new Date(2025, 11, 1, 10, 0),
                durationMinutes: 60,
                lineNumber: 1,
                fields: {
                    category: 'Deep Work',
                    activity_name: 'Collab meeting',
                    with_who: ['Alice', 'David'], // David is custom (not in options)
                },
            };

            const modal = new EntryModal(
                {} as App,
                DEFAULT_SETTINGS,
                dataManager,
                { mode: 'edit', entry: existingEntry },
                () => {}
            );

            modal.onOpen();

            const chips = Array.from(modal.contentEl.querySelectorAll('.multi-select-chip')) as HTMLElement[];
            const aliceChip = chips.find(c => c.textContent?.includes('Alice'))!;
            const davidChip = chips.find(c => c.textContent?.includes('David'))!;

            expect(aliceChip.classList.contains('is-selected')).toBe(true);
            expect(davidChip).toBeDefined();
            expect(davidChip.classList.contains('is-selected')).toBe(true);
            expect(davidChip.classList.contains('is-custom')).toBe(true);
        });

        it('allows adding custom person via custom input', () => {
            const modal = new EntryModal(
                {} as App,
                DEFAULT_SETTINGS,
                dataManager,
                { mode: 'create', date: new Date(2025, 11, 1), startTime: '09:00', endTime: '10:00' },
                () => {}
            );

            modal.onOpen();

            const input = modal.contentEl.querySelector('.multi-select-custom-input') as HTMLInputElement;
            expect(input).toBeDefined();

            input.value = 'Eve';
            const enterEvent = new (global as any).window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
            input.dispatchEvent(enterEvent);

            expect(modal['fieldValues']['with_who']).toContain('Eve');
            const chips = Array.from(modal.contentEl.querySelectorAll('.multi-select-chip')) as HTMLElement[];
            const eveChip = chips.find(c => c.textContent?.includes('Eve'))!;
            expect(eveChip).toBeDefined();
            expect(eveChip.classList.contains('is-selected')).toBe(true);
        });
    });
});

import { DataManager } from '../src/data/DataManager';
import { SchemaManager } from '../src/data/SchemaManager';
import { DEFAULT_SETTINGS, TimeEntry, DailyDiary } from '../src/types';
import { Vault, TFile, TFolder } from 'obsidian';

describe('DataManager', () => {
    let mockVault: Vault;
    let files: Map<string, string>;
    let folders: Set<string>;
    let dataManager: DataManager;
    let schemaManager: SchemaManager;

    beforeEach(async () => {
        files = new Map<string, string>();
        folders = new Set<string>(['TimeTracking']);

        mockVault = new Vault();

        mockVault.read = async (file: TFile): Promise<string> => {
            const content = files.get(file.path);
            if (content === undefined) throw new Error(`File not found: ${file.path}`);
            return content;
        };

        mockVault.create = async (path: string, content: string): Promise<TFile> => {
            files.set(path, content);
            const file = new TFile();
            file.path = path;
            file.name = path.split('/').pop() || '';
            return file;
        };

        mockVault.modify = async (file: TFile, content: string): Promise<void> => {
            files.set(file.path, content);
        };

        mockVault.createFolder = async (path: string): Promise<TFolder> => {
            folders.add(path);
            const folder = new TFolder();
            folder.path = path;
            return folder;
        };

        mockVault.getAbstractFileByPath = (path: string): TFile | TFolder | null => {
            if (files.has(path)) {
                const file = new TFile();
                file.path = path;
                file.name = path.split('/').pop() || '';
                return file;
            }
            if (folders.has(path)) {
                const folder = new TFolder();
                folder.path = path;
                return folder;
            }
            return null;
        };

        schemaManager = new SchemaManager(mockVault, DEFAULT_SETTINGS);
        await schemaManager.loadSchema();

        dataManager = new DataManager(mockVault, DEFAULT_SETTINGS, schemaManager);
    });

    describe('Daily Diaries CRUD', () => {
        it('should return null when no diary exists for date', async () => {
            const diary = await dataManager.getDiary('2025-01-15');
            expect(diary).toBeNull();
        });

        it('should save a new daily diary and persist to monthly file', async () => {
            const diaryToSave: DailyDiary = {
                date: '2025-01-15',
                content: 'Reflected on the day. Great focus on coding tasks.',
            };

            const saved = await dataManager.saveDiary(diaryToSave);
            expect(saved.date).toBe('2025-01-15');
            expect(saved.content).toBe('Reflected on the day. Great focus on coding tasks.');
            expect(saved.updatedAt).toBeDefined();

            // Check loaded diary
            const loaded = await dataManager.getDiary('2025-01-15');
            expect(loaded).not.toBeNull();
            expect(loaded?.content).toBe(diaryToSave.content);

            // Check raw monthly file content
            const rawContent = files.get('TimeTracking/2025-01.md');
            expect(rawContent).toBeDefined();
            expect(rawContent).toContain('## Daily Diaries');
            expect(rawContent).toContain('### 2025-01-15');
            expect(rawContent).toContain(diaryToSave.content);
        });

        it('should update an existing daily diary', async () => {
            await dataManager.saveDiary({
                date: '2025-01-15',
                content: 'Initial thoughts.',
            });

            await dataManager.saveDiary({
                date: '2025-01-15',
                content: 'Updated reflections after evening wrap-up.',
            });

            const loaded = await dataManager.getDiary('2025-01-15');
            expect(loaded?.content).toBe('Updated reflections after evening wrap-up.');
        });

        it('should delete a daily diary and update file', async () => {
            await dataManager.saveDiary({
                date: '2025-01-15',
                content: 'To be deleted.',
            });
            await dataManager.saveDiary({
                date: '2025-01-16',
                content: 'To be kept.',
            });

            await dataManager.deleteDiary('2025-01-15');

            const loaded15 = await dataManager.getDiary('2025-01-15');
            expect(loaded15).toBeNull();

            const loaded16 = await dataManager.getDiary('2025-01-16');
            expect(loaded16).not.toBeNull();
            expect(loaded16?.content).toBe('To be kept.');

            const rawContent = files.get('TimeTracking/2025-01.md');
            expect(rawContent).not.toContain('### 2025-01-15');
            expect(rawContent).toContain('### 2025-01-16');
        });

        it('should preserve existing time entries when saving diaries', async () => {
            // First create a time entry
            const newEntry = {
                date: '2025-01-15',
                start: '2025-01-15 09:00',
                end: '2025-01-15 10:00',
                description: 'Deep work sprint',
                client: '',
                fields: {
                    category: 'Deep Work',
                    activity_name: 'Deep work sprint',
                },
            };

            await dataManager.createEntry(newEntry);

            // Now save a diary
            await dataManager.saveDiary({
                date: '2025-01-15',
                content: 'Good deep work session this morning.',
            });

            // Reload month and verify both entry and diary exist
            const monthData = await dataManager.loadMonth('2025-01');
            expect(monthData.entries.length).toBe(1);
            expect(monthData.entries[0].description).toBe('Deep work sprint');
            expect(monthData.diariesByDate.get('2025-01-15')?.content).toBe(
                'Good deep work session this morning.'
            );
        });

        it('should preserve diaries when creating, updating, or deleting time entries', async () => {
            // Save a diary first
            await dataManager.saveDiary({
                date: '2025-01-15',
                content: 'Preserve this diary across entry lifecycle.',
            });

            // Create an entry
            const created = await dataManager.createEntry({
                date: '2025-01-15',
                start: '2025-01-15 09:00',
                end: '2025-01-15 10:00',
                description: 'Original description',
                client: '',
                fields: {
                    category: 'Work',
                    activity_name: 'Original description',
                },
            });

            // Verify diary preserved
            let diary = await dataManager.getDiary('2025-01-15');
            expect(diary?.content).toBe('Preserve this diary across entry lifecycle.');

            // Update entry
            await dataManager.updateEntry(created, {
                ...created,
                description: 'Updated description',
                fields: {
                    ...created.fields,
                    activity_name: 'Updated description',
                },
            });

            // Verify diary still preserved
            diary = await dataManager.getDiary('2025-01-15');
            expect(diary?.content).toBe('Preserve this diary across entry lifecycle.');

            // Delete entry
            const monthData = await dataManager.loadMonth('2025-01');
            await dataManager.deleteEntry(monthData.entries[0]);

            // Verify diary still preserved
            diary = await dataManager.getDiary('2025-01-15');
            expect(diary?.content).toBe('Preserve this diary across entry lifecycle.');
        });
    });

    describe('Overlap detection & date range edge cases', () => {
        it('detects overlap with an overnight entry from the previous day', async () => {
            // Day 1: 23:00 to Day 2: 02:00
            await dataManager.createEntry({
                date: '2025-01-15',
                start: '2025-01-15 23:00',
                end: '2025-01-16 02:00',
                description: 'Overnight sleep',
                client: '',
                fields: { category: 'Sleep', activity_name: 'Overnight sleep' },
            });

            // Day 2: 01:00 to 03:00 overlaps with Day 1's overnight entry
            await expect(
                dataManager.createEntry({
                    date: '2025-01-16',
                    start: '2025-01-16 01:00',
                    end: '2025-01-16 03:00',
                    description: 'Late night coding',
                    client: '',
                    fields: { category: 'Deep Work', activity_name: 'Late night coding' },
                })
            ).rejects.toThrow('Entry overlaps with an existing time entry');
        });

        it('detects overlap when creating an overnight entry that collides with next day entry', async () => {
            // Day 2: 07:00 to 09:00
            await dataManager.createEntry({
                date: '2025-01-16',
                start: '2025-01-16 07:00',
                end: '2025-01-16 09:00',
                description: 'Morning workout',
                client: '',
                fields: { category: 'Fitness', activity_name: 'Morning workout' },
            });

            // Day 1: 23:00 to Day 2: 08:00 collides with Day 2 07:00-09:00
            await expect(
                dataManager.createEntry({
                    date: '2025-01-15',
                    start: '2025-01-15 23:00',
                    end: '2025-01-16 08:00',
                    description: 'Sleep',
                    client: '',
                    fields: { category: 'Sleep', activity_name: 'Sleep' },
                })
            ).rejects.toThrow('Entry overlaps with an existing time entry');
        });

        it('loads previous month properly in loadDateRange when startDate is on the 31st', async () => {
            // Entry starting Feb 28 23:00 and ending Mar 1 02:00
            await dataManager.createEntry({
                date: '2026-02-28',
                start: '2026-02-28 23:00',
                end: '2026-03-01 02:00',
                description: 'Feb to Mar overnight',
                client: '',
                fields: { category: 'Deep Work', activity_name: 'Feb to Mar overnight' },
            });

            const checkedMonths: string[] = [];
            const origLoadMonth = dataManager.loadMonth.bind(dataManager);
            dataManager.loadMonth = async (month: string) => {
                checkedMonths.push(month);
                return origLoadMonth(month);
            };

            // Start on March 31 - monthBefore should be 2026-02, not overflow to 2026-03
            await dataManager.loadDateRange(new Date(2026, 2, 31, 0, 0), new Date(2026, 2, 31, 23, 59));
            expect(checkedMonths).toContain('2026-02');
            expect(checkedMonths).toContain('2026-03');
        });

        it('supports partial updateEntry when start and end are HH:mm strings', async () => {
            const created = await dataManager.createEntry({
                date: '2025-01-15',
                start: '2025-01-15 09:00',
                end: '2025-01-15 10:30',
                description: 'Initial task',
                client: '',
                fields: { category: 'Deep Work', activity_name: 'Initial task' },
            });

            expect(created.start).toBe('09:00');
            expect(created.end).toBe('10:30');

            const updated = await dataManager.updateEntry(created, {
                description: 'Renamed task',
                fields: { category: 'Deep Work', activity_name: 'Renamed task' },
            });

            expect(updated.description).toBe('Renamed task');
            expect(updated.durationMinutes).toBe(90);

            const monthData = await dataManager.loadMonth('2025-01');
            expect(monthData.entries[0].description).toBe('Renamed task');
        });
    });
});

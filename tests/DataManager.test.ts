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
});

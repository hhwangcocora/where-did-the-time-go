import { SchemaManager } from '../src/data/SchemaManager';
import { DEFAULT_SETTINGS, DEFAULT_SCHEMA_CONFIG, TrackingSchemaConfig } from '../src/types';
import { getColorForValue } from '../src/utils/colors';
import { Vault, TFile, TFolder } from 'obsidian';

describe('SchemaManager', () => {
    let mockVault: Vault;
    let files: Map<string, string>;
    let folders: Set<string>;
    let schemaManager: SchemaManager;

    beforeEach(() => {
        files = new Map<string, string>();
        folders = new Set<string>(['TimeTracking']);

        mockVault = new Vault();

        // Mock read
        mockVault.read = async (file: TFile): Promise<string> => {
            const content = files.get(file.path);
            if (content === undefined) throw new Error(`File not found: ${file.path}`);
            return content;
        };

        // Mock create
        mockVault.create = async (path: string, content: string): Promise<TFile> => {
            files.set(path, content);
            const file = new TFile();
            file.path = path;
            file.name = path.split('/').pop() || '';
            return file;
        };

        // Mock modify
        mockVault.modify = async (file: TFile, content: string): Promise<void> => {
            files.set(file.path, content);
        };

        // Mock createFolder
        mockVault.createFolder = async (path: string): Promise<TFolder> => {
            folders.add(path);
            const folder = new TFolder();
            folder.path = path;
            return folder;
        };

        // Mock getAbstractFileByPath
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

        mockVault.adapter.exists = async (path: string): Promise<boolean> => {
            return files.has(path) || folders.has(path);
        };
        mockVault.adapter.read = async (path: string): Promise<string> => {
            const content = files.get(path);
            if (content === undefined) throw new Error(`File not found: ${path}`);
            return content;
        };
        mockVault.adapter.write = async (path: string, data: string): Promise<void> => {
            files.set(path, data);
        };

        schemaManager = new SchemaManager(mockVault, DEFAULT_SETTINGS);
    });

    test('loads schema via adapter when vault cache has not indexed Schema.md yet (startup race condition)', async () => {
        const customMarkdown = `# Activity Tracking Schema
| Field Name | Type | Required | Options | Allow Multiple | Timeline Role | Report Dimension | Aliases |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Startup Field | string | Yes | | No | Title | 1 | |
`;
        files.set('TimeTracking/Schema.md', customMarkdown);

        // Simulate startup state: getAbstractFileByPath returns null for all files/folders
        mockVault.getAbstractFileByPath = () => null;

        const schema = await schemaManager.loadSchema();

        expect(schema.fields.length).toBe(1);
        expect(schema.fields[0].id).toBe('startup_field');
        expect(schema.fields[0].label).toBe('Startup Field');
    });

    test('loads default schema and creates Schema.md when file does not exist', async () => {
        expect(files.has('TimeTracking/Schema.md')).toBe(false);

        const schema = await schemaManager.loadSchema();

        expect(schema).toBeDefined();
        expect(schema.fields.length).toBe(DEFAULT_SCHEMA_CONFIG.fields.length);
        expect(files.has('TimeTracking/Schema.md')).toBe(true);

        const writtenContent = files.get('TimeTracking/Schema.md')!;
        expect(writtenContent).toContain('| Category |');
        expect(writtenContent).toContain('| Activity Name |');
    });

    test('loads existing Schema.md markdown table when present', async () => {
        const customMarkdown = `# My Custom Schema
| Field Name | Type | Required | Options | Allow Multiple | Timeline Role | Report Dimension | Aliases |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Domain | enum | Yes | Engineering, Product, Design | No | Color | 1 | Area |
| Task | string | Yes | | No | Title | 2 | Description |
`;
        files.set('TimeTracking/Schema.md', customMarkdown);

        const schema = await schemaManager.loadSchema();

        expect(schema.fields.length).toBe(2);
        expect(schema.fields[0].id).toBe('domain');
        expect(schema.fields[0].label).toBe('Domain');
        expect(schema.fields[0].type).toBe('enum');
        expect(schema.fields[0].options?.length).toBe(3);
        expect(schema.fields[0].options?.[0].label).toBe('Engineering');
        expect(schema.fields[0].options?.[0].color).toBe(getColorForValue('Engineering'));
        expect(schema.fields[0].aliases).toContain('Area');

        expect(schema.fields[1].id).toBe('task');
        expect(schema.fields[1].label).toBe('Task');
        expect(schema.fields[1].type).toBe('string');
        expect(schema.fields[1].aliases).toContain('Description');

        expect(schema.defaultReportGrouping).toEqual(['domain', 'task']);
    });

    test('recovers safely from invalid or empty table in Schema.md on initial load', async () => {
        files.set('TimeTracking/Schema.md', '# Just a heading with no table');

        const schema = await schemaManager.loadSchema();

        expect(schema).toEqual(DEFAULT_SCHEMA_CONFIG);
        expect(schema.fields.length).toBe(DEFAULT_SCHEMA_CONFIG.fields.length);
    });

    test('retains last loaded schema when Schema.md table is temporarily empty during edit', async () => {
        const customMarkdown = `# Schema
| Field Name | Type | Required | Options | Allow Multiple | Timeline Role | Report Dimension | Aliases |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Work | enum | Yes | Coding, Planning | No | Color | 1 | |
`;
        files.set('TimeTracking/Schema.md', customMarkdown);
        await schemaManager.loadSchema();
        expect(schemaManager.getField('work')).toBeDefined();

        // Simulate mid-keystroke / cleared table while editing
        files.set('TimeTracking/Schema.md', '# Editing in progress...');
        const reloaded = await schemaManager.loadSchema();

        // Retains previous valid schema
        expect(reloaded.fields[0].id).toBe('work');
    });

    test('saveSchema writes formatted Markdown table and updates in-memory schema', async () => {
        const newConfig: TrackingSchemaConfig = {
            version: 1,
            fields: [
                {
                    id: 'topic',
                    label: 'Topic',
                    type: 'enum',
                    required: false,
                    multiple: false,
                    options: [
                        { id: 'math', label: 'Math', color: getColorForValue('Math') },
                        { id: 'physics', label: 'Physics', color: getColorForValue('Physics') },
                    ],
                },
            ],
            defaultReportGrouping: ['topic'],
        };

        await schemaManager.saveSchema(newConfig);

        const content = files.get('TimeTracking/Schema.md')!;
        expect(content).toContain('| Topic | enum | No | Math, Physics | No | Badge | 1 |  |');
        expect(schemaManager.getSchema().fields[0].id).toBe('topic');
    });

    describe('getFieldByHeader', () => {
        beforeEach(async () => {
            await schemaManager.loadSchema();
        });

        test('matches field by exact ID', () => {
            const field = schemaManager.getFieldByHeader('category');
            expect(field).toBeDefined();
            expect(field?.id).toBe('category');
        });

        test('matches field by label case-insensitively', () => {
            const field = schemaManager.getFieldByHeader('Activity Name');
            expect(field).toBeDefined();
            expect(field?.id).toBe('activity_name');
        });

        test('matches field by configured aliases', () => {
            const match1 = schemaManager.getFieldByHeader('activity');
            expect(match1?.id).toBe('category');

            const match2 = schemaManager.getFieldByHeader('description');
            expect(match2?.id).toBe('activity_name');
        });

        test('returns undefined for unrecognized column header', () => {
            const field = schemaManager.getFieldByHeader('random_nonexistent_column');
            expect(field).toBeUndefined();
        });
    });

    describe('role queries', () => {
        beforeEach(async () => {
            await schemaManager.loadSchema();
        });

        test('getColorField returns field configured with timelineRole: "color"', () => {
            const colorField = schemaManager.getColorField();
            expect(colorField?.id).toBe('category');
            expect(colorField?.ui?.timelineRole).toBe('color');
        });

        test('getTitleField returns field configured with timelineRole: "title"', () => {
            const titleField = schemaManager.getTitleField();
            expect(titleField?.id).toBe('activity_name');
            expect(titleField?.ui?.timelineRole).toBe('title');
        });

        test('getBadgeFields returns all fields marked with timelineRole: "badge"', () => {
            const badgeFields = schemaManager.getBadgeFields();
            const badgeIds = badgeFields.map(f => f.id);
            expect(badgeIds).toContain('location');
            expect(badgeIds).not.toContain('tags');
            expect(badgeIds).not.toContain('category');
        });
    });

    describe('ensureFolderExists', () => {
        test('creates folder if missing and autoCreateFolder is true', async () => {
            folders.clear();
            const folder = await schemaManager.ensureFolderExists();
            expect(folder.path).toBe('TimeTracking');
            expect(folders.has('TimeTracking')).toBe(true);
        });

        test('throws error if missing and autoCreateFolder is false', async () => {
            folders.clear();
            schemaManager.updateSettings({
                ...DEFAULT_SETTINGS,
                autoCreateFolder: false,
            });

            await expect(schemaManager.ensureFolderExists()).rejects.toThrow(
                'Time tracking folder "TimeTracking" does not exist'
            );
        });

        test('handles folder already exists safely if vault index is behind disk', async () => {
            folders.clear();
            mockVault.createFolder = async () => {
                throw new Error('Folder already exists.');
            };

            const folder = await schemaManager.ensureFolderExists();
            expect(folder).toBeDefined();
            expect(folder.path).toBe('TimeTracking');
        });
    });
});

import { TFile, TFolder, Vault } from 'obsidian';
import {
    TrackingSchemaConfig,
    FieldDefinition,
    DEFAULT_SCHEMA_CONFIG,
    DEFAULT_SCHEMA_MARKDOWN,
    TimeTrackerSettings,
    FieldType,
    EnumOption,
} from '../types';
import { getColorForValue, FIXED_LOCATION_COLOR } from '../utils/colors';
import { Logger } from '../utils/Logger';

/**
 * Manages loading, parsing, caching, and querying the dynamic activity schema from Schema.md
 */
export class SchemaManager {
    private vault: Vault;
    private settings: TimeTrackerSettings;
    private schema: TrackingSchemaConfig = DEFAULT_SCHEMA_CONFIG;
    private isLoaded: boolean = false;

    constructor(vault: Vault, settings: TimeTrackerSettings) {
        this.vault = vault;
        this.settings = settings;
    }

    /**
     * Update settings reference
     */
    updateSettings(settings: TimeTrackerSettings): void {
        this.settings = settings;
    }

    /**
     * Get path to the Schema.md file in the vault
     */
    getSchemaFilePath(): string {
        return `${this.settings.timeTrackingFolder}/Schema.md`;
    }

    /**
     * Ensure the root tracking folder exists
     */
    async ensureFolderExists(): Promise<TFolder> {
        const folderPath = this.settings.timeTrackingFolder;
        let folder = this.vault.getAbstractFileByPath(folderPath);

        if (folder instanceof TFolder) {
            return folder;
        }

        const existsOnDisk = this.vault.adapter && await this.vault.adapter.exists(folderPath);
        if (!existsOnDisk) {
            if (this.settings.autoCreateFolder) {
                try {
                    folder = await this.vault.createFolder(folderPath);
                } catch (err: unknown) {
                    if (!(err instanceof Error && err.message.toLowerCase().includes('already exists'))) {
                        throw err;
                    }
                }
            } else {
                throw new Error(`Time tracking folder "${folderPath}" does not exist`);
            }
        }

        if (!folder) {
            folder = this.vault.getAbstractFileByPath(folderPath);
        }

        if (!folder) {
            const fallbackFolder = new TFolder();
            fallbackFolder.path = folderPath;
            fallbackFolder.name = folderPath.split('/').pop() || '';
            folder = fallbackFolder;
        }

        if (!(folder instanceof TFolder)) {
            throw new Error(`"${folderPath}" is not a folder`);
        }

        return folder;
    }

    /**
     * Load the schema from Schema.md.
     * If the file does not exist, automatically creates it with DEFAULT_SCHEMA_MARKDOWN.
     * If the table is unparseable or empty, safely retains the active or default schema.
     */
    async loadSchema(): Promise<TrackingSchemaConfig> {
        const filePath = this.getSchemaFilePath();
        let rawContent: string | null = null;

        const file = this.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            try {
                rawContent = await this.vault.read(file);
            } catch (err) {
                Logger.error('SchemaManager: Error reading Schema.md from vault:', err);
            }
        } else if (this.vault.adapter && await this.vault.adapter.exists(filePath)) {
            try {
                rawContent = await this.vault.adapter.read(filePath);
            } catch (err) {
                Logger.error('SchemaManager: Error reading Schema.md from adapter:', err);
            }
        }

        if (rawContent === null) {
            const existsOnDisk = this.vault.adapter && await this.vault.adapter.exists(filePath);
            if (!file && !existsOnDisk) {
                Logger.debug('SchemaManager: Schema.md not found, initializing with default schema markdown');
                try {
                    await this.saveSchema(DEFAULT_SCHEMA_CONFIG);
                } catch (err) {
                    Logger.error('SchemaManager: Failed to create default Schema.md:', err);
                }
            }
            this.schema = DEFAULT_SCHEMA_CONFIG;
            this.isLoaded = true;
            return this.schema;
        }

        try {
            const parsed = this.parseSchemaMarkdown(rawContent);

            if (parsed && parsed.fields.length > 0) {
                this.schema = parsed;
                this.isLoaded = true;
                Logger.debug('SchemaManager: Successfully loaded schema with', this.schema.fields.length, 'fields from Schema.md');
                return this.schema;
            } else {
                if (this.isLoaded) {
                    Logger.debug('SchemaManager: Incomplete or empty table in Schema.md while editing, retaining active schema');
                } else {
                    Logger.error('SchemaManager: No valid fields parsed from Schema.md on initial load, falling back to default schema');
                    this.schema = DEFAULT_SCHEMA_CONFIG;
                    this.isLoaded = true;
                }
                return this.schema;
            }
        } catch (err) {
            if (this.isLoaded) {
                Logger.debug('SchemaManager: Transient error parsing Schema.md while editing (retaining active schema):', err instanceof Error ? err.message : err);
            } else {
                Logger.error('SchemaManager: Error parsing Schema.md on initial load:', err);
                this.schema = DEFAULT_SCHEMA_CONFIG;
                this.isLoaded = true;
            }
            return this.schema;
        }
    }

    /**
     * Save a schema configuration to Schema.md
     */
    async saveSchema(config: TrackingSchemaConfig): Promise<void> {
        await this.ensureFolderExists();
        const filePath = this.getSchemaFilePath();
        const content = this.generateSchemaMarkdown(config);
        const file = this.vault.getAbstractFileByPath(filePath);

        if (file instanceof TFile) {
            await this.vault.modify(file, content);
        } else if (this.vault.adapter && await this.vault.adapter.exists(filePath)) {
            await this.vault.adapter.write(filePath, content);
        } else {
            try {
                await this.vault.create(filePath, content);
            } catch (err: unknown) {
                if (err instanceof Error && err.message.toLowerCase().includes('already exists') && this.vault.adapter) {
                    await this.vault.adapter.write(filePath, content);
                } else {
                    throw err;
                }
            }
        }

        this.schema = config;
        this.isLoaded = true;
        Logger.debug('SchemaManager: Saved Schema.md with', config.fields.length, 'fields');
    }

    /**
     * Parse markdown content containing a schema table into TrackingSchemaConfig
     */
    parseSchemaMarkdown(content: string): TrackingSchemaConfig {
        const lines = content.split(/\r?\n/);
        let headerLineIndex = -1;

        // Locate header line
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('|') && /field/i.test(line)) {
                headerLineIndex = i;
                break;
            }
        }

        if (headerLineIndex === -1) {
            return { version: 1, fields: [], defaultReportGrouping: [] };
        }

        // Parse header column positions
        const headerCells = lines[headerLineIndex]
            .split('|')
            .map(c => c.trim().toLowerCase())
            .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1); // remove outer empty splits

        const fieldIndex = headerCells.findIndex(h => h.includes('field') || h.includes('name'));
        const typeIndex = headerCells.findIndex(h => h.includes('type'));
        const requiredIndex = headerCells.findIndex(h => h.includes('require'));
        const optionsIndex = headerCells.findIndex(h => h.includes('option') || h.includes('enum') || h.includes('value'));
        const multipleIndex = headerCells.findIndex(h => h.includes('multi'));
        const roleIndex = headerCells.findIndex(h => h.includes('role'));
        const reportIndex = headerCells.findIndex(h => h.includes('report') || h.includes('dimension') || h.includes('group'));
        const aliasesIndex = headerCells.findIndex(h => h.includes('alias'));

        if (fieldIndex === -1) {
            return { version: 1, fields: [], defaultReportGrouping: [] };
        }

        const fields: FieldDefinition[] = [];
        const reportDimensions: { order: number; id: string }[] = [];

        // Parse rows
        let mainTableEndIndex = headerLineIndex + 1;
        for (let i = headerLineIndex + 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line.startsWith('|')) {
                // End of table
                if (fields.length > 0) {
                    mainTableEndIndex = i;
                    break;
                }
                continue;
            }
            mainTableEndIndex = i + 1;
            if (line.includes('---')) {
                // Table separator line
                continue;
            }

            const rawCells = line.split('|');
            // Remove leading and trailing empty cells from split of `| a | b |`
            const cells = rawCells.slice(1, -1).map(c => c.trim());

            const fieldName = (cells[fieldIndex] || '').trim();
            if (!fieldName) continue;

            const id = fieldName.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
            const rawType = typeIndex !== -1 ? (cells[typeIndex] || '').trim().toLowerCase() : '';
            const type: FieldType = rawType.includes('enum') ? 'enum' : 'string';

            const rawRequired = requiredIndex !== -1 ? (cells[requiredIndex] || '').trim().toLowerCase() : '';
            const required = /^(yes|true|y)$/i.test(rawRequired);

            const rawMultiple = multipleIndex !== -1 ? (cells[multipleIndex] || '').trim().toLowerCase() : '';
            const multiple = /^(yes|true|y|multi)/i.test(rawMultiple);

            // Parse enum options
            let options: EnumOption[] | undefined;
            let defaultValue: string | undefined;
            if (type === 'enum') {
                const rawOpts = optionsIndex !== -1 ? (cells[optionsIndex] || '').trim() : '';
                if (rawOpts) {
                    const parsedOpts = rawOpts.split(',').map(o => o.trim()).filter(o => o.length > 0);
                    const isLocation = id === 'location' || fieldName.toLowerCase() === 'location';
                    options = parsedOpts.map(optLabel => ({
                        id: optLabel.toLowerCase().replace(/[^a-z0-9_]+/g, '-').replace(/^-+|-+$/g, ''),
                        label: optLabel,
                        color: isLocation ? FIXED_LOCATION_COLOR : getColorForValue(optLabel),
                    }));
                    // Only assign a default value for required, single-select enum fields
                    if (options.length > 0 && !multiple && required) {
                        defaultValue = options[0].label;
                    }
                }
            }

            // Parse timeline role
            const rawRole = roleIndex !== -1 ? (cells[roleIndex] || '').trim().toLowerCase() : '';
            let timelineRole: 'title' | 'color' | 'badge' | 'content' | 'hidden';
            if (rawRole.includes('color')) timelineRole = 'color';
            else if (rawRole.includes('title')) timelineRole = 'title';
            else if (rawRole.includes('badge')) timelineRole = 'badge';
            else if (rawRole.includes('content')) timelineRole = 'content';
            else if (rawRole.includes('hidden')) timelineRole = 'hidden';
            else {
                // Fields default to Content
                if (type === 'enum' && !fields.some(f => f.ui?.timelineRole === 'color')) timelineRole = 'color';
                else if (type === 'string' && !fields.some(f => f.ui?.timelineRole === 'title')) timelineRole = 'title';
                else timelineRole = 'content';
            }

            // Parse report dimension
            if (reportIndex !== -1) {
                const rawDim = (cells[reportIndex] || '').trim();
                const dim = parseInt(rawDim, 10);
                if (!isNaN(dim) && dim > 0) {
                    reportDimensions.push({ order: dim, id });
                }
            }

            // Parse aliases
            const rawAliases = aliasesIndex !== -1 ? (cells[aliasesIndex] || '').trim() : '';
            const aliases = rawAliases
                ? rawAliases.split(',').map(a => a.trim()).filter(a => a.length > 0)
                : [];

            // Determine widget
            let widget: 'text' | 'textarea' | 'dropdown' | 'tags' | 'note-link' | 'multi-select' = 'text';
            if (type === 'enum' && multiple) widget = 'multi-select';
            else if (type === 'enum') widget = 'dropdown';
            else if (multiple) widget = 'tags';
            else if (id.includes('note')) widget = 'note-link';

            fields.push({
                id,
                label: fieldName,
                type,
                required,
                multiple,
                options,
                defaultValue,
                aliases: aliases.length > 0 ? aliases : undefined,
                ui: {
                    widget,
                    timelineRole,
                },
            });
        }

        reportDimensions.sort((a, b) => a.order - b.order);
        const defaultReportGrouping = reportDimensions.length > 0
            ? reportDimensions.map(r => r.id)
            : fields.slice(0, 3).map(f => f.id);

        // Parse secondary table: Predefined activities per category
        const activityPresets: Record<string, string[]> = {};
        let presetHeaderLine = -1;
        let categoryCol = -1;
        let activityCol = -1;

        for (let i = mainTableEndIndex; i < lines.length; i++) {
            const line = lines[i].trim();
            const nextLine = (lines[i + 1] || '').trim();
            // Header must start with |, have next line as markdown delimiter (---|---),
            // and have columns containing category and activity/candidates/presets/names
            if (line.startsWith('|') && nextLine.startsWith('|') && nextLine.includes('---')) {
                const headerCols = line.split('|').slice(1, -1).map(c => c.trim().toLowerCase());
                const catIdx = headerCols.findIndex(h => h.includes('category'));
                const actIdx = headerCols.findIndex(h => h.includes('activit') || h.includes('candidate') || h.includes('preset') || h.includes('name'));
                if (catIdx !== -1 && actIdx !== -1 && catIdx !== actIdx) {
                    presetHeaderLine = i;
                    categoryCol = catIdx;
                    activityCol = actIdx;
                    break;
                }
            }
        }

        if (presetHeaderLine !== -1) {
            for (let i = presetHeaderLine + 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line.startsWith('|')) {
                    if (Object.keys(activityPresets).length > 0) break;
                    continue;
                }
                if (line.includes('---')) continue;

                const cells = line.split('|').slice(1, -1).map(c => c.trim());
                const categoryName = (cells[categoryCol] || '').trim();
                const rawActivities = (cells[activityCol] || '').trim();

                if (categoryName && rawActivities) {
                    const activities = rawActivities
                        .split(',')
                        .map(a => a.trim())
                        .filter(Boolean);
                    if (activities.length > 0) {
                        activityPresets[categoryName] = activities;
                    }
                }
            }
        }

        return {
            version: 1,
            fields,
            defaultReportGrouping,
            activityPresets: Object.keys(activityPresets).length > 0 ? activityPresets : undefined,
        };
    }

    /**
     * Generate markdown content for a TrackingSchemaConfig
     */
    generateSchemaMarkdown(config: TrackingSchemaConfig): string {
        const rows: string[] = [];

        for (const f of config.fields) {
            const fieldName = f.label;
            const type = f.type;
            const required = f.required ? 'Yes' : 'No';
            const options = f.options ? f.options.map(o => o.label).join(', ') : '';
            const multiple = f.multiple ? 'Yes' : 'No';
            const role = f.ui?.timelineRole
                ? f.ui.timelineRole.charAt(0).toUpperCase() + f.ui.timelineRole.slice(1)
                : 'Content';
            const dimIndex = config.defaultReportGrouping.indexOf(f.id);
            const reportDim = dimIndex !== -1 ? String(dimIndex + 1) : '';
            const aliases = f.aliases ? f.aliases.join(', ') : '';

            rows.push(`| ${fieldName} | ${type} | ${required} | ${options} | ${multiple} | ${role} | ${reportDim} | ${aliases} |`);
        }

        const presetRows: string[] = [];
        if (config.activityPresets) {
            for (const [cat, acts] of Object.entries(config.activityPresets)) {
                if (cat && acts.length > 0) {
                    presetRows.push(`| ${cat} | ${acts.join(', ')} |`);
                }
            }
        }

        const presetsSection = presetRows.length > 0
            ? `\n## Predefined Activities\n\n| Category | Activities |\n| :--- | :--- |\n${presetRows.join('\n')}\n`
            : '';

        return `# Activity Tracking Schema

Edit the table below to customize your activity fields.
Changes are saved and applied automatically.

| Field Name | Type | Required | Options | Allow Multiple | Timeline Role | Report Dimension | Aliases |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${rows.join('\n')}
${presetsSection}
> [!TIP]
> - **Type**: \`enum\` or \`string\`.
> - **Options**: Comma-separated values for \`enum\` fields. Colors are assigned automatically and stay consistent.
> - **Timeline Role**: \`Color\` (drives card background/border), \`Title\` (card heading), \`Badge\` (pill badge), \`Content\` (card body text), or \`Hidden\`.
> - **Report Dimension**: \`1\`, \`2\`, or \`3\` defines the aggregation hierarchy in monthly reports.
> - **Aliases**: Comma-separated historical column names so older monthly records parse without data loss.
> - **Predefined Activities**: First column is Category, second column is candidate activity names. Category doesn't have to be in this table. You can still type other activities freely.
`;
    }

    /**
     * Get the active schema config
     */
    getSchema(): TrackingSchemaConfig {
        return this.schema;
    }

    /**
     * Check if the schema has been loaded
     */
    hasLoaded(): boolean {
        return this.isLoaded;
    }

    /**
     * Get all configured fields in defined order
     */
    getFields(): FieldDefinition[] {
        return this.schema.fields;
    }

    /**
     * Lookup a field by its unique ID
     */
    getField(fieldId: string): FieldDefinition | undefined {
        return this.schema.fields.find(f => f.id === fieldId);
    }

    /**
     * Match a table column header to a field definition.
     * Checks field ID, label, and any aliases (case-insensitive).
     */
    getFieldByHeader(headerName: string): FieldDefinition | undefined {
        const normalized = headerName.trim().toLowerCase();
        return this.schema.fields.find(f => {
            if (f.id.toLowerCase() === normalized) return true;
            if (f.label.toLowerCase() === normalized) return true;
            if (f.aliases && f.aliases.some(alias => alias.toLowerCase() === normalized)) return true;
            return false;
        });
    }

    /**
     * Get the field designated for card color coding
     */
    getColorField(): FieldDefinition | undefined {
        // First priority: explicit timelineRole: 'color'
        const explicit = this.schema.fields.find(f => f.ui?.timelineRole === 'color');
        if (explicit) return explicit;

        // Second priority: first enum field
        const firstEnum = this.schema.fields.find(f => f.type === 'enum');
        if (firstEnum) return firstEnum;

        // Fallback: first field
        return this.schema.fields[0];
    }

    /**
     * Get the field designated for card title display
     */
    getTitleField(): FieldDefinition | undefined {
        // First priority: explicit timelineRole: 'title'
        const explicit = this.schema.fields.find(f => f.ui?.timelineRole === 'title');
        if (explicit) return explicit;

        // Second priority: first string field
        const firstString = this.schema.fields.find(f => f.type === 'string');
        if (firstString) return firstString;

        // Fallback: first field
        return this.schema.fields[0];
    }

    /**
     * Get all fields designated as badges on timeline cards
     */
    getBadgeFields(): FieldDefinition[] {
        return this.schema.fields.filter(f => f.ui?.timelineRole === 'badge');
    }

    /**
     * Get all fields designated as content in card body
     */
    getContentFields(): FieldDefinition[] {
        return this.schema.fields.filter(f => f.ui?.timelineRole === 'content');
    }

    /**
     * Get candidate activity names for a specific category (or all candidates if category not provided)
     */
    getActivityCandidates(category?: string): string[] {
        const presets = this.schema.activityPresets;
        if (!presets) return [];

        if (category && category.trim()) {
            const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
            const target = clean(category);
            for (const [catName, activities] of Object.entries(presets)) {
                if (clean(catName) === target) {
                    return [...activities];
                }
            }
            // Category not found in presets table
            return [];
        }

        return this.getAllActivityCandidates();
    }

    /**
     * Get all unique candidate activity names across all categories
     */
    getAllActivityCandidates(): string[] {
        const presets = this.schema.activityPresets;
        if (!presets) return [];

        const all = new Set<string>();
        for (const activities of Object.values(presets)) {
            for (const act of activities) {
                if (act.trim()) all.add(act.trim());
            }
        }
        return Array.from(all);
    }
}

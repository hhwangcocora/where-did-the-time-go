import { Plugin, WorkspaceLeaf, debounce } from 'obsidian';
import { TimeTrackerSettings, DEFAULT_SETTINGS, VIEW_TYPE_TIMELINE, VIEW_TYPE_REPORTS } from './src/types';
import { TimeTrackerSettingTab } from './src/settings';
import { DataManager } from './src/data/DataManager';
import { SchemaManager } from './src/data/SchemaManager';
import { TimelineView } from './src/views/TimelineView';
import { ReportsView } from './src/views/ReportsView';
import { EntryModal } from './src/modals/EntryModal';
import { DiaryModal } from './src/modals/DiaryModal';
import { TableParser } from './src/data/TableParser';
import { Logger } from './src/utils/Logger';

export default class PersonalTimeTrackerPlugin extends Plugin {
    settings: TimeTrackerSettings;
    dataManager: DataManager;
    schemaManager: SchemaManager;

    async onload(): Promise<void> {
        Logger.debug('Loading Personal Time Tracker plugin');

        // Load settings
        await this.loadSettings();

        // Initialize logger with debug mode from settings
        Logger.setDebugMode(this.settings.debugMode);

        // Initialize schema manager and load Schema.md
        this.schemaManager = new SchemaManager(this.app.vault, this.settings);
        await this.schemaManager.loadSchema();

        // Ensure schema is reloaded once Obsidian workspace layout and vault indexing are ready
        this.app.workspace.onLayoutReady(async () => {
            await this.schemaManager.loadSchema();
        });

        // Initialize data manager with schema manager reference
        this.dataManager = new DataManager(this.app.vault, this.settings, this.schemaManager);

        // Register the timeline view
        this.registerView(
            VIEW_TYPE_TIMELINE,
            (leaf) => new TimelineView(leaf, this.settings, this.dataManager)
        );

        // Register the reports view
        this.registerView(
            VIEW_TYPE_REPORTS,
            (leaf) => new ReportsView(leaf, this.settings, this.dataManager)
        );

        // Add ribbon icon to open timeline
        this.addRibbonIcon('clock', 'Open timeline', () => {
            void this.activateTimelineView();
        });

        // Add ribbon icon to open reports
        this.addRibbonIcon('pie-chart', 'Open reports', () => {
            void this.activateReportsView();
        });

        // Add command to open timeline
        this.addCommand({
            id: 'open-timeline',
            name: 'Open timeline',
            callback: () => {
                void this.activateTimelineView();
            },
        });

        // Add command to open reports
        this.addCommand({
            id: 'open-reports',
            name: 'Open reports',
            callback: () => {
                void this.activateReportsView();
            },
        });

        // Add command to create new entry
        this.addCommand({
            id: 'create-entry',
            name: 'Create time entry',
            callback: () => {
                this.openCreateEntryModal();
            },
        });

        // Add command to open today's diary
        this.addCommand({
            id: 'open-today-diary',
            name: "Open today's diary",
            callback: () => {
                const todayStr = TableParser.getDateString(new Date());
                new DiaryModal(this.app, this.dataManager, todayStr).open();
            },
        });

        // Add settings tab
        this.addSettingTab(new TimeTrackerSettingTab(this.app, this));

        // Debounced refresh to avoid excessive updates during sync operations
        const debouncedRefresh = debounce(() => this.refreshTimelineViews(), 500, true);

        // Debounced schema reload so typing in Schema.md updates views smoothly
        const debouncedSchemaReload = debounce(async () => {
            Logger.debug('Schema.md modified, reloading schema');
            await this.schemaManager.loadSchema();
            debouncedRefresh();
        }, 1000, true);

        // Watch for file changes to invalidate cache
        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (file.path.startsWith(this.settings.timeTrackingFolder)) {
                    // Watch for Schema.md changes
                    if (file.name === 'Schema.md') {
                        debouncedSchemaReload();
                        return;
                    }

                    // Invalidate cache for monthly time tracking files
                    const monthMatch = file.name.match(/^(\d{4}-\d{2})\.md$/);
                    if (monthMatch) {
                        this.dataManager.invalidateMonth(monthMatch[1]);
                        // Refresh open timeline views (debounced)
                        debouncedRefresh();
                    }
                }
            })
        );
    }

    onunload(): void {
        Logger.debug('Unloading Personal Time Tracker plugin');
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<TimeTrackerSettings> | null);
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
        // Update logger debug mode
        Logger.setDebugMode(this.settings.debugMode);
        // Update schema manager with new settings
        if (this.schemaManager) {
            this.schemaManager.updateSettings(this.settings);
        }
        // Update data manager with new settings
        if (this.dataManager) {
            this.dataManager.updateSettings(this.settings);
        }
        // Refresh timeline views
        this.refreshTimelineViews();
    }

    /**
     * Activate or focus the timeline view
     */
    async activateTimelineView(): Promise<void> {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);

        if (leaves.length > 0) {
            // View already exists, focus it
            leaf = leaves[0];
        } else {
            // Create new leaf in the right sidebar or main area
            leaf = workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({
                    type: VIEW_TYPE_TIMELINE,
                    active: true,
                });
            }
        }

        if (leaf) {
            void workspace.revealLeaf(leaf);
        }
    }

    /**
     * Activate or focus the reports view
     */
    async activateReportsView(): Promise<void> {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_REPORTS);

        if (leaves.length > 0) {
            // View already exists, focus it
            leaf = leaves[0];
        } else {
            // Create new leaf in the right sidebar or main area
            leaf = workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({
                    type: VIEW_TYPE_REPORTS,
                    active: true,
                });
            }
        }

        if (leaf) {
            void workspace.revealLeaf(leaf);
        }
    }

    /**
     * Open the create entry modal directly (for command palette)
     */
    private openCreateEntryModal(): void {
        const now = new Date();
        // Round to nearest 15 minutes
        const minutes = Math.floor(now.getMinutes() / 15) * 15;
        const startTime = `${now.getHours().toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

        const modal = new EntryModal(
            this.app,
            this.settings,
            this.dataManager,
            {
                mode: 'create',
                date: now,
                startTime,
            },
            () => this.refreshTimelineViews()
        );
        modal.open();
    }

    /**
     * Refresh all open timeline views
     */
    private refreshTimelineViews(): void {
        // Refresh timeline views
        const timelineLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
        for (const leaf of timelineLeaves) {
            const view = leaf.view as TimelineView;
            if (view && view.updateSettings) {
                view.updateSettings(this.settings);
            }
        }

        // Refresh reports views
        const reportsLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_REPORTS);
        for (const leaf of reportsLeaves) {
            const view = leaf.view as ReportsView;
            if (view && view.updateSettings) {
                view.updateSettings(this.settings);
            }
        }
    }
}

import { App, PluginSettingTab, Setting, TFile, Notice } from 'obsidian';
import type PersonalTimeTrackerPlugin from '../main';

export class TimeTrackerSettingTab extends PluginSettingTab {
    plugin: PersonalTimeTrackerPlugin;

    constructor(app: App, plugin: PersonalTimeTrackerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('p', {
            text: 'Configure your personal time tracking settings.',
            cls: 'setting-item-description'
        });

        // Storage Settings
        new Setting(containerEl).setName("Storage").setHeading();

        new Setting(containerEl)
            .setName('Time tracking folder')
            .setDesc('Folder where time entries and Schema.md are stored (relative to vault root)')
            .addText(text => text
                .setPlaceholder('Enter folder name')
                .setValue(this.plugin.settings.timeTrackingFolder)
                .onChange(async (value) => {
                    this.plugin.settings.timeTrackingFolder = value || 'TimeTracking';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto-create folder')
            .setDesc('Automatically create the time tracking folder if it doesn\'t exist')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoCreateFolder)
                .onChange(async (value) => {
                    this.plugin.settings.autoCreateFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Hide tables in reading view')
            .setDesc('Wrap data tables in %% comment markers to hide them in reading view. Disable to see raw table data.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.hideTablesInPreview)
                .onChange(async (value) => {
                    this.plugin.settings.hideTablesInPreview = value;
                    await this.plugin.saveSettings();
                }));

        // Activity Schema Section
        new Setting(containerEl).setName("Activity schema (Schema.md)").setHeading();
        containerEl.createEl('p', {
            text: 'Categories, activities, locations, tags, and report dimensions are defined in Schema.md within your time tracking folder as an editable Markdown table.',
            cls: 'setting-item-description'
        });

        new Setting(containerEl)
            .setName('Open Schema.md')
            .setDesc('Open Schema.md in your workspace to edit categories, enum values, and timeline roles')
            .addButton(button => button
                .setButtonText('Open Schema.md')
                .setCta()
                .onClick(async () => {
                    const schemaPath = `${this.plugin.settings.timeTrackingFolder}/Schema.md`;
                    let file = this.app.vault.getAbstractFileByPath(schemaPath);
                    if (!file && this.plugin.schemaManager) {
                        await this.plugin.schemaManager.loadSchema();
                        file = this.app.vault.getAbstractFileByPath(schemaPath);
                    }
                    if (file instanceof TFile) {
                        await this.app.workspace.getLeaf().openFile(file);
                    } else {
                        new Notice(`Could not open ${schemaPath}`);
                    }
                }));

        new Setting(containerEl)
            .setName('Reload schema')
            .setDesc('Force reload Schema.md if you edited it externally')
            .addButton(button => button
                .setButtonText('Reload schema')
                .onClick(async () => {
                    if (this.plugin.schemaManager) {
                        await this.plugin.schemaManager.loadSchema();
                        new Notice('Schema reloaded successfully');
                    }
                }));

        // Timeline Display Settings
        new Setting(containerEl).setName("Timeline display").setHeading();

        new Setting(containerEl)
            .setName('Hour height')
            .setDesc('Height in pixels for each hour in the timeline view')
            .addSlider(slider => slider
                .setLimits(50, 240, 10)
                .setValue(this.plugin.settings.hourHeight)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.hourHeight = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Day start hour')
            .setDesc('First hour to display in the timeline (0-23)')
            .addDropdown(dropdown => {
                for (let i = 0; i <= 12; i++) {
                    dropdown.addOption(i.toString(), `${i}:00`);
                }
                dropdown.setValue(this.plugin.settings.dayStartHour.toString());
                dropdown.onChange(async (value) => {
                    this.plugin.settings.dayStartHour = parseInt(value);
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName('Day end hour')
            .setDesc('Last hour to display in the timeline (0-23)')
            .addDropdown(dropdown => {
                for (let i = 18; i <= 24; i++) {
                    dropdown.addOption(i.toString(), i === 24 ? '24:00 (midnight)' : `${i}:00`);
                }
                dropdown.setValue(this.plugin.settings.dayEndHour.toString());
                dropdown.onChange(async (value) => {
                    this.plugin.settings.dayEndHour = parseInt(value);
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName('24-hour format')
            .setDesc('Use 24-hour time format instead of 12-hour')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.use24HourFormat)
                .onChange(async (value) => {
                    this.plugin.settings.use24HourFormat = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Description max length')
            .setDesc('Maximum characters for entry descriptions (0 = no limit)')
            .addText(text => text
                .setValue(this.plugin.settings.descriptionMaxLength.toString())
                .setPlaceholder('200')
                .onChange(async (value) => {
                    const num = parseInt(value) || 0;
                    this.plugin.settings.descriptionMaxLength = Math.max(0, num);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Week start')
            .setDesc('First day of the week')
            .addDropdown(dropdown => dropdown
                .addOption('monday', 'Monday')
                .addOption('sunday', 'Sunday')
                .setValue(this.plugin.settings.weekStart)
                .onChange(async (value: 'monday' | 'sunday') => {
                    this.plugin.settings.weekStart = value;
                    await this.plugin.saveSettings();
                }));

        // Developer Settings
        new Setting(containerEl).setName("Developer").setHeading();

        new Setting(containerEl)
            .setName('Debug mode')
            .setDesc('Enable verbose logging to the developer console (useful for troubleshooting)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.debugMode)
                .onChange(async (value) => {
                    this.plugin.settings.debugMode = value;
                    await this.plugin.saveSettings();
                }));
    }
}

import { App, Modal, Setting, DropdownComponent, TextComponent, TextAreaComponent, Notice, FuzzySuggestModal, TFile } from 'obsidian';
import { TimeEntry, TimeTrackerSettings, TrackingSchemaConfig, FieldDefinition, DEFAULT_SCHEMA_CONFIG } from '../types';
import { DataManager } from '../data/DataManager';
import { SchemaManager } from '../data/SchemaManager';
import { TableParser } from '../data/TableParser';
import { Logger } from '../utils/Logger';
import { TimeInput } from '../components/TimeInput';

/**
 * Simple confirmation modal to replace browser confirm()
 */
class ConfirmModal extends Modal {
    private message: string;
    private onConfirm: () => void;

    constructor(app: App, message: string, onConfirm: () => void) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl('p', { text: this.message });

        const buttonRow = contentEl.createDiv('modal-button-row');

        const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        const confirmBtn = buttonRow.createEl('button', { text: 'Delete', cls: 'mod-warning' });
        confirmBtn.addEventListener('click', () => {
            this.onConfirm();
            this.close();
        });
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * Mode for the entry modal
 */
export type EntryModalMode = 'create' | 'edit';

/**
 * Data passed when opening the modal
 */
export interface EntryModalData {
    mode: EntryModalMode;
    /** For create mode: the date to create the entry on */
    date?: Date;
    /** For create mode: optional pre-filled start time */
    startTime?: string;
    /** For create mode: optional pre-filled end time (from drag selection) */
    endTime?: string;
    /** For edit mode: the existing entry to edit */
    entry?: TimeEntry;
}

/**
 * Modal for creating or editing time entries
 */
export class EntryModal extends Modal {
    private settings: TimeTrackerSettings;
    private dataManager: DataManager;
    private schemaManager?: SchemaManager;
    private schema: TrackingSchemaConfig;
    private data: EntryModalData;
    private onSave: () => void;

    // Form values
    private startDateValue: string;
    private startTimeValue: string;
    private endDateValue: string;
    private endTimeValue: string;
    private durationValue: string; // e.g., "1h 30m" or "90m"

    // Dynamic field values
    private fieldValues: Record<string, string | string[]> = {};

    // Getters and setters for backwards compatibility
    get descriptionValue(): string {
        const val = this.fieldValues['activity_name'] || this.fieldValues['description'];
        return typeof val === 'string' ? val : (Array.isArray(val) ? val.join(', ') : '');
    }
    set descriptionValue(v: string) {
        this.fieldValues['activity_name'] = v;
    }

    get projectValue(): string {
        const val = this.fieldValues['project'];
        return typeof val === 'string' ? val : '';
    }
    set projectValue(v: string) {
        this.fieldValues['project'] = v;
    }

    get activityValue(): string {
        const val = this.fieldValues['category'] || this.fieldValues['activity'];
        return typeof val === 'string' ? val : '';
    }
    set activityValue(v: string) {
        this.fieldValues['category'] = v;
    }

    get linkedNoteValue(): string {
        const val = this.fieldValues['notes'] || this.fieldValues['linkedNote'];
        return typeof val === 'string' ? val : '';
    }
    set linkedNoteValue(v: string) {
        this.fieldValues['notes'] = v;
    }

    // Cleanup handlers
    private cleanupHandlers: (() => void)[] = [];

    // Input references for updating
    private endDateInput: TextComponent | null = null;
    private endTimeInput: TimeInput | null = null;
    private durationInput: TextComponent | null = null;
    private startDateInput: TextComponent | null = null;
    private startTimeInput: TimeInput | null = null;

    // Overlap validation UI
    private saveButton: HTMLButtonElement | null = null;
    private warningBanner: HTMLElement | null = null;
    private startOverlap: TimeEntry | null = null;
    private endOverlap: TimeEntry | null = null;
    private encompassedEntry: TimeEntry | null = null;

    // Snap hints for adjacent entries
    private previousEntry: TimeEntry | null = null;
    private nextEntry: TimeEntry | null = null;
    private startSnapHint: HTMLElement | null = null;
    private endSnapHint: HTMLElement | null = null;

    // Validation request counter to prevent race conditions
    private validationRequestId: number = 0;

    // Duration validation state
    private hasInvalidDuration: boolean = false;

    constructor(
        app: App,
        settings: TimeTrackerSettings,
        dataManager: DataManager,
        data: EntryModalData,
        onSave: () => void,
        schemaManager?: SchemaManager
    ) {
        super(app);
        this.settings = settings;
        this.dataManager = dataManager;
        this.data = data;
        this.onSave = onSave;
        this.schemaManager = schemaManager || this.dataManager?.getSchemaManager?.();
        this.schema = this.schemaManager ? this.schemaManager.getSchema() : (this.dataManager?.getSchema ? this.dataManager.getSchema() : DEFAULT_SCHEMA_CONFIG);

        // Initialize form values
        this.fieldValues = {};

        if (data.mode === 'edit' && data.entry) {
            // Use the computed DateTime objects for accuracy
            this.startDateValue = TableParser.getDateString(data.entry.startDateTime);
            this.startTimeValue = data.entry.start;
            this.endDateValue = TableParser.getDateString(data.entry.endDateTime);
            this.endTimeValue = data.entry.end;
            this.durationValue = this.formatDurationMinutes(data.entry.durationMinutes);

            if (data.entry.fields) {
                for (const [key, val] of Object.entries(data.entry.fields)) {
                    this.fieldValues[key] = val;
                }
            }

            // Fallbacks from legacy entry properties
            if (!this.fieldValues['activity_name'] && data.entry.description) {
                this.fieldValues['activity_name'] = data.entry.description;
            }
            if (!this.fieldValues['category'] && data.entry.activity) {
                this.fieldValues['category'] = data.entry.activity;
            }
            if (!this.fieldValues['project'] && data.entry.project) {
                this.fieldValues['project'] = data.entry.project;
            }
            if (!this.fieldValues['notes'] && data.entry.linkedNote) {
                this.fieldValues['notes'] = data.entry.linkedNote;
            }
        } else {
            // Create mode defaults
            const date = data.date || new Date();
            this.startDateValue = TableParser.getDateString(date);
            this.startTimeValue = data.startTime || this.getCurrentTimeRounded();

            // Calculate end date/time
            if (data.endTime) {
                // From drag selection - check if end < start (spans midnight)
                const startMins = this.timeToMinutes(this.startTimeValue);
                const endMins = this.timeToMinutes(data.endTime);
                if (endMins < startMins) {
                    // Spans midnight - end date is next day
                    const nextDay = new Date(date);
                    nextDay.setDate(nextDay.getDate() + 1);
                    this.endDateValue = TableParser.getDateString(nextDay);
                } else {
                    this.endDateValue = this.startDateValue;
                }
                this.endTimeValue = data.endTime;
            } else {
                // Default +1 hour
                this.endDateValue = this.startDateValue;
                this.endTimeValue = this.addHourToTime(this.startTimeValue);
            }

            this.durationValue = this.calculateDurationFromDates();

            // Initialize defaults from schema
            for (const field of this.schema.fields) {
                if (field.multiple) {
                    // For multi-select fields (including multi-select enums), never pre-select any value unless an array default is explicitly configured
                    if (Array.isArray(field.defaultValue) && field.defaultValue.length > 0) {
                        this.fieldValues[field.id] = [...field.defaultValue];
                    } else {
                        this.fieldValues[field.id] = [];
                    }
                } else if (field.defaultValue !== undefined && field.defaultValue !== null) {
                    this.fieldValues[field.id] = field.defaultValue;
                } else if (field.type === 'enum' && field.options && field.options.length > 0) {
                    if (field.required) {
                        this.fieldValues[field.id] = field.options[0].id;
                    } else {
                        this.fieldValues[field.id] = '';
                    }
                } else {
                    this.fieldValues[field.id] = '';
                }
            }
        }
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('time-tracker-entry-modal');

        // Title
        const title = this.data.mode === 'edit' ? 'Edit Time Entry' : 'New Time Entry';
        contentEl.createEl('h2', { text: title });

        // Start row: Date and Time with magnet button
        const startRow = contentEl.createDiv('time-row');

        const startSetting = new Setting(startRow)
            .setName('Start')
            .addText((text) => {
                this.startDateInput = text;
                text.setValue(this.startDateValue);
                text.inputEl.type = 'date';
                text.onChange((value) => {
                    this.startDateValue = value;
                    this.recalculateDuration();
                    void this.validateOverlap();
                    void this.findAdjacentEntries();
                });
            });
        this.startTimeInput = new TimeInput(startSetting.controlEl, this.settings.use24HourFormat,
            'Start', this.startTimeValue, (value) => {
                this.startTimeValue = value;
                this.recalculateDuration();
                void this.validateOverlap();
                void this.findAdjacentEntries();
            });

        // Magnet button for start (snap to end of previous entry)
        this.startSnapHint = startSetting.controlEl.createEl('button', {
            cls: 'time-magnet-btn',
            text: '🧲',
        });
        this.startSnapHint.addClass('is-hidden'); // Hidden until adjacent entry found
        this.startSnapHint.addEventListener('click', (e) => {
            e.preventDefault();
            this.snapStartToPrevious();
        });

        // Duration row (between start and end)
        new Setting(contentEl)
            .setName('Duration')
            .addText((text) => {
                this.durationInput = text;
                text.setValue(this.durationValue);
                text.setPlaceholder('1h 30m');
                text.inputEl.addClass('duration-input');
                text.onChange((value) => {
                    this.durationValue = value;
                    this.updateEndFromDuration();
                    void this.validateOverlap();
                });
            });

        // End row: Date and Time with magnet button
        const endRow = contentEl.createDiv('time-row');

        const endSetting = new Setting(endRow)
            .setName('End')
            .addText((text) => {
                this.endDateInput = text;
                text.setValue(this.endDateValue);
                text.inputEl.type = 'date';
                text.onChange((value) => {
                    this.endDateValue = value;
                    this.recalculateDuration();
                    void this.validateOverlap();
                    void this.findAdjacentEntries();
                });
            });
        this.endTimeInput = new TimeInput(endSetting.controlEl, this.settings.use24HourFormat,
            'End', this.endTimeValue, (value) => {
                this.endTimeValue = value;
                this.recalculateDuration();
                void this.validateOverlap();
                void this.findAdjacentEntries();
            });

        // Magnet button for end (snap to start of next entry)
        this.endSnapHint = endSetting.controlEl.createEl('button', {
            cls: 'time-magnet-btn',
            text: '🧲',
        });
        this.endSnapHint.addClass('is-hidden'); // Hidden until adjacent entry found
        this.endSnapHint.addEventListener('click', (e) => {
            e.preventDefault();
            this.snapEndToNext();
        });

        // Overlap warning banner (hidden by default)
        this.warningBanner = contentEl.createDiv('overlap-warning-banner');
        this.warningBanner.addClass('is-hidden');

        // Render dynamic schema fields
        for (const field of this.schema.fields) {
            this.renderSchemaField(contentEl, field);
        }

        // Button row
        const buttonRow = contentEl.createDiv('modal-button-row');

        // Delete button (only for edit mode)
        if (this.data.mode === 'edit') {
            const deleteBtn = buttonRow.createEl('button', {
                text: 'Delete',
                cls: 'mod-warning',
            });
            deleteBtn.addEventListener('click', () => this.handleDelete());
        }

        // Spacer
        buttonRow.createDiv('button-spacer');

        // Cancel button
        const cancelBtn = buttonRow.createEl('button', {
            text: 'Cancel',
        });
        cancelBtn.addEventListener('click', () => this.close());

        // Save button
        this.saveButton = buttonRow.createEl('button', {
            text: 'Save',
            cls: 'mod-cta',
        });
        this.saveButton.addEventListener('click', () => { void this.handleSave(); });

        // Check for overlaps and find adjacent entries on initial load
        void this.validateOverlap();
        void this.findAdjacentEntries();
    }

    onClose(): void {
        // Run cleanup handlers
        this.startTimeInput?.destroy();
        this.endTimeInput?.destroy();
        for (const handler of this.cleanupHandlers) {
            handler();
        }
        this.cleanupHandlers = [];

        const { contentEl } = this;
        contentEl.empty();
    }

    /**
     * Render a dynamic form input according to field definition
     */
    private renderSchemaField(container: HTMLElement, field: FieldDefinition): void {
        const setting = new Setting(container);
        const labelText = field.required ? `${field.label} *` : field.label;
        setting.setName(labelText);

        if (field.type === 'enum' || field.options) {
            if (field.multiple && field.options && field.options.length > 0) {
                // Interactive multi-select chips/pills
                this.renderMultiSelectEnum(setting, field);
            } else if (field.multiple) {
                // Multi-select enum without defined options or comma-separated tags
                const currentVal = this.fieldValues[field.id];
                const strVal = Array.isArray(currentVal) ? currentVal.join(', ') : (currentVal || '');
                setting.addText((text) => {
                    text.setValue(strVal);
                    text.setPlaceholder(field.ui?.placeholder || 'Comma-separated');
                    text.onChange((val) => {
                        this.fieldValues[field.id] = val
                            ? val.split(',').map(s => s.trim()).filter(Boolean)
                            : [];
                    });
                });
            } else {
                // Single enum: Dropdown
                setting.addDropdown((dropdown) => {
                    if (!field.required) {
                        dropdown.addOption('', '(None)');
                    }
                    if (field.options) {
                        for (const opt of field.options) {
                            dropdown.addOption(opt.id, opt.label);
                        }
                    }
                    const currentVal = typeof this.fieldValues[field.id] === 'string'
                        ? (this.fieldValues[field.id] as string)
                        : '';
                    dropdown.setValue(currentVal);
                    dropdown.onChange((val) => {
                        this.fieldValues[field.id] = val;
                    });
                });
            }
        } else {
            // String type
            if (field.ui?.widget === 'note-link' || field.id === 'notes' || field.label.toLowerCase().includes('note')) {
                // Wikilink note selector
                let noteInput: TextComponent;
                const currentVal = typeof this.fieldValues[field.id] === 'string' ? (this.fieldValues[field.id] as string) : '';
                setting.addText((text) => {
                    noteInput = text;
                    text.setValue(currentVal);
                    text.setPlaceholder('Enter note path');
                    text.onChange((val) => {
                        this.fieldValues[field.id] = val;
                    });
                });

                // Browse existing notes button
                setting.addButton((btn) => {
                    btn.setButtonText('Browse')
                        .setTooltip('Select an existing note')
                        .onClick(() => {
                            new NoteSuggestModal(this.app, (file) => {
                                const path = file.path.replace(/\.md$/, '');
                                noteInput.setValue(path);
                                this.fieldValues[field.id] = path;
                            }).open();
                        });
                });

                // Create new note button
                setting.addButton((btn) => {
                    btn.setButtonText('Create new')
                        .setTooltip('Create a new linked note')
                        .onClick(() => {
                            this.showCreateNoteInput(container, noteInput);
                        });
                });
            } else if (field.multiple) {
                // Multiple strings (e.g. tags)
                const currentVal = this.fieldValues[field.id];
                const strVal = Array.isArray(currentVal) ? currentVal.join(', ') : (currentVal || '');
                setting.addText((text) => {
                    text.setValue(strVal);
                    text.setPlaceholder(field.ui?.placeholder || 'tag1, tag2');
                    text.onChange((val) => {
                        this.fieldValues[field.id] = val
                            ? val.split(',').map(s => s.trim()).filter(Boolean)
                            : [];
                    });
                });
            } else if (field.ui?.widget === 'textarea' || field.id === 'activity_name' || field.label.toLowerCase().includes('description')) {
                // Multiline textarea or primary description
                const maxLen = this.settings.descriptionMaxLength;
                const currentVal = typeof this.fieldValues[field.id] === 'string' ? (this.fieldValues[field.id] as string) : '';

                if (maxLen > 0) {
                    const counterEl = setting.nameEl.createSpan('description-counter');
                    const updateCounter = (len: number) => {
                        counterEl.setText(` (${len}/${maxLen})`);
                        counterEl.toggleClass('is-over-limit', len > maxLen);
                        counterEl.toggleClass('is-near-limit', len > maxLen * 0.8 && len <= maxLen);
                    };
                    updateCounter(currentVal.length);

                    setting.addTextArea((text) => {
                        text.setValue(currentVal);
                        text.setPlaceholder(field.ui?.placeholder || 'What did you work on?');
                        text.inputEl.rows = 3;
                        text.onChange((val) => {
                            let cleaned = val;
                            if (maxLen > 0 && cleaned.length > maxLen) {
                                cleaned = cleaned.substring(0, maxLen);
                                text.setValue(cleaned);
                            }
                            this.fieldValues[field.id] = cleaned;
                            updateCounter(cleaned.length);
                        });
                    });
                } else {
                    setting.addTextArea((text) => {
                        text.setValue(currentVal);
                        text.setPlaceholder(field.ui?.placeholder || 'What did you work on?');
                        text.inputEl.rows = 3;
                        text.onChange((val) => {
                            this.fieldValues[field.id] = val;
                        });
                    });
                }
            } else {
                // Standard text input
                const currentVal = typeof this.fieldValues[field.id] === 'string' ? (this.fieldValues[field.id] as string) : '';
                setting.addText((text) => {
                    text.setValue(currentVal);
                    if (field.ui?.placeholder) text.setPlaceholder(field.ui.placeholder);
                    text.onChange((val) => {
                        this.fieldValues[field.id] = val;
                    });
                });
            }
        }
    }

    /**
     * Render an interactive multi-select chip toggle group for enum fields with multiple: true
     */
    private renderMultiSelectEnum(setting: Setting, field: FieldDefinition): void {
        setting.settingEl.addClass('has-multi-select');

        // Normalize current value to string array
        const rawVal = this.fieldValues[field.id];
        let selectedList: string[] = [];
        if (Array.isArray(rawVal)) {
            selectedList = rawVal.map(s => String(s).trim()).filter(Boolean);
        } else if (typeof rawVal === 'string' && rawVal.trim()) {
            selectedList = rawVal.split(',').map(s => s.trim()).filter(Boolean);
        }

        // Maintain selection state
        const selectedSet = new Set<string>(selectedList);
        this.fieldValues[field.id] = Array.from(selectedSet);

        const container = setting.controlEl.createDiv('multi-select-enum-container');
        const chipsContainer = container.createDiv('multi-select-chips');

        const updateSelection = () => {
            this.fieldValues[field.id] = Array.from(selectedSet);
        };

        const definedOptions = field.options || [];

        // 1. Render predefined options
        for (const opt of definedOptions) {
            let matchedValue: string | undefined;
            for (const item of selectedSet) {
                if (item.toLowerCase() === opt.label.toLowerCase() || item.toLowerCase() === opt.id.toLowerCase()) {
                    matchedValue = item;
                    break;
                }
            }
            const isSelected = matchedValue !== undefined;

            const chip = chipsContainer.createSpan({
                cls: `multi-select-chip ${isSelected ? 'is-selected' : ''}`,
            });
            chip.setAttribute('role', 'button');
            chip.setAttribute('tabindex', '0');
            chip.setAttribute('aria-pressed', isSelected ? 'true' : 'false');

            if (isSelected) {
                const checkIcon = chip.createSpan('chip-check-icon');
                checkIcon.setText('✓ ');
            }
            chip.createSpan({ text: opt.label });

            chip.addEventListener('click', () => {
                const currentlySelected = chip.classList.contains('is-selected');
                if (currentlySelected) {
                    if (matchedValue) selectedSet.delete(matchedValue);
                    selectedSet.delete(opt.label);
                    selectedSet.delete(opt.id);
                    chip.removeClass('is-selected');
                    chip.setAttribute('aria-pressed', 'false');
                    const icon = chip.querySelector('.chip-check-icon');
                    if (icon) icon.remove();
                } else {
                    selectedSet.add(opt.label);
                    matchedValue = opt.label;
                    chip.addClass('is-selected');
                    chip.setAttribute('aria-pressed', 'true');
                    if (!chip.querySelector('.chip-check-icon')) {
                        const icon = chip.createSpan({ cls: 'chip-check-icon', text: '✓ ' });
                        chip.insertBefore(icon, chip.firstChild);
                    }
                }
                updateSelection();
            });

            chip.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    chip.click();
                }
            });
        }

        // Helper to append a custom chip
        const addCustomChip = (val: string) => {
            const customChip = chipsContainer.createSpan({
                cls: 'multi-select-chip is-selected is-custom',
            });
            const checkIcon = customChip.createSpan('chip-check-icon');
            checkIcon.setText('✓ ');
            customChip.createSpan({ text: val });
            const removeBtn = customChip.createSpan({
                cls: 'chip-remove-icon',
                text: ' ×',
            });
            removeBtn.setAttribute('title', `Remove ${val}`);
            removeBtn.addEventListener('click', (e: MouseEvent) => {
                e.stopPropagation();
                selectedSet.delete(val);
                updateSelection();
                customChip.remove();
            });
        };

        // 2. Render custom values not in predefined options
        for (const val of selectedSet) {
            const isDefined = definedOptions.some(o =>
                o.label.toLowerCase() === val.toLowerCase() ||
                o.id.toLowerCase() === val.toLowerCase()
            );
            if (!isDefined) {
                addCustomChip(val);
            }
        }

        // 3. Optional inline custom input for ad-hoc additions
        const addContainer = container.createDiv('multi-select-add-custom');
        const customInput = addContainer.createEl('input', {
            type: 'text',
            cls: 'multi-select-custom-input',
            placeholder: '+ Add other...',
        });

        const handleAddCustom = () => {
            const val = customInput.value.trim();
            if (!val) return;

            // Check if matches an existing predefined option
            const matchingOpt = field.options?.find(o =>
                o.label.toLowerCase() === val.toLowerCase() ||
                o.id.toLowerCase() === val.toLowerCase()
            );

            if (matchingOpt) {
                if (!selectedSet.has(matchingOpt.label) && !selectedSet.has(matchingOpt.id)) {
                    selectedSet.add(matchingOpt.label);
                    updateSelection();
                    const chipEl = Array.from(chipsContainer.querySelectorAll('.multi-select-chip')).find(
                        c => c.textContent?.includes(matchingOpt.label)
                    ) as HTMLElement;
                    if (chipEl && !chipEl.classList.contains('is-selected')) {
                        chipEl.addClass('is-selected');
                        chipEl.setAttribute('aria-pressed', 'true');
                        if (!chipEl.querySelector('.chip-check-icon')) {
                            const icon = chipEl.createSpan({ cls: 'chip-check-icon', text: '✓ ' });
                            chipEl.insertBefore(icon, chipEl.firstChild);
                        }
                    }
                }
            } else {
                if (!selectedSet.has(val)) {
                    selectedSet.add(val);
                    updateSelection();
                    addCustomChip(val);
                }
            }

            customInput.value = '';
        };

        customInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleAddCustom();
            }
        });

        customInput.addEventListener('blur', () => {
            if (customInput.value.trim()) {
                handleAddCustom();
            }
        });
    }

    /**
     * Handle save button click
     */
    private async handleSave(): Promise<void> {
        // Validate the visible controls, including incomplete edits.
        if (this.startTimeInput) this.startTimeValue = this.startTimeInput.getValue();
        if (this.endTimeInput) this.endTimeValue = this.endTimeInput.getValue();

        // Validate required fields
        if (!this.startDateValue || !this.startTimeValue || !this.endDateValue || !this.endTimeValue) {
            Logger.error('EntryModal: Missing required fields');
            return;
        }

        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(this.startDateValue) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(this.endDateValue)) {
            Logger.error('EntryModal: Invalid date format');
            return;
        }

        // Validate end time is after start time (prevents negative durations)
        const startDateTime = new Date(`${this.startDateValue}T${this.startTimeValue}`);
        const endDateTime = new Date(`${this.endDateValue}T${this.endTimeValue}`);
        if (!Number.isFinite(startDateTime.getTime()) || !Number.isFinite(endDateTime.getTime()) || endDateTime <= startDateTime) {
            new Notice('End time must be after start time');
            return;
        }

        // Validate required schema fields
        for (const field of this.schema.fields) {
            if (field.required) {
                const val = this.fieldValues[field.id];
                const isEmpty = val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0);
                if (isEmpty) {
                    // Check fallback description
                    if (field.id === 'activity_name' && this.descriptionValue) {
                        this.fieldValues[field.id] = this.descriptionValue;
                        continue;
                    }
                    if (field.id === 'category' && (this.activityValue || field.defaultValue)) {
                        this.fieldValues[field.id] = this.activityValue || (field.defaultValue as string);
                        continue;
                    }
                    new Notice(`Please enter ${field.label}`);
                    return;
                }
            }
        }

        // Format start and end with explicit date+time: "YYYY-MM-DD HH:mm"
        const startForStorage = `${this.startDateValue} ${this.startTimeValue}`;
        const endForStorage = `${this.endDateValue} ${this.endTimeValue}`;

        Logger.log('Saving entry:', {
            date: this.startDateValue,
            start: startForStorage,
            end: endForStorage
        });

        // Prepare fields dictionary
        const fields = { ...this.fieldValues };

        // Maintain legacy helper properties for views/backward compatibility
        const description = typeof fields['activity_name'] === 'string'
            ? fields['activity_name']
            : (fields['description'] ? String(fields['description']) : '');
        const project = typeof fields['project'] === 'string' ? fields['project'] : undefined;
        const activity = typeof fields['category'] === 'string'
            ? fields['category']
            : (typeof fields['activity'] === 'string' ? fields['activity'] : undefined);
        const linkedNote = typeof fields['notes'] === 'string'
            ? fields['notes']
            : (typeof fields['linkedNote'] === 'string' ? fields['linkedNote'] : undefined);

        try {
            if (this.data.mode === 'edit' && this.data.entry) {
                // Update existing entry
                await this.dataManager.updateEntry(this.data.entry, {
                    date: this.startDateValue,
                    start: startForStorage,
                    end: endForStorage,
                    description,
                    project,
                    activity,
                    linkedNote,
                    fields,
                });
            } else {
                // Create new entry
                await this.dataManager.createEntry({
                    date: this.startDateValue,
                    start: startForStorage,
                    end: endForStorage,
                    description,
                    project,
                    activity,
                    linkedNote,
                    fields,
                });
            }

            this.onSave();
            this.close();
        } catch (error) {
            Logger.error('EntryModal: Error saving entry:', error);
            // The DataManager will show a Notice for overlap errors
        }
    }

    /**
     * Handle delete button click
     */
    private handleDelete(): void {
        if (this.data.mode !== 'edit' || !this.data.entry) {
            return;
        }

        // Show confirmation modal
        const modal = new ConfirmModal(
            this.app,
            'Are you sure you want to delete this entry?',
            () => {
                void this.performDelete();
            }
        );
        modal.open();
    }

    /**
     * Perform the actual entry deletion
     */
    private async performDelete(): Promise<void> {
        if (!this.data.entry) return;

        try {
            await this.dataManager.deleteEntry(this.data.entry);
            this.onSave();
            this.close();
        } catch (error) {
            Logger.error('EntryModal: Error deleting entry:', error);
        }
    }

    /**
     * Get current time rounded to nearest 15 minutes
     */
    private getCurrentTimeRounded(): string {
        const now = new Date();
        const minutes = Math.round(now.getMinutes() / 15) * 15;
        const hours = now.getHours() + (minutes >= 60 ? 1 : 0);
        const adjustedMinutes = minutes % 60;

        return `${hours.toString().padStart(2, '0')}:${adjustedMinutes.toString().padStart(2, '0')}`;
    }

    /**
     * Add one hour to a time string
     */
    private addHourToTime(time: string): string {
        const [hours, minutes] = time.split(':').map(Number);
        const newHours = (hours + 1) % 24;
        return `${newHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }



    /**
     * Convert HH:mm time string to minutes since midnight
     */
    private timeToMinutes(time: string): number {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    }

    /**
     * Format duration in minutes to "Xh Ym" string
     */
    private formatDurationMinutes(minutes: number): string {
        if (minutes < 0) return '0m';
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        if (h === 0) return `${m}m`;
        if (m === 0) return `${h}h`;
        return `${h}h ${m}m`;
    }

    /**
     * Calculate duration from current start/end date+time values
     */
    private calculateDurationFromDates(): string {
        const start = new Date(`${this.startDateValue}T${this.startTimeValue}`);
        const end = new Date(`${this.endDateValue}T${this.endTimeValue}`);
        const diffMs = end.getTime() - start.getTime();
        const diffMins = Math.round(diffMs / 60000);
        return this.formatDurationMinutes(diffMins);
    }

    /**
     * Recalculate and update duration display when dates/times change
     */
    private recalculateDuration(updateDurationInput = true): void {
        const start = new Date(`${this.startDateValue}T${this.startTimeValue}`);
        const end = new Date(`${this.endDateValue}T${this.endTimeValue}`);
        const diffMs = end.getTime() - start.getTime();
        const diffMins = Math.round(diffMs / 60000);

        // Track invalid duration state
        this.hasInvalidDuration = !Number.isFinite(diffMins) || diffMins <= 0;

        if (updateDurationInput) {
            this.durationValue = Number.isFinite(diffMins) ? this.formatDurationMinutes(diffMins) : '';
        }
        // eslint-disable-next-line @typescript-eslint/no-misused-promises -- false positive: null check, not promise
        if (this.durationInput) {
            if (updateDurationInput) this.durationInput.setValue(this.durationValue);
            // Add visual error state for invalid duration
            this.durationInput.inputEl.toggleClass('time-input-error', this.hasInvalidDuration);
        }

        // Update save button state
        this.updateSaveButtonState();
    }

    /**
     * Update end date/time based on start + duration
     */
    private updateEndFromDuration(): void {
        const durationMins = this.parseDurationToMinutes(this.durationValue);
        if (durationMins <= 0) return;

        const start = new Date(`${this.startDateValue}T${this.startTimeValue}`);
        if (!Number.isFinite(start.getTime())) return;
        const end = new Date(start.getTime() + durationMins * 60000);

        this.endDateValue = TableParser.getDateString(end);
        this.endTimeValue = `${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`;

        if (this.endDateInput !== null) {
            this.endDateInput.setValue(this.endDateValue);
        }
        if (this.endTimeInput !== null) {
            this.endTimeInput.setValue(this.endTimeValue);
        }
        this.recalculateDuration(false);
        void this.findAdjacentEntries();
    }

    /**
     * Parse duration string to minutes
     * Accepts: "1h 30m", "1h30m", "90m", "1.5h", "1h", "30m"
     */
    private parseDurationToMinutes(duration: string): number {
        const cleaned = duration.toLowerCase().trim();

        // Try "Xh Ym" or "XhYm" format
        const hhmm = cleaned.match(/(\d+)\s*h\s*(\d+)\s*m/);
        if (hhmm) {
            return parseInt(hhmm[1]) * 60 + parseInt(hhmm[2]);
        }

        // Try "Xh" format
        const hOnly = cleaned.match(/^(\d+(?:\.\d+)?)\s*h$/);
        if (hOnly) {
            return Math.round(parseFloat(hOnly[1]) * 60);
        }

        // Try "Xm" format
        const mOnly = cleaned.match(/^(\d+)\s*m$/);
        if (mOnly) {
            return parseInt(mOnly[1]);
        }

        // Try plain number (assume minutes)
        const plain = cleaned.match(/^(\d+)$/);
        if (plain) {
            return parseInt(plain[1]);
        }

        return 0;
    }

    /**
     * Show the create note input UI
     */
    private showCreateNoteInput(contentEl: HTMLElement, linkedNoteInput: TextComponent): void {
        // Create inline input row
        const createNoteRow = contentEl.createDiv('create-note-row');

        const maxLength = 80;
        const defaultName = `${this.startDateValue}-`;

        // Full filename input (user can edit everything including date)
        const nameInput = createNoteRow.createEl('input', {
            type: 'text',
            placeholder: 'note-name',
            cls: 'create-note-slug',
            value: defaultName,
        });
        nameInput.maxLength = maxLength;

        // Character counter
        const counterSpan = createNoteRow.createSpan('create-note-counter');
        counterSpan.setText(`${defaultName.length}/${maxLength}`);

        nameInput.addEventListener('input', () => {
            // Sanitize: only allow lowercase, numbers, hyphens
            const cursorPos = nameInput.selectionStart || 0;
            nameInput.value = nameInput.value
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, '-')
                .replace(/-+/g, '-');
            nameInput.selectionStart = nameInput.selectionEnd = Math.min(cursorPos, nameInput.value.length);
            counterSpan.setText(`${nameInput.value.length}/${maxLength}`);
        });

        // Create button
        const createBtn = createNoteRow.createEl('button', {
            text: 'Create',
            cls: 'mod-cta',
        });

        // Cancel button
        const cancelBtn = createNoteRow.createEl('button', {
            text: 'Cancel',
        });

        createBtn.addEventListener('click', () => {
            const noteName = nameInput.value.trim().replace(/^-+|-+$/g, '');
            if (!noteName) {
                new Notice('Please enter a note name');
                return;
            }

            void this.createLinkedNote(noteName).then((notePath) => {
                linkedNoteInput.setValue(notePath);
                this.linkedNoteValue = notePath;
                createNoteRow.remove();
                new Notice('Note created!');
            }).catch((err: Error) => {
                new Notice(`Failed to create note: ${err.message}`);
            });
        });

        cancelBtn.addEventListener('click', () => {
            createNoteRow.remove();
        });

        // Focus the input and position cursor at end
        nameInput.focus();
        nameInput.selectionStart = nameInput.selectionEnd = nameInput.value.length;
    }

    /**
     * Create a linked note in the Notes subfolder
     */
    private async createLinkedNote(slug: string): Promise<string> {
        const vault = this.app.vault;
        const notesFolder = `${this.settings.timeTrackingFolder}/Notes`;
        const notePath = `${notesFolder}/${slug}.md`;

        // Ensure Notes subfolder exists
        const folder = vault.getAbstractFileByPath(notesFolder);
        if (!folder) {
            await vault.createFolder(notesFolder);
        }

        // Check if note already exists
        const existing = vault.getAbstractFileByPath(notePath);
        if (existing) {
            throw new Error('Note already exists');
        }

        // Create note with template content
        const content = this.generateNoteTemplate(slug);
        await vault.create(notePath, content);

        // Return path without .md extension for the linkedNote field
        return `${notesFolder}/${slug}`;
    }

    /**
     * Generate template content for a new linked note
     * Loosely coupled - no properties that would need updating if entry changes
     */
    private generateNoteTemplate(_noteName: string): string {
        const tags = this.fieldValues['tags'];
        if (tags) {
            const tagArr = Array.isArray(tags) ? tags : [tags];
            const validTags = tagArr.map(t => String(t).trim().replace(/^#/, '')).filter(Boolean);
            if (validTags.length > 0) {
                return `---\ntags:\n${validTags.map(t => `  - ${t}`).join('\n')}\n---\n\n`;
            }
        }
        return '';
    }



    /**
     * Validate overlap with existing entries and update UI
     * Uses request ID to prevent race conditions from concurrent async calls
     */
    private async validateOverlap(): Promise<void> {
        // Increment and capture request ID to handle race conditions
        const requestId = ++this.validationRequestId;

        // Read directly from inputs to ensure we validate what the user sees
        const startDate = this.startDateInput !== null ? this.startDateInput.getValue() : this.startDateValue;
        const startTime = this.startTimeInput !== null ? this.startTimeInput.getValue() : this.startTimeValue;
        const endDate = this.endDateInput !== null ? this.endDateInput.getValue() : this.endDateValue;
        const endTime = this.endTimeInput !== null ? this.endTimeInput.getValue() : this.endTimeValue;

        // Build datetime from current values
        const startDateTime = new Date(`${startDate}T${startTime}`);
        const endDateTime = new Date(`${endDate}T${endTime}`);

        // Check for invalid dates
        if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
            Logger.log('EntryModal: Invalid dates, skipping overlap check');
            // Only update if this is still the latest request
            if (requestId !== this.validationRequestId) return;
            this.startOverlap = null;
            this.endOverlap = null;
            this.encompassedEntry = null;
            this.updateOverlapUI();
            return;
        }

        Logger.log('EntryModal: Checking conflicts for', {
            start: startDateTime.toISOString(),
            end: endDateTime.toISOString(),
            requestId
        });

        // Check for overlaps (exclude self in edit mode)
        const excludeEntry = this.data.mode === 'edit' ? this.data.entry : undefined;

        // Find all overlaps classified by type
        const result = await this.dataManager.findOverlaps(startDateTime, endDateTime, excludeEntry);

        // Race condition guard: only apply results if this is still the latest request
        if (requestId !== this.validationRequestId) {
            Logger.log('EntryModal: Discarding stale validation result', { requestId, currentId: this.validationRequestId });
            return;
        }

        this.startOverlap = result.startOverlap;
        this.endOverlap = result.endOverlap;
        this.encompassedEntry = result.encompassedEntry;

        Logger.log('EntryModal: startOverlap =', this.startOverlap
            ? `${this.startOverlap.start} - ${this.startOverlap.end}` : 'null');
        Logger.log('EntryModal: endOverlap =', this.endOverlap
            ? `${this.endOverlap.start} - ${this.endOverlap.end}` : 'null');
        Logger.log('EntryModal: encompassedEntry =', this.encompassedEntry
            ? `${this.encompassedEntry.start} - ${this.encompassedEntry.end}` : 'null');

        this.updateOverlapUI();
    }

    /**
     * Update UI based on overlap state
     */
    private updateOverlapUI(): void {
        const hasStartOverlap = this.startOverlap !== null;
        const hasEndOverlap = this.endOverlap !== null;
        const hasEncompassed = this.encompassedEntry !== null;
        const hasAnyConflict = hasStartOverlap || hasEndOverlap || hasEncompassed;
        const durationWarning = !this.startTimeValue || !this.endTimeValue || !this.startDateValue || !this.endDateValue
            ? 'Enter a valid start and end date/time'
            : 'End time must be after start time';

        // Red border on start inputs if start is inside an entry
        if (this.startDateInput?.inputEl) {
            this.startDateInput.inputEl.toggleClass('time-input-error', hasStartOverlap);
        }
        if (this.startTimeInput?.inputEl) {
            this.startTimeInput.inputEl.toggleClass('time-input-error', hasStartOverlap);
        }

        // Red border on end inputs if end is inside an entry
        if (this.endDateInput?.inputEl) {
            this.endDateInput.inputEl.toggleClass('time-input-error', hasEndOverlap);
        }
        if (this.endTimeInput?.inputEl) {
            this.endTimeInput.inputEl.toggleClass('time-input-error', hasEndOverlap);
        }

        // Update warning banner
        if (this.warningBanner) {
            if (hasAnyConflict) {
                this.warningBanner.removeClass('is-hidden');
                this.warningBanner.empty();

                const icon = this.warningBanner.createSpan('overlap-warning-icon');
                icon.setText('⚠️');

                const textContainer = this.warningBanner.createDiv('overlap-warning-messages');

                // Show start overlap (START is inside this entry)
                if (hasStartOverlap) {
                    const entry = this.startOverlap;
                    const entryLabel = this.formatEntryLabel(entry);
                    const msg = textContainer.createDiv('overlap-message');
                    msg.setText(`Start overlaps with ${entryLabel} (${entry.start} – ${entry.end})`);
                }

                // Show end overlap (END is inside this entry)
                if (hasEndOverlap) {
                    const entry = this.endOverlap;
                    const entryLabel = this.formatEntryLabel(entry);
                    const msg = textContainer.createDiv('overlap-message');
                    msg.setText(`End overlaps with ${entryLabel} (${entry.start} – ${entry.end})`);
                }

                // Show encompassed entry (we fully contain this entry)
                if (hasEncompassed) {
                    const entry = this.encompassedEntry;
                    const entryLabel = this.formatEntryLabel(entry);
                    const msg = textContainer.createDiv('overlap-message');
                    msg.setText(`Conflicts with ${entryLabel} (${entry.start} – ${entry.end})`);
                }

                // Show invalid duration warning
                if (this.hasInvalidDuration) {
                    const msg = textContainer.createDiv('overlap-message');
                    msg.setText(durationWarning);
                }
            } else if (this.hasInvalidDuration) {
                // Show only duration warning
                this.warningBanner.removeClass('is-hidden');
                this.warningBanner.empty();

                const icon = this.warningBanner.createSpan('overlap-warning-icon');
                icon.setText('⚠️');

                const textContainer = this.warningBanner.createDiv('overlap-warning-messages');
                const msg = textContainer.createDiv('overlap-message');
                msg.setText(durationWarning);
            } else {
                this.warningBanner.addClass('is-hidden');
            }
        }

        // Update save button state
        this.updateSaveButtonState();
    }

    /**
     * Update save button enabled/disabled state based on all validation
     */
    private updateSaveButtonState(): void {
        const hasAnyConflict = this.startOverlap !== null ||
            this.endOverlap !== null ||
            this.encompassedEntry !== null;
        const hasInvalidTime = (this.startTimeInput !== null && !this.startTimeInput.getValue()) ||
            (this.endTimeInput !== null && !this.endTimeInput.getValue());
        const cannotSave = hasAnyConflict || this.hasInvalidDuration || hasInvalidTime;

        if (this.saveButton) {
            this.saveButton.disabled = cannotSave;
            this.saveButton.toggleClass('is-disabled', cannotSave);
        }
    }



    /**
     * Format entry label as CATEGORY > ACTIVITY_NAME
     */
    private formatEntryLabel(entry: TimeEntry): string {
        const parts: string[] = [];

        const category = entry.fields?.['category'] || entry.activity;
        if (category) {
            parts.push(Array.isArray(category) ? category.join(', ') : String(category));
        }

        const title = entry.description || entry.fields?.['activity_name'];
        if (title && title !== category) {
            parts.push(Array.isArray(title) ? title.join(', ') : String(title));
        }

        return parts.length > 0 ? parts.join(' > ') : 'Activity';
    }
    /**
     * Check if two entries are same (helper for filtering)
     */
    private isSameEntry(a: TimeEntry, b: TimeEntry): boolean {
        return (
            a.startDateTime.getTime() === b.startDateTime.getTime() &&
            a.endDateTime.getTime() === b.endDateTime.getTime() &&
            a.description === b.description
        );
    }

    /**
     * Find adjacent entries (previous ending before start, next starting after end)
     */
    private async findAdjacentEntries(): Promise<void> {
        const startDateTime = new Date(`${this.startDateValue}T${this.startTimeValue}`);
        const endDateTime = new Date(`${this.endDateValue}T${this.endTimeValue}`);

        if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
            this.previousEntry = null;
            this.nextEntry = null;
            this.updateMagnetButtons();
            return;
        }

        const excludeEntry = this.data.mode === 'edit' ? this.data.entry : undefined;
        const { previous, next } = await this.dataManager.findAdjacentEntries(startDateTime, endDateTime, excludeEntry);

        this.previousEntry = previous;
        this.nextEntry = next;
        this.updateMagnetButtons();
    }

    /**
     * Update magnet button visibility and tooltips
     */
    private updateMagnetButtons(): void {
        // Start magnet - snaps to end of previous entry
        if (this.startSnapHint) {
            if (this.previousEntry) {
                this.startSnapHint.removeClass('is-hidden');
                const prevEnd = this.previousEntry.end;
                const prevLabel = this.formatEntryLabel(this.previousEntry);
                this.startSnapHint.setAttribute('aria-label', `Snap to ${prevEnd} (end of ${prevLabel})`);
            } else {
                this.startSnapHint.addClass('is-hidden');
            }
        }

        // End magnet - snaps to start of next entry
        if (this.endSnapHint) {
            if (this.nextEntry) {
                this.endSnapHint.removeClass('is-hidden');
                const nextStart = this.nextEntry.start;
                const nextLabel = this.formatEntryLabel(this.nextEntry);
                this.endSnapHint.setAttribute('aria-label', `Snap to ${nextStart} (start of ${nextLabel})`);
            } else {
                this.endSnapHint.addClass('is-hidden');
            }
        }
    }

    /**
     * Snap start time to end of previous entry
     */
    private snapStartToPrevious(): void {
        if (!this.previousEntry) return;

        // Use the previous entry's end date/time
        this.startDateValue = TableParser.getDateString(this.previousEntry.endDateTime);
        this.startTimeValue = this.previousEntry.end;

        if (this.startDateInput !== null) {
            this.startDateInput.setValue(this.startDateValue);
        }
        if (this.startTimeInput !== null) {
            this.startTimeInput.setValue(this.startTimeValue);
        }

        this.recalculateDuration();
        void this.validateOverlap();
        void this.findAdjacentEntries();
    }

    /**
     * Snap end time to start of next entry
     */
    private snapEndToNext(): void {
        if (!this.nextEntry) return;

        // Use the next entry's start date/time
        this.endDateValue = TableParser.getDateString(this.nextEntry.startDateTime);
        this.endTimeValue = this.nextEntry.start;

        if (this.endDateInput !== null) {
            this.endDateInput.setValue(this.endDateValue);
        }
        if (this.endTimeInput !== null) {
            this.endTimeInput.setValue(this.endTimeValue);
        }

        this.recalculateDuration();
        void this.validateOverlap();
        void this.findAdjacentEntries();
    }
}

/**
 * Modal for selecting an existing note via fuzzy search
 */
class NoteSuggestModal extends FuzzySuggestModal<TFile> {
    private onSelect: (file: TFile) => void;

    constructor(app: App, onSelect: (file: TFile) => void) {
        super(app);
        this.onSelect = onSelect;
        this.setPlaceholder('Search for a note...');
    }

    getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles();
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile, _evt: MouseEvent | KeyboardEvent): void {
        this.onSelect(file);
    }
}

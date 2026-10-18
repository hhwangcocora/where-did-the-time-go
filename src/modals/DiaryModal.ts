import { App, Modal, Setting, TextAreaComponent } from 'obsidian';
import { DataManager } from '../data/DataManager';
import { DailyDiary } from '../types';
import { Logger } from '../utils/Logger';

/**
 * Modal to view and edit free-text daily diary reflections
 */
export class DiaryModal extends Modal {
    private dataManager: DataManager;
    private dateStr: string;
    private onSave?: () => void;
    private contentValue: string = '';
    private existingDiary: DailyDiary | null = null;
    private textAreaComponent: TextAreaComponent | null = null;

    constructor(
        app: App,
        dataManager: DataManager,
        dateStr: string,
        onSave?: () => void
    ) {
        super(app);
        this.dataManager = dataManager;
        this.dateStr = dateStr;
        this.onSave = onSave;
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('time-tracker-diary-modal');

        // Load existing diary
        try {
            this.existingDiary = await this.dataManager.getDiary(this.dateStr);
            if (this.existingDiary) {
                this.contentValue = this.existingDiary.content;
            }
        } catch (err) {
            Logger.error('DiaryModal: Error loading diary for date:', this.dateStr, err);
        }

        // Title
        contentEl.createEl('h2', { text: `Daily Diary - ${this.dateStr}` });

        // Subtitle / helper hint
        const hintEl = contentEl.createEl('p', {
            text: 'Free-text journal and reflection for this day. Saved to your monthly file under Daily Diaries.',
            cls: 'setting-item-description'
        });
        hintEl.style.marginBottom = '12px';

        // Editor area
        const setting = new Setting(contentEl);
        setting.settingEl.style.border = 'none';
        setting.settingEl.style.padding = '0';
        setting.infoEl.remove();

        const counterEl = contentEl.createDiv({ cls: 'diary-word-counter setting-item-description' });
        counterEl.style.textAlign = 'right';
        counterEl.style.marginBottom = '8px';

        const updateCounter = (text: string) => {
            const trimmed = text.trim();
            const words = trimmed ? trimmed.split(/\s+/).length : 0;
            const chars = text.length;
            counterEl.setText(`${words} word${words === 1 ? '' : 's'} · ${chars} char${chars === 1 ? '' : 's'}`);
        };

        setting.addTextArea((text) => {
            this.textAreaComponent = text;
            text.setValue(this.contentValue);
            text.setPlaceholder('How did your day go? What did you accomplish? Any reflections or takeaways?');
            text.inputEl.rows = 12;
            text.inputEl.style.width = '100%';
            text.inputEl.style.fontFamily = 'var(--font-text)';
            text.inputEl.style.resize = 'vertical';

            text.onChange((value) => {
                this.contentValue = value;
                updateCounter(value);
            });

            // Cmd/Ctrl+Enter to save
            text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    void this.handleSave();
                }
            });
        });

        updateCounter(this.contentValue);

        // Buttons
        const buttonRow = contentEl.createDiv('modal-button-row');
        buttonRow.style.marginTop = '16px';
        buttonRow.style.display = 'flex';
        buttonRow.style.alignItems = 'center';

        if (this.existingDiary) {
            const deleteBtn = buttonRow.createEl('button', {
                text: 'Delete',
                cls: 'mod-warning',
            });
            deleteBtn.addEventListener('click', () => {
                void this.handleDelete();
            });
        }

        const spacer = buttonRow.createDiv('button-spacer');
        spacer.style.flex = '1';

        const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        const saveBtn = buttonRow.createEl('button', {
            text: 'Save Diary',
            cls: 'mod-cta',
        });
        saveBtn.style.marginLeft = '8px';
        saveBtn.addEventListener('click', () => {
            void this.handleSave();
        });

        // Focus text area
        setTimeout(() => {
            this.textAreaComponent?.inputEl.focus();
        }, 50);
    }

    private async handleSave(): Promise<void> {
        const trimmed = this.contentValue.trim();
        if (!trimmed) {
            // If empty, delete existing if any, or simply close
            if (this.existingDiary) {
                await this.dataManager.deleteDiary(this.dateStr);
            }
            this.onSave?.();
            this.close();
            return;
        }

        try {
            await this.dataManager.saveDiary({
                date: this.dateStr,
                content: trimmed,
            });
            this.onSave?.();
            this.close();
        } catch (err) {
            Logger.error('DiaryModal: Failed to save diary:', err);
        }
    }

    private async handleDelete(): Promise<void> {
        try {
            await this.dataManager.deleteDiary(this.dateStr);
            this.onSave?.();
            this.close();
        } catch (err) {
            Logger.error('DiaryModal: Failed to delete diary:', err);
        }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

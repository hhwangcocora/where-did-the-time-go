// Mock for Obsidian API - only what we need for testing

export function setupDomPrototypes(): void {
    if (typeof HTMLElement !== 'undefined') {
        const proto = HTMLElement.prototype as any;
        if (!proto.createEl) {
            proto.createEl = function (tag: string, o?: any) {
                const el = document.createElement(tag);
                if (o?.cls) el.className = o.cls;
                if (o?.text) el.textContent = o.text;
                if (o?.type && 'type' in el) el.type = o.type;
                if (o?.value && 'value' in el) el.value = o.value;
                this.appendChild(el);
                return el;
            };
        }
        if (!proto.createDiv) {
            proto.createDiv = function (o?: any) {
                return this.createEl('div', typeof o === 'string' ? { cls: o } : o);
            };
        }
        if (!proto.createSpan) {
            proto.createSpan = function (o?: any) {
                return this.createEl('span', typeof o === 'string' ? { cls: o } : o);
            };
        }
        if (!proto.setText) {
            proto.setText = function (t: string) {
                this.textContent = t;
            };
        }
        if (!proto.empty) {
            proto.empty = function () {
                while (this.firstChild) this.removeChild(this.firstChild);
            };
        }
        if (!proto.addClass) {
            proto.addClass = function (...cls: string[]) {
                this.classList.add(...cls);
            };
        }
        if (!proto.removeClass) {
            proto.removeClass = function (...cls: string[]) {
                this.classList.remove(...cls);
            };
        }
        if (!proto.toggleClass) {
            proto.toggleClass = function (cls: string | string[], val?: boolean) {
                const arr = Array.isArray(cls) ? cls : [cls];
                for (const c of arr) this.classList.toggle(c, val);
            };
        }
    }
}

setupDomPrototypes();

export class Modal {
    contentEl: HTMLElement;
    constructor(..._args: unknown[]) {
        this.contentEl = (typeof document !== 'undefined' ? document.createElement('div') : {}) as HTMLElement;
    }
    open(): void {}
    close(): void {}
}

export class FuzzySuggestModal<T> extends Modal {
    setPlaceholder(_p: string): void {}
}

export abstract class AbstractInputSuggest<T> {
    app: any;
    textInputEl: HTMLInputElement | HTMLDivElement;
    protected limit = 100;

    constructor(app: any, textInputEl: HTMLInputElement | HTMLDivElement) {
        this.app = app;
        this.textInputEl = textInputEl;
    }

    setValue(value: string): void {
        if ('value' in this.textInputEl) {
            this.textInputEl.value = value;
        }
    }

    getValue(): string {
        return ('value' in this.textInputEl) ? this.textInputEl.value : '';
    }

    protected abstract getSuggestions(query: string): T[] | Promise<T[]>;
    abstract renderSuggestion(value: T, el: HTMLElement): void;
    abstract selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void;
    close(): void {}
    open(): void {}
}

export class TextComponent {
    inputEl: HTMLInputElement;
    private changeListeners: ((v: string) => void)[] = [];

    constructor(containerEl?: HTMLElement) {
        this.inputEl = (typeof document !== 'undefined' ? document.createElement('input') : {}) as HTMLInputElement;
        if (containerEl && typeof containerEl.appendChild === 'function') {
            containerEl.appendChild(this.inputEl);
        }
    }
    setValue(v: string): this {
        this.inputEl.value = v;
        for (const l of this.changeListeners) l(v);
        return this;
    }
    getValue(): string { return this.inputEl.value || ''; }
    setPlaceholder(p: string): this { this.inputEl.placeholder = p; return this; }
    onChange(cb: (v: string) => any): this {
        this.changeListeners.push(cb);
        return this;
    }
}

export class TextAreaComponent {
    inputEl: HTMLTextAreaElement;
    private changeListeners: ((v: string) => void)[] = [];

    constructor(containerEl?: HTMLElement) {
        this.inputEl = (typeof document !== 'undefined' ? document.createElement('textarea') : {}) as HTMLTextAreaElement;
        if (containerEl && typeof containerEl.appendChild === 'function') {
            containerEl.appendChild(this.inputEl);
        }
    }
    setValue(v: string): this {
        this.inputEl.value = v;
        for (const l of this.changeListeners) l(v);
        return this;
    }
    getValue(): string { return this.inputEl.value || ''; }
    setPlaceholder(p: string): this { this.inputEl.placeholder = p; return this; }
    onChange(cb: (v: string) => any): this {
        this.changeListeners.push(cb);
        return this;
    }
}

export class DropdownComponent {
    selectEl: HTMLSelectElement;
    private changeListeners: ((v: string) => void)[] = [];

    constructor(containerEl?: HTMLElement) {
        this.selectEl = (typeof document !== 'undefined' ? document.createElement('select') : {}) as HTMLSelectElement;
        if (typeof document !== 'undefined') {
            this.selectEl.className = 'dropdown';
            this.selectEl.addEventListener('change', () => {
                for (const l of this.changeListeners) l(this.selectEl.value);
            });
        }
        if (containerEl && typeof containerEl.appendChild === 'function') {
            containerEl.appendChild(this.selectEl);
        }
    }
    addOption(val: string, display: string): this {
        if (typeof document !== 'undefined') {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = display;
            this.selectEl.appendChild(opt);
        }
        return this;
    }
    setValue(v: string): this {
        this.selectEl.value = v;
        for (const l of this.changeListeners) l(v);
        return this;
    }
    getValue(): string { return this.selectEl.value || ''; }
    onChange(cb: (v: string) => any): this {
        this.changeListeners.push(cb);
        return this;
    }
}

export class Setting {
    settingEl: HTMLElement;
    infoEl: HTMLElement;
    nameEl: HTMLElement;
    descEl: HTMLElement;
    controlEl: HTMLElement;

    constructor(containerEl?: HTMLElement) {
        const create = (tag: string) => (typeof document !== 'undefined' ? document.createElement(tag) : {}) as HTMLElement;
        this.settingEl = create('div');
        this.infoEl = create('div');
        this.nameEl = create('div');
        this.descEl = create('div');
        this.controlEl = create('div');
        this.settingEl.appendChild?.(this.infoEl);
        this.infoEl.appendChild?.(this.nameEl);
        this.infoEl.appendChild?.(this.descEl);
        this.settingEl.appendChild?.(this.controlEl);
        if (containerEl && typeof containerEl.appendChild === 'function') {
            containerEl.appendChild(this.settingEl);
        }
    }

    setName(name: string): this {
        if (this.nameEl) this.nameEl.textContent = name;
        return this;
    }
    setDesc(desc: string): this {
        if (this.descEl) this.descEl.textContent = desc;
        return this;
    }
    addText(cb: (text: TextComponent) => any): this {
        cb(new TextComponent(this.controlEl));
        return this;
    }
    addTextArea(cb: (text: TextAreaComponent) => any): this {
        cb(new TextAreaComponent(this.controlEl));
        return this;
    }
    addDropdown(cb: (dropdown: DropdownComponent) => any): this {
        cb(new DropdownComponent(this.controlEl));
        return this;
    }
    addButton(cb: (btn: any) => any): this {
        const btnEl = typeof document !== 'undefined' ? document.createElement('button') : {};
        if (this.controlEl && typeof this.controlEl.appendChild === 'function') {
            this.controlEl.appendChild(btnEl as HTMLElement);
        }
        const btnObj = {
            setButtonText: (t: string) => { (btnEl as any).textContent = t; return btnObj; },
            setTooltip: (_t: string) => btnObj,
            onClick: (fn: Function) => {
                if (typeof (btnEl as any).addEventListener === 'function') {
                    (btnEl as any).addEventListener('click', fn);
                }
                return btnObj;
            },
        };
        cb(btnObj);
        return this;
    }
}

export class Notice {
    constructor(message: string) {}
}

export class TFile {
    path: string = '';
    name: string = '';
    basename: string = '';
    extension: string = 'md';
}

export class TFolder {
    path: string = '';
    name: string = '';
}

export class DataAdapter {
    private files: Map<string, string> = new Map();
    private folders: Set<string> = new Set();

    setMockStore(files: Map<string, string>, folders: Set<string>): void {
        this.files = files;
        this.folders = folders;
    }

    async exists(path: string): Promise<boolean> {
        return this.files.has(path) || this.folders.has(path);
    }
    async read(path: string): Promise<string> {
        const content = this.files.get(path);
        if (content === undefined) throw new Error(`File not found: ${path}`);
        return content;
    }
    async write(path: string, data: string): Promise<void> {}
}

export class Vault {
    adapter: DataAdapter = new DataAdapter();

    async read(file: TFile): Promise<string> {
        return '';
    }

    async modify(file: TFile, content: string): Promise<void> {}

    async create(path: string, content: string): Promise<TFile> {
        return new TFile();
    }

    async createFolder(path: string): Promise<TFolder> {
        return new TFolder();
    }

    getAbstractFileByPath(path: string): TFile | TFolder | null {
        return null;
    }

    getMarkdownFiles(): TFile[] {
        return [];
    }
}

export class App {
    vault: Vault = new Vault();
    workspace: any = {};
}

export class WorkspaceLeaf {
    view: any;
}

export class ItemView {
    containerEl: HTMLElement;
    app: App;
    leaf: WorkspaceLeaf;

    constructor(leaf: WorkspaceLeaf) {
        this.leaf = leaf;
        this.app = new App();
        this.containerEl = (typeof document !== 'undefined' ? document.createElement('div') : {}) as HTMLElement;
        if (typeof document !== 'undefined' && this.containerEl.appendChild) {
            this.containerEl.appendChild(document.createElement('div'));
            this.containerEl.appendChild(document.createElement('div'));
        }
    }

    getViewType(): string { return ''; }
    getDisplayText(): string { return ''; }
    onOpen(): Promise<void> { return Promise.resolve(); }
    onClose(): Promise<void> { return Promise.resolve(); }
}

export function setIcon(el: HTMLElement, iconName: string): void {
    if (el && typeof el.setAttribute === 'function') {
        el.setAttribute('data-icon', iconName);
    }
}


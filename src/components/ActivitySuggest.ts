import { App, AbstractInputSuggest } from 'obsidian';

/**
 * Autocomplete suggester for activity names based on schema predefined activities
 */
export class ActivitySuggest extends AbstractInputSuggest<string> {
    private inputEl: HTMLInputElement;
    private getCandidates: () => string[];
    private getAllCandidates?: () => string[];
    private onSelectCallback: (val: string) => void;

    constructor(
        app: App,
        inputEl: HTMLInputElement,
        getCandidates: () => string[],
        onSelectCallback: (val: string) => void,
        getAllCandidates?: () => string[]
    ) {
        super(app, inputEl);
        this.inputEl = inputEl;
        this.getCandidates = getCandidates;
        this.onSelectCallback = onSelectCallback;
        this.getAllCandidates = getAllCandidates;
    }

    private filterCandidates(items: string[], lower: string): string[] {
        const prefix: string[] = [];
        const contains: string[] = [];
        for (const item of items) {
            const itemLower = item.toLowerCase();
            if (itemLower.startsWith(lower)) {
                prefix.push(item);
            } else if (itemLower.includes(lower)) {
                contains.push(item);
            }
        }
        return [...prefix, ...contains];
    }

    getSuggestions(query: string): string[] {
        const candidates = this.getCandidates();
        const lower = (query || '').toLowerCase().trim();

        if (!lower) {
            return candidates;
        }

        // First filter by candidates for the current category
        const matches = this.filterCandidates(candidates, lower);
        if (matches.length > 0) {
            return matches;
        }

        // If no matches for the selected category, check across all categories if available
        if (this.getAllCandidates) {
            const allCandidates = this.getAllCandidates();
            const allMatches = this.filterCandidates(allCandidates, lower);
            if (allMatches.length > 0) {
                return allMatches;
            }
        }

        return [];
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        el.setText(value);
    }

    selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
        this.setValue(value);
        if (this.inputEl) {
            this.inputEl.value = value;
            const EventClass = this.inputEl.ownerDocument?.defaultView?.Event || Event;
            this.inputEl.dispatchEvent(new EventClass('input', { bubbles: true }));
        }
        this.onSelectCallback(value);
        this.close();
    }
}

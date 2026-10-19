import { App, AbstractInputSuggest } from 'obsidian';

/**
 * Autocomplete suggester for activity names based on schema predefined activities
 */
export class ActivitySuggest extends AbstractInputSuggest<string> {
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
        this.getCandidates = getCandidates;
        this.onSelectCallback = onSelectCallback;
        this.getAllCandidates = getAllCandidates;
    }

    getSuggestions(query: string): string[] {
        const candidates = this.getCandidates();
        const lower = (query || '').toLowerCase().trim();

        if (!lower) {
            return candidates;
        }

        // First filter by candidates for the current category
        const matches = candidates.filter(item => item.toLowerCase().includes(lower));
        if (matches.length > 0) {
            return matches;
        }

        // If no matches for the selected category, check across all categories if available
        if (this.getAllCandidates) {
            const allCandidates = this.getAllCandidates();
            const allMatches = allCandidates.filter(item => item.toLowerCase().includes(lower));
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
        this.onSelectCallback(value);
        this.close();
    }
}

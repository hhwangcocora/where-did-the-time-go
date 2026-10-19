import { jest } from '@jest/globals';
import { JSDOM } from 'jsdom';
import { App } from 'obsidian';
import { setupDomPrototypes } from './__mocks__/obsidian';
import { ActivitySuggest } from '../src/components/ActivitySuggest';

describe('ActivitySuggest', () => {
    let dom: JSDOM;
    let inputEl: HTMLInputElement;
    let onSelectMock: jest.Mock<any>;
    let getCandidatesMock: jest.Mock<any>;
    let getAllCandidatesMock: jest.Mock<any>;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body><input id="activity" /></body></html>');
        (global as any).window = dom.window;
        (global as any).document = dom.window.document;
        (global as any).HTMLElement = dom.window.HTMLElement;
        (global as any).Event = dom.window.Event;
        setupDomPrototypes();

        inputEl = dom.window.document.getElementById('activity') as HTMLInputElement;
        onSelectMock = jest.fn();
        getCandidatesMock = jest.fn().mockReturnValue(['Coding', 'Code Review', 'System Design']);
        getAllCandidatesMock = jest.fn().mockReturnValue([
            'Coding',
            'Code Review',
            'System Design',
            'Running',
            'Weightlifting',
            'Cooking',
        ]);
    });

    test('returns all category candidates when query is empty', () => {
        const suggest = new ActivitySuggest(
            {} as App,
            inputEl,
            getCandidatesMock,
            onSelectMock,
            getAllCandidatesMock
        );

        const results = suggest.getSuggestions('');
        expect(results).toEqual(['Coding', 'Code Review', 'System Design']);
    });

    test('filters candidates case-insensitively with partial match', () => {
        const suggest = new ActivitySuggest(
            {} as App,
            inputEl,
            getCandidatesMock,
            onSelectMock,
            getAllCandidatesMock
        );

        const results = suggest.getSuggestions('cod');
        expect(results).toEqual(['Coding', 'Code Review']);
    });

    test('prioritizes prefix matches over contains matches (e.g. "C" shows Coding and Code Review before Architecture)', () => {
        getCandidatesMock.mockReturnValue(['Architecture', 'Coding', 'Code Review']);
        const suggest = new ActivitySuggest(
            {} as App,
            inputEl,
            getCandidatesMock,
            onSelectMock,
            getAllCandidatesMock
        );

        const results = suggest.getSuggestions('c');
        expect(results).toEqual(['Coding', 'Code Review', 'Architecture']);
    });

    test('falls back to all candidates when category candidates do not match', () => {
        const suggest = new ActivitySuggest(
            {} as App,
            inputEl,
            getCandidatesMock,
            onSelectMock,
            getAllCandidatesMock
        );

        const results = suggest.getSuggestions('run');
        expect(results).toEqual(['Running']);
    });

    test('falls back to all candidates when category has no presets configured', () => {
        getCandidatesMock.mockReturnValue([]);
        const suggest = new ActivitySuggest(
            {} as App,
            inputEl,
            getCandidatesMock,
            onSelectMock,
            getAllCandidatesMock
        );

        const results = suggest.getSuggestions('weight');
        expect(results).toEqual(['Weightlifting']);
    });

    test('returns empty array when no category or fallback candidates match', () => {
        const suggest = new ActivitySuggest(
            {} as App,
            inputEl,
            getCandidatesMock,
            onSelectMock,
            getAllCandidatesMock
        );

        const results = suggest.getSuggestions('xyz123');
        expect(results).toEqual([]);
    });

    test('handles missing getAllCandidates gracefully', () => {
        const suggest = new ActivitySuggest(
            {} as App,
            inputEl,
            getCandidatesMock,
            onSelectMock
        );

        const results = suggest.getSuggestions('run');
        expect(results).toEqual([]);
    });

    test('renderSuggestion sets text on target element', () => {
        const suggest = new ActivitySuggest(
            {} as App,
            inputEl,
            getCandidatesMock,
            onSelectMock
        );

        const el = dom.window.document.createElement('div');
        suggest.renderSuggestion('System Design', el);
        expect(el.textContent).toBe('System Design');
    });

    test('selectSuggestion updates input value and calls callback', () => {
        const suggest = new ActivitySuggest(
            {} as App,
            inputEl,
            getCandidatesMock,
            onSelectMock
        );

        suggest.selectSuggestion('System Design', {} as MouseEvent);
        expect(inputEl.value).toBe('System Design');
        expect(onSelectMock).toHaveBeenCalledWith('System Design');
    });
});

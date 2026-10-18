import { jest } from '@jest/globals';
import { JSDOM } from 'jsdom';
import { App } from 'obsidian';
import { setupDomPrototypes } from './__mocks__/obsidian';
import { DataManager } from '../src/data/DataManager';
import { DiaryModal } from '../src/modals/DiaryModal';

describe('DiaryModal', () => {
    let dom: JSDOM;
    let dataManager: DataManager;
    let getDiaryMock: jest.Mock<any>;
    let saveDiaryMock: jest.Mock<any>;
    let deleteDiaryMock: jest.Mock<any>;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
        (global as any).window = dom.window;
        (global as any).document = dom.window.document;
        (global as any).HTMLElement = dom.window.HTMLElement;
        setupDomPrototypes();

        getDiaryMock = jest.fn();
        saveDiaryMock = jest.fn();
        deleteDiaryMock = jest.fn();

        dataManager = {
            getDiary: getDiaryMock,
            saveDiary: saveDiaryMock,
            deleteDiary: deleteDiaryMock,
        } as unknown as DataManager;
    });

    it('loads existing diary and displays content', async () => {
        getDiaryMock.mockResolvedValue({
            date: '2025-12-01',
            content: 'Existing reflections for the day.',
        });

        const modal = new DiaryModal({} as App, dataManager, '2025-12-01');
        await modal.onOpen();

        expect(getDiaryMock).toHaveBeenCalledWith('2025-12-01');
        expect(modal['contentValue']).toBe('Existing reflections for the day.');
    });

    it('saves updated diary content on save', async () => {
        getDiaryMock.mockResolvedValue(null);
        saveDiaryMock.mockResolvedValue({
            date: '2025-12-01',
            content: 'Brand new reflections.',
        });

        const onSave = jest.fn();
        const modal = new DiaryModal({} as App, dataManager, '2025-12-01', onSave);
        await modal.onOpen();

        modal['contentValue'] = 'Brand new reflections.';
        await modal['handleSave']();

        expect(saveDiaryMock).toHaveBeenCalledWith({
            date: '2025-12-01',
            content: 'Brand new reflections.',
        });
        expect(onSave).toHaveBeenCalled();
    });

    it('deletes diary when deleting', async () => {
        getDiaryMock.mockResolvedValue({
            date: '2025-12-01',
            content: 'To be removed.',
        });
        deleteDiaryMock.mockResolvedValue(undefined);

        const onSave = jest.fn();
        const modal = new DiaryModal({} as App, dataManager, '2025-12-01', onSave);
        await modal.onOpen();

        await modal['handleDelete']();

        expect(deleteDiaryMock).toHaveBeenCalledWith('2025-12-01');
        expect(onSave).toHaveBeenCalled();
    });
});

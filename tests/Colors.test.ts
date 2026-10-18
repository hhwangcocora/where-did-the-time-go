import { getColorForValue, COLOR_PALETTE } from '../src/utils/colors';

describe('colors utility', () => {
    test('returns consistent color for identical strings', () => {
        const color1 = getColorForValue('Deep Work');
        const color2 = getColorForValue('Deep Work');
        const color3 = getColorForValue('deep work'); // Case-insensitive
        const color4 = getColorForValue('  Deep Work  '); // Trims whitespace

        expect(color1).toBe(color2);
        expect(color1).toBe(color3);
        expect(color1).toBe(color4);
        expect(COLOR_PALETTE).toContain(color1);
    });

    test('returns a color from COLOR_PALETTE for any string', () => {
        const samples = ['Work', 'Fitness', 'Reading', 'Chores', 'Random Value 123'];
        for (const s of samples) {
            const color = getColorForValue(s);
            expect(COLOR_PALETTE).toContain(color);
        }
    });

    test('handles empty or blank string gracefully', () => {
        const color = getColorForValue('');
        expect(color).toBe(COLOR_PALETTE[0]);
    });
});

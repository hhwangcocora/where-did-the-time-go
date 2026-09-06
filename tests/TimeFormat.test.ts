import { formatTimeRange } from '../src/utils/TimeFormat';

describe('timeline time ranges', () => {
    it.each([
        ['07:15', '14:57', '7:15 AM – 2:57 PM'],
        ['00:00', '12:00', '12:00 AM – 12:00 PM'],
        ['11:45', '12:15', '11:45 AM – 12:15 PM'],
        ['23:45', '00:15', '11:45 PM – 12:15 AM'],
        ['09:05', '10:00', '9:05 AM – 10:00 AM'],
        ['19:15', '20:46', '7:15 PM – 8:46 PM'],
    ])('formats %s to %s in either display mode', (start, end, expected) => {
        expect(formatTimeRange(start, end, false)).toBe(expected);
        expect(formatTimeRange(start, end, true)).toBe(`${start} – ${end}`);
    });
});

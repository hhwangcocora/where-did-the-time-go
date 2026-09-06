/** Format stored HH:mm times for display without changing their storage format. */
export function formatTimeRange(start: string, end: string, use24HourFormat: boolean): string {
    const format = (time: string): string => {
        if (use24HourFormat) return time;
        const [hours, minutes] = time.split(':');
        const hour = Number(hours);
        return `${hour % 12 || 12}:${minutes} ${hour < 12 ? 'AM' : 'PM'}`;
    };
    return `${format(start)} – ${format(end)}`;
}

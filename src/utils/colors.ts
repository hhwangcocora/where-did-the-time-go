/**
 * Curated, accessible color palette for dynamic activity tagging and calendar cards.
 */
export const COLOR_PALETTE: readonly string[] = [
    '#4f46e5', // Indigo
    '#059669', // Emerald
    '#d97706', // Amber
    '#dc2626', // Red
    '#8b5cf6', // Violet
    '#0284c7', // Sky
    '#ec4899', // Pink
    '#10b981', // Teal
    '#f97316', // Orange
    '#6366f1', // Blue-violet
    '#14b8a6', // Cyan
    '#84cc16', // Lime
    '#a855f7', // Purple
    '#06b6d4', // Cerulean
    '#e11d48', // Rose
    '#64748b', // Slate
];

/**
 * Deterministically maps any string value to a consistent hex color code from COLOR_PALETTE.
 * Ensures the exact same color is used across sessions, timeline views, and reports.
 */
export function getColorForValue(val: string): string {
    const normalized = (val || '').trim().toLowerCase();
    if (!normalized) {
        return COLOR_PALETTE[0];
    }

    let hash = 5381;
    for (let i = 0; i < normalized.length; i++) {
        hash = ((hash << 5) + hash) + normalized.charCodeAt(i);
        hash |= 0;
    }

    const index = Math.abs(hash) % COLOR_PALETTE.length;
    return COLOR_PALETTE[index];
}

import type {
    TimeEntry,
    TrackingSchemaConfig,
    ReportTreeNode,
    ReportSummaryStats,
    CategoryReportItem,
    CategoryActivityBreakdown,
    CategoryReportSummary,
} from '../types';
import { getColorForValue } from '../utils/colors';

function formatDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Options for calculating report aggregations
 */
export interface ReportAggregationOptions {
    /** Time entries to aggregate */
    entries: TimeEntry[];
    /** Ordered list of dimension field IDs to group by (1 to 3 dimensions) */
    dimensions: string[];
    /** Active tracking schema config */
    schema: TrackingSchemaConfig;
    /** Date range start */
    rangeStart: Date;
    /** Date range end */
    rangeEnd: Date;
    /** Optional custom effective duration calculator (falls back to start/end clamping) */
    getEffectiveDuration?: (entry: TimeEntry, start: Date, end: Date) => number;
}

/**
 * Result of calculating report aggregations
 */
export interface ReportAggregationResult {
    /** Hierarchical tree of aggregated report nodes */
    tree: ReportTreeNode[];
    /** Summary KPIs for the report period */
    stats: ReportSummaryStats;
    /** Actual dimensions used for grouping */
    activeDimensions: string[];
}

/**
 * Extract field value from a time entry for a given dimension ID
 */
export function getEntryFieldValue(entry: TimeEntry, fieldId: string, schema: TrackingSchemaConfig): string {
    const fieldDef = schema.fields.find(
        f => f.id.toLowerCase() === fieldId.toLowerCase() || f.label.toLowerCase() === fieldId.toLowerCase()
    );

    const normalizeSingle = (raw: string): string => {
        const trimmed = raw.trim();
        if (!trimmed) return '';
        if (fieldDef?.options && fieldDef.options.length > 0) {
            const lower = trimmed.toLowerCase();
            const match = fieldDef.options.find(
                opt =>
                    opt.id.toLowerCase() === lower ||
                    opt.label.toLowerCase() === lower ||
                    (opt.aliases && opt.aliases.some(a => a.toLowerCase() === lower))
            );
            if (match) return match.label;
        }
        return trimmed;
    };

    const formatExtracted = (val: unknown): string | null => {
        if (Array.isArray(val)) {
            const items = val
                .filter(v => typeof v === 'string' && v.trim().length > 0)
                .map(v => normalizeSingle(v as string))
                .filter(Boolean);
            return items.length > 0 ? items.join(', ') : null;
        }
        if (typeof val === 'string') {
            const normalized = normalizeSingle(val);
            return normalized.length > 0 ? normalized : null;
        }
        return null;
    };

    // 1. Direct match on entry.fields
    if (entry.fields && entry.fields[fieldId] !== undefined && entry.fields[fieldId] !== null) {
        const formatted = formatExtracted(entry.fields[fieldId]);
        return formatted !== null ? formatted : '(None)';
    }

    // 2. Check schema field definition & aliases if defined
    if (fieldDef) {
        // Check field.id in entry.fields
        if (entry.fields && entry.fields[fieldDef.id] !== undefined && entry.fields[fieldDef.id] !== null) {
            const formatted = formatExtracted(entry.fields[fieldDef.id]);
            if (formatted !== null) return formatted;
        }

        // Check aliases in entry.fields
        if (fieldDef.aliases) {
            for (const alias of fieldDef.aliases) {
                if (entry.fields && entry.fields[alias] !== undefined && entry.fields[alias] !== null) {
                    const formatted = formatExtracted(entry.fields[alias]);
                    if (formatted !== null) return formatted;
                }
            }
        }
    }

    // 3. Check unmapped fields
    if (entry.unmappedFields) {
        if (entry.unmappedFields[fieldId] && entry.unmappedFields[fieldId].trim().length > 0) {
            return normalizeSingle(entry.unmappedFields[fieldId]);
        }
        if (fieldDef?.aliases) {
            for (const alias of fieldDef.aliases) {
                if (entry.unmappedFields[alias] && entry.unmappedFields[alias].trim().length > 0) {
                    return normalizeSingle(entry.unmappedFields[alias]);
                }
            }
        }
    }

    // 4. Fallback to entry object properties (e.g. legacy description, project, activity)
    const anyEntry = entry as unknown as Record<string, unknown>;
    if (typeof anyEntry[fieldId] === 'string' && (anyEntry[fieldId] as string).trim().length > 0) {
        return normalizeSingle(anyEntry[fieldId] as string);
    }

    return '(None)';
}

/**
 * Determine display color for a dimension value
 */
export function getNodeColor(dimensionId: string, value: string, schema: TrackingSchemaConfig): string {
    if (!value || value === '(None)' || value === '(Unspecified)') {
        return '#888888';
    }

    const fieldDef = schema.fields.find(
        f => f.id.toLowerCase() === dimensionId.toLowerCase() || f.label.toLowerCase() === dimensionId.toLowerCase()
    );

    if (fieldDef?.options && fieldDef.options.length > 0) {
        const matchingOption = fieldDef.options.find(
            opt => opt.label.toLowerCase() === value.toLowerCase() || opt.id.toLowerCase() === value.toLowerCase()
        );
        if (matchingOption?.color) {
            return matchingOption.color;
        }
    }

    // Fall back to deterministic color hash
    return getColorForValue(value);
}

/**
 * Default effective duration calculation clamped to [rangeStart, rangeEnd]
 */
export function defaultEffectiveDuration(entry: TimeEntry, rangeStart: Date, rangeEnd: Date): number {
    const startMs = entry.startDateTime.getTime();
    const endMs = entry.endDateTime.getTime();
    const rStartMs = rangeStart.getTime();
    const rEndMs = rangeEnd.getTime();

    if (endMs <= rStartMs || startMs >= rEndMs) {
        return 0;
    }

    const clampedStart = Math.max(startMs, rStartMs);
    const clampedEnd = Math.min(endMs, rEndMs);
    return Math.max(0, Math.round((clampedEnd - clampedStart) / (1000 * 60)));
}

/**
 * Report aggregation engine: calculates hierarchical tree and KPIs
 */
export class ReportAggregator {
    /**
     * Compute multi-level aggregation tree and summary statistics
     */
    static calculateAggregation(options: ReportAggregationOptions): ReportAggregationResult {
        const {
            entries,
            schema,
            rangeStart,
            rangeEnd,
            getEffectiveDuration = defaultEffectiveDuration,
        } = options;

        // 1. Resolve active grouping dimensions (filter empty, max 3)
        let activeDimensions = options.dimensions
            .map(d => (d || '').trim())
            .filter(d => d.length > 0);

        if (activeDimensions.length === 0) {
            activeDimensions = (schema.defaultReportGrouping && schema.defaultReportGrouping.length > 0)
                ? [...schema.defaultReportGrouping]
                : (schema.fields.length > 0 ? [schema.fields[0].id] : ['category']);
        }
        activeDimensions = activeDimensions.slice(0, 3);

        // 2. Filter entries with positive effective duration within the query range
        interface PreparedEntry {
            entry: TimeEntry;
            minutes: number;
        }

        const prepared: PreparedEntry[] = [];
        let totalMinutes = 0;
        const activeDays = new Set<string>();

        for (const entry of entries) {
            const minutes = getEffectiveDuration(entry, rangeStart, rangeEnd);
            if (minutes <= 0) continue;

            prepared.push({ entry, minutes });
            totalMinutes += minutes;

            const dateStr = entry.date || formatDateKey(entry.startDateTime);
            if (dateStr) {
                activeDays.add(dateStr);
            }
        }

        // 3. Recursive tree builder
        const buildLevel = (
            subset: PreparedEntry[],
            dimIndex: number,
            parentPath: string,
            parentMinutes: number
        ): ReportTreeNode[] => {
            if (dimIndex >= activeDimensions.length || subset.length === 0) {
                return [];
            }

            const currentDimId = activeDimensions[dimIndex];
            const groups = new Map<string, { entries: PreparedEntry[]; minutes: number }>();

            for (const item of subset) {
                const val = getEntryFieldValue(item.entry, currentDimId, schema);
                let grp = groups.get(val);
                if (!grp) {
                    grp = { entries: [], minutes: 0 };
                    groups.set(val, grp);
                }
                grp.entries.push(item);
                grp.minutes += item.minutes;
            }

            const nodes: ReportTreeNode[] = [];
            for (const [val, grp] of groups.entries()) {
                const key = parentPath ? `${parentPath} > ${currentDimId}:${val}` : `${currentDimId}:${val}`;
                const color = getNodeColor(currentDimId, val, schema);
                const percentageOfParent = parentMinutes > 0 ? (grp.minutes / parentMinutes) * 100 : 0;
                const percentageOfTotal = totalMinutes > 0 ? (grp.minutes / totalMinutes) * 100 : 0;

                const children = buildLevel(grp.entries, dimIndex + 1, key, grp.minutes);

                nodes.push({
                    key,
                    label: val,
                    dimensionId: currentDimId,
                    color,
                    totalMinutes: grp.minutes,
                    percentageOfParent,
                    percentageOfTotal,
                    depth: dimIndex,
                    children,
                });
            }

            // Sort descending by totalMinutes
            nodes.sort((a, b) => b.totalMinutes - a.totalMinutes);
            return nodes;
        };

        const tree = buildLevel(prepared, 0, '', totalMinutes);

        // 4. Compute KPIs
        const activeDaysCount = activeDays.size;
        const dailyAverageMinutes = activeDaysCount > 0 ? Math.round(totalMinutes / activeDaysCount) : 0;
        const topFocusLabel = tree.length > 0 ? tree[0].label : '(None)';
        const topFocusMinutes = tree.length > 0 ? tree[0].totalMinutes : 0;

        const stats: ReportSummaryStats = {
            totalMinutes,
            dailyAverageMinutes,
            activeDaysCount,
            topFocusLabel,
            topFocusMinutes,
        };

        return {
            tree,
            stats,
            activeDimensions,
        };
    }

    /**
     * Compute time spent on each category and sub-activities for the time range
     */
    static calculateCategoryReport(options: {
        entries: TimeEntry[];
        schema: TrackingSchemaConfig;
        rangeStart: Date;
        rangeEnd: Date;
        getEffectiveDuration?: (entry: TimeEntry, start: Date, end: Date) => number;
    }): CategoryReportSummary {
        const {
            entries,
            schema,
            rangeStart,
            rangeEnd,
            getEffectiveDuration = defaultEffectiveDuration,
        } = options;

        const categoryField = schema.fields.find(f => f.ui?.timelineRole === 'color')
            || schema.fields.find(f => f.id === 'category')
            || schema.fields[0];

        const activityField = schema.fields.find(f => f.ui?.timelineRole === 'title')
            || schema.fields.find(f => f.id === 'activity_name')
            || schema.fields.find(f => f.id !== categoryField?.id);

        const categoryMap = new Map<string, {
            minutes: number;
            entryCount: number;
            activityMap: Map<string, number>;
        }>();

        let totalTrackedMinutes = 0;
        const activeDays = new Set<string>();

        for (const entry of entries) {
            const minutes = getEffectiveDuration(entry, rangeStart, rangeEnd);
            if (minutes <= 0) continue;

            totalTrackedMinutes += minutes;

            const dateStr = entry.date || formatDateKey(entry.startDateTime);
            if (dateStr) {
                activeDays.add(dateStr);
            }

            const catVal = categoryField ? getEntryFieldValue(entry, categoryField.id, schema) : '(Unspecified)';
            const actVal = activityField ? getEntryFieldValue(entry, activityField.id, schema) : '(None)';

            let catData = categoryMap.get(catVal);
            if (!catData) {
                catData = { minutes: 0, entryCount: 0, activityMap: new Map() };
                categoryMap.set(catVal, catData);
            }
            catData.minutes += minutes;
            catData.entryCount += 1;

            if (actVal && actVal !== '(None)') {
                const currentActMins = catData.activityMap.get(actVal) || 0;
                catData.activityMap.set(actVal, currentActMins + minutes);
            }
        }

        const items: CategoryReportItem[] = [];

        for (const [catName, data] of categoryMap.entries()) {
            const color = categoryField ? getNodeColor(categoryField.id, catName, schema) : getColorForValue(catName);
            const percentageOfTime = totalTrackedMinutes > 0 ? (data.minutes / totalTrackedMinutes) * 100 : 0;

            const activities: CategoryActivityBreakdown[] = [];
            for (const [actName, actMins] of data.activityMap.entries()) {
                const percentageOfCategory = data.minutes > 0 ? (actMins / data.minutes) * 100 : 0;
                const actColor = activityField ? getNodeColor(activityField.id, actName, schema) : getColorForValue(actName);
                activities.push({
                    name: actName,
                    totalMinutes: actMins,
                    percentageOfCategory,
                    color: actColor,
                });
            }
            activities.sort((a, b) => b.totalMinutes - a.totalMinutes);

            items.push({
                category: catName,
                color,
                totalMinutes: data.minutes,
                percentageOfTime,
                entryCount: data.entryCount,
                activities,
            });
        }

        items.sort((a, b) => b.totalMinutes - a.totalMinutes);

        return {
            activeDaysCount: activeDays.size,
            categoriesCount: items.length,
            topCategoryName: items.length > 0 ? items[0].category : '(None)',
            topCategoryMinutes: items.length > 0 ? items[0].totalMinutes : 0,
            items,
        };
    }
}

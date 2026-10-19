import { getColorForValue, FIXED_LOCATION_COLOR } from './utils/colors';

/**
 * Core types for Where Did The Time Go plugin
 */

/**
 * A time entry representing a block of tracked time
 */
export interface TimeEntry {
    /** YYYY-MM-DD date from parent heading */
    date: string;
    /** Start time in HH:mm format */
    start: string;
    /** End time in HH:mm format, or HH:mm+1 for next day */
    end: string;
    /** Description text (free text between time and metadata) */
    description: string;
    /** Optional project name */
    project?: string;
    /** Optional activity type (feat, fix, meeting, etc.) */
    activity?: string;
    /** Optional client reference preserved from legacy files */
    client?: string;
    /** Optional wikilink path to linked note */
    linkedNote?: string;

    /** Dynamic values for configured fields (single string or array of strings) */
    fields?: Record<string, string | string[]>;
    /** Preserved unrecognized/legacy columns from older markdown files */
    unmappedFields?: Record<string, string>;

    // Computed at parse time:
    /** Full start datetime */
    startDateTime: Date;
    /** Full end datetime (handles +1 notation) */
    endDateTime: Date;
    /** Line number in the source file for updates/deletes */
    lineNumber: number;
    /** Duration in minutes */
    durationMinutes: number;
}

/**
 * Field data types supported by the configurable schema
 */
export type FieldType = 'string' | 'enum';

/**
 * An option in an enum field
 */
export interface EnumOption {
    /** Unique value slug stored in table */
    id: string;
    /** Human-readable label displayed in UI */
    label: string;
    /** Hex color code for timeline badges, borders, and report charts */
    color?: string;
    /** Historical values used for this option */
    aliases?: string[];
}

/**
 * UI presentation hints for a field
 */
export interface FieldUIPresentation {
    widget?: 'text' | 'textarea' | 'dropdown' | 'tags' | 'note-link' | 'multi-select';
    placeholder?: string;
    /** Role on timeline card: 'title' | 'color' | 'badge' | 'content' | 'hidden' */
    timelineRole?: 'title' | 'color' | 'badge' | 'content' | 'hidden';
}

/**
 * Configuration for a dynamic activity field
 */
export interface FieldDefinition {
    /** Unique identifier matching the Markdown column or key */
    id: string;
    /** Display label shown in modals and report headers */
    label: string;
    /** Data type */
    type: FieldType;
    /** Whether the field must be non-empty to save an entry */
    required: boolean;
    /** Whether the field holds a single value or an array of values */
    multiple: boolean;
    /** Historical names used in older markdown table headers */
    aliases?: string[];
    /** Allowed options for 'enum' fields */
    options?: EnumOption[];
    /** Default value for new entries */
    defaultValue?: string | string[];
    /** UI presentation hints */
    ui?: FieldUIPresentation;
}

/**
 * Configuration schema for personal time tracking
 */
export interface TrackingSchemaConfig {
    version: number;
    /** Ordered list of fields */
    fields: FieldDefinition[];
    /** Default report aggregation hierarchy (1 to 3 field IDs) */
    defaultReportGrouping: string[];
    /** Predefined candidate activity names mapped by category */
    activityPresets?: Record<string, string[]>;
}

/**
 * Default candidate activity presets mapped by category
 */
export const DEFAULT_ACTIVITY_PRESETS: Record<string, string[]> = {
    'Deep Work': ['Coding', 'Architecture', 'Code Review', 'Debugging', 'Writing'],
    'Shallow Work': ['Email', 'Catch-up', 'Admin', 'Status Updates'],
    'Fitness': ['Running', 'Weightlifting', 'Yoga', 'Cycling', 'Walking'],
    'Learning': ['Reading', 'Course', 'Research'],
    'Personal': ['Errand', 'Meal', 'Call'],
    'Leisure': ['Gaming', 'Movies', 'Reading for Fun'],
    'Work': ['Planning', 'Meeting', '1:1', 'Sync'],
};

/**
 * Free-text daily reflection or journal entry
 */
export interface DailyDiary {
    /** Target date: YYYY-MM-DD */
    date: string;
    /** Markdown / free-text content */
    content: string;
    /** Optional last modified timestamp */
    updatedAt?: string;
}

/**
 * Complete parsed representation of a monthly file
 */
export interface MonthlyData {
    month: string; // YYYY-MM
    entries: TimeEntry[];
    entriesByDate: Map<string, TimeEntry[]>;
    diariesByDate: Map<string, DailyDiary>;
    aiSummary?: string;
}

/**
 * Default Markdown template used for Schema.md
 */
export const DEFAULT_SCHEMA_MARKDOWN = `# Activity Tracking Schema

Edit the table below to customize your activity fields.
Changes are saved and applied automatically.

| Field Name | Type | Required | Options | Allow Multiple | Timeline Role | Report Dimension | Aliases |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Category | enum | Yes | Deep Work, Shallow Work, Fitness, Learning, Personal, Leisure, Work, Sleep | No | Color | 1 | activity |
| Activity Name | string | Yes | | No | Title | 2 | task, description |
| Location | enum | No | Home Office, Office, Coffee Shop, Gym, Transit, Movement | No | Badge | 3 | place |
| Tags | string | No | | Yes | Content | | tags |
| Notes | string | No | | No | Content | | linked note |

## Predefined Activities

| Category | Activities |
| :--- | :--- |
| Deep Work | Coding, Architecture, Code Review, Debugging, Writing |
| Shallow Work | Email, Catch-up, Admin, Status Updates |
| Fitness | Running, Weightlifting, Yoga, Cycling, Walking |
| Learning | Reading, Course, Research |
| Personal | Errand, Meal, Call |
| Leisure | Gaming, Movies, Reading for Fun |
| Work | Planning, Meeting, 1:1, Sync |

> [!TIP]
> - **Type**: \`enum\` or \`string\`.
> - **Options**: Comma-separated values for \`enum\` fields. Colors are assigned automatically and stay consistent.
> - **Timeline Role**: \`Color\` (drives card background/border), \`Title\` (card heading), \`Badge\` (pill badge), \`Content\` (card body text), or \`Hidden\`.
> - **Report Dimension**: \`1\`, \`2\`, or \`3\` defines the aggregation hierarchy in monthly reports.
> - **Aliases**: Comma-separated historical column names so older monthly records parse without data loss.
> - **Predefined Activities**: First column is Category, second column is candidate activity names. Category doesn't have to be in this table. You can still type other activities freely.
`;

/**
 * Sensible default schema configuration for personal tracking
 */
export const DEFAULT_SCHEMA_CONFIG: TrackingSchemaConfig = {
    version: 1,
    fields: [
        {
            id: 'category',
            label: 'Category',
            type: 'enum',
            required: true,
            multiple: false,
            aliases: ['activity', 'Activity'],
            options: [
                'Deep Work',
                'Shallow Work',
                'Fitness',
                'Learning',
                'Personal',
                'Leisure',
                'Work',
                'Sleep',
            ].map(label => ({
                id: label.toLowerCase().replace(/[^a-z0-9_]+/g, '-').replace(/^-+|-+$/g, ''),
                label,
                color: getColorForValue(label),
            })),
            defaultValue: 'Deep Work',
            ui: {
                widget: 'dropdown',
                timelineRole: 'color',
            },
        },
        {
            id: 'activity_name',
            label: 'Activity Name',
            type: 'string',
            required: true,
            multiple: false,
            aliases: ['description', 'Description', 'task', 'Task'],
            ui: {
                widget: 'text',
                placeholder: 'e.g., Code review, Design document',
                timelineRole: 'title',
            },
        },
        {
            id: 'location',
            label: 'Location',
            type: 'enum',
            required: false,
            multiple: false,
            aliases: ['place', 'Place'],
            options: [
                'Home Office',
                'Office',
                'Coffee Shop',
                'Gym',
                'Transit',
                'Movement',
            ].map(label => ({
                id: label.toLowerCase().replace(/[^a-z0-9_]+/g, '-').replace(/^-+|-+$/g, ''),
                label,
                color: FIXED_LOCATION_COLOR,
            })),
            ui: {
                widget: 'dropdown',
                timelineRole: 'badge',
            },
        },
        {
            id: 'tags',
            label: 'Tags',
            type: 'string',
            required: false,
            multiple: true,
            aliases: ['Tags'],
            ui: {
                widget: 'tags',
                placeholder: 'e.g., coding, research, writing',
                timelineRole: 'content',
            },
        },
        {
            id: 'notes',
            label: 'Notes',
            type: 'string',
            required: false,
            multiple: false,
            aliases: ['Notes', 'Linked Note'],
            ui: {
                widget: 'note-link',
                placeholder: '[[Note]] or extra details',
                timelineRole: 'content',
            },
        },
    ],
    defaultReportGrouping: ['category', 'activity_name', 'location'],
    activityPresets: DEFAULT_ACTIVITY_PRESETS,
};

/**
 * Sub-breakdown of an activity within a category
 */
export interface CategoryActivityBreakdown {
    name: string;
    totalMinutes: number;
    percentageOfCategory: number;
    color: string;
}

/**
 * Aggregated report item for a single category
 */
export interface CategoryReportItem {
    category: string;
    color: string;
    totalMinutes: number;
    percentageOfTime: number;
    entryCount: number;
    activities: CategoryActivityBreakdown[];
}

/**
 * Summary KPIs for the category report
 */
export interface CategoryReportSummary {
    activeDaysCount: number;
    categoriesCount: number;
    topCategoryName: string;
    topCategoryMinutes: number;
    items: CategoryReportItem[];
}

/**
 * Plugin settings stored in Obsidian's data.json
 */
export interface TimeTrackerSettings {
    /** Root folder for time tracking files */
    timeTrackingFolder: string;
    /** Pixels per hour in timeline view */
    hourHeight: number;
    /** First hour to display (0-23) */
    dayStartHour: number;
    /** Last hour to display (0-23) */
    dayEndHour: number;
    /** Use 24-hour format (true) or 12-hour (false) */
    use24HourFormat: boolean;
    /** First day of week: 'monday' or 'sunday' */
    weekStart: 'monday' | 'sunday';
    /** Auto-create folder if missing */
    autoCreateFolder: boolean;
    /** Max characters for description (0 = no limit) */
    descriptionMaxLength: number;
    /** Enable debug logging to console */
    debugMode: boolean;
    /** Hide data tables in reading view using %% comment markers */
    hideTablesInPreview: boolean;
}

/**
 * Default settings
 */
export const DEFAULT_SETTINGS: TimeTrackerSettings = {
    timeTrackingFolder: 'TimeTracking',
    hourHeight: 100,
    dayStartHour: 6,
    dayEndHour: 22,
    use24HourFormat: true,
    weekStart: 'monday',
    autoCreateFolder: true,
    descriptionMaxLength: 200,
    debugMode: false,
    hideTablesInPreview: true,
};

/**
 * Result of parsing a monthly file (alias of MonthlyData for full backwards compatibility)
 */
export type ParsedMonth = MonthlyData;

/**
 * View type identifier for the timeline view
 */
export const VIEW_TYPE_TIMELINE = 'where-did-the-time-go-timeline';

/**
 * View type identifier for the reports view
 */
export const VIEW_TYPE_REPORTS = 'where-did-the-time-go-reports';

/**
 * Time range preset options for reports
 */
export type TimeRangePreset = 'today' | 'yesterday' | 'this-week' | 'last-week' | 'this-month' | 'last-month' | 'custom';

/**
 * Hierarchical tree node for multi-level report aggregation
 */
export interface ReportTreeNode {
    /** Unique hierarchical key for node identity and expansion state */
    key: string;
    /** Group value label (e.g. "Deep Work", "Code review", "Home Office") */
    label: string;
    /** Field ID this level groups by (e.g. "category") */
    dimensionId: string;
    /** Display color for dot and progress bar */
    color: string;
    /** Total minutes for this node and its descendants */
    totalMinutes: number;
    /** Percentage of parent node duration (or percentage of total for root nodes) */
    percentageOfParent: number;
    /** Percentage of total tracked time across the entire report range */
    percentageOfTotal: number;
    /** Tree depth: 0 = Level 1, 1 = Level 2, 2 = Level 3 */
    depth: number;
    /** Child nodes grouped by the next dimension */
    children: ReportTreeNode[];
}

/**
 * Summary KPIs for the reports view
 */
export interface ReportSummaryStats {
    /** Total tracked time in minutes across the selected range */
    totalMinutes: number;
    /** Daily average in minutes based on active tracking days */
    dailyAverageMinutes: number;
    /** Number of distinct calendar days with logged time */
    activeDaysCount: number;
    /** Label of the top category / item by logged time */
    topFocusLabel: string;
    /** Total minutes logged for the top focus item */
    topFocusMinutes: number;
}


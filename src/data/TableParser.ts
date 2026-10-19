import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import type { Root, Table, TableRow, TableCell, Heading } from 'mdast';
import type { TimeEntry, MonthlyData, DailyDiary, TrackingSchemaConfig, FieldDefinition } from '../types';
import { DEFAULT_SCHEMA_CONFIG } from '../types';
import { Logger } from '../utils/Logger';

/**
 * Parses and serializes monthly time tracking files using AST via mdast/remark.
 * Supports:
 * 1. Chronological activity tables with dynamic schema columns and unmapped legacy columns
 * 2. ## Daily Diaries with ### YYYY-MM-DD free-text reflection sections
 * 3. ## Monthly AI Summary (Phase 2 preserved section)
 */
export class TableParser {
    /** Default legacy column headers */
    static readonly LEGACY_HEADERS = ['Start', 'End', 'Description', 'Client', 'Project', 'Activity', 'Notes'];

    /** Create unified processor for parsing */
    private static createParser() {
        return unified()
            .use(remarkParse)
            .use(remarkGfm);
    }

    /** Create unified processor for serializing */
    private static createSerializer() {
        return unified()
            .use(remarkParse)
            .use(remarkGfm)
            .use(remarkStringify, {
                bullet: '-',
                fence: '`',
                fences: true,
                incrementListMarker: false,
            });
    }

    /**
     * Parse a monthly file content into MonthlyData (entries, diaries, summary)
     */
    static parseMonthFile(content: string, monthStr: string, schema?: TrackingSchemaConfig): MonthlyData {
        const entries: TimeEntry[] = [];
        const entriesByDate = new Map<string, TimeEntry[]>();
        const diariesByDate = new Map<string, DailyDiary>();
        let aiSummary: string | undefined;

        if (!content || !content.trim()) {
            return {
                month: monthStr,
                entries,
                entriesByDate,
                diariesByDate,
                aiSummary,
            };
        }

        // Parse markdown to AST
        const processor = this.createParser();
        const tree = processor.parse(content) as Root;

        // 1. Parse activity table
        for (const node of tree.children) {
            if (node.type === 'table') {
                const tableEntries = this.parseTable(node, schema);
                for (const entry of tableEntries) {
                    entries.push(entry);

                    if (!entriesByDate.has(entry.date)) {
                        entriesByDate.set(entry.date, []);
                    }
                    entriesByDate.get(entry.date)!.push(entry);
                }
            }
        }

        // 2. Parse Daily Diaries and Monthly Summary sections
        this.parseSections(tree, content, diariesByDate, (summary) => {
            aiSummary = summary;
        });

        return {
            month: monthStr,
            entries,
            entriesByDate,
            diariesByDate,
            aiSummary,
        };
    }

    /**
     * Parse table node into TimeEntry array with dynamic schema matching
     */
    private static parseTable(table: Table, schema?: TrackingSchemaConfig): TimeEntry[] {
        const entries: TimeEntry[] = [];
        const rows = table.children;

        if (rows.length < 2) {
            return entries; // Need at least header + one data row
        }

        const headerRow = rows[0];
        const headers: string[] = headerRow.children.map(cell => this.getCellText(cell).trim());
        const hasClientCol = headers.some(h => h.toLowerCase() === 'client');

        // Map column indices
        let startIndex = -1;
        let endIndex = -1;
        interface ColumnMapping {
            index: number;
            header: string;
            field?: FieldDefinition;
        }
        const columnMappings: ColumnMapping[] = [];

        for (let i = 0; i < headers.length; i++) {
            const h = headers[i];
            const norm = h.toLowerCase();

            if (norm === 'start') {
                startIndex = i;
                continue;
            }
            if (norm === 'end') {
                endIndex = i;
                continue;
            }

            let matchedField: FieldDefinition | undefined;
            if (schema && schema.fields) {
                // Exact id or label match first
                matchedField = schema.fields.find(f =>
                    f.id.toLowerCase() === norm || f.label.toLowerCase() === norm
                );
                if (!matchedField) {
                    matchedField = schema.fields.find(f =>
                        f.aliases && f.aliases.some(a => a.toLowerCase() === norm)
                    );
                }
            } else {
                // Fallback matching against default schema
                matchedField = DEFAULT_SCHEMA_CONFIG.fields.find(f =>
                    f.id.toLowerCase() === norm || f.label.toLowerCase() === norm
                );
                if (!matchedField) {
                    matchedField = DEFAULT_SCHEMA_CONFIG.fields.find(f =>
                        f.aliases && f.aliases.some(a => a.toLowerCase() === norm)
                    );
                }
            }

            columnMappings.push({
                index: i,
                header: h,
                field: matchedField,
            });
        }

        if (startIndex === -1 || endIndex === -1) {
            Logger.log('TableParser: Table missing Start or End columns');
            return entries;
        }

        // Parse data rows
        for (let r = 1; r < rows.length; r++) {
            const row = rows[r];
            const cells = row.children;

            const startStr = startIndex < cells.length ? this.getCellText(cells[startIndex]) : '';
            const endStr = endIndex < cells.length ? this.getCellText(cells[endIndex]) : '';

            if (!startStr || !endStr) {
                continue;
            }

            const startDateTime = this.parseDateTime(startStr);
            const endDateTime = this.parseDateTime(endStr);
            if (!startDateTime || !endDateTime) {
                continue;
            }

            const date = this.getDateString(startDateTime);
            const start = this.formatTime(startDateTime);
            const end = this.formatTime(endDateTime);
            const durationMinutes = Math.round((endDateTime.getTime() - startDateTime.getTime()) / 60000);

            const fields: Record<string, string | string[]> = {};
            const unmappedFields: Record<string, string> = {};

            let description = '';
            let client = '';
            let project: string | undefined;
            let activity: string | undefined;
            let linkedNote: string | undefined;

            for (const col of columnMappings) {
                const cellText = col.index < cells.length ? this.getCellText(cells[col.index]) : '';
                const parsedVal = this.parseDescription(cellText);

                if (col.field) {
                    if (col.field.multiple) {
                        fields[col.field.id] = parsedVal
                            ? parsedVal.split(',').map(s => s.trim()).filter(Boolean)
                            : [];
                    } else {
                        fields[col.field.id] = parsedVal;
                    }

                    // Map legacy helper properties
                    if (col.field.id === 'activity_name' || col.field.aliases?.includes('description')) {
                        description = parsedVal;
                    }
                    if (col.field.id === 'category' || col.field.aliases?.includes('activity')) {
                        activity = parsedVal;
                    }
                    if (col.field.id === 'project') {
                        project = parsedVal;
                    }
                    if (col.field.id === 'notes' || col.field.aliases?.includes('notes')) {
                        const wikiMatch = parsedVal.match(/\[\[([^\]]+)\]\]/);
                        linkedNote = wikiMatch ? wikiMatch[1] : (parsedVal || undefined);
                    }
                } else {
                    unmappedFields[col.header] = parsedVal;

                    const normHeader = col.header.toLowerCase();
                    if (normHeader === 'client') {
                        client = parsedVal;
                    }
                    if (normHeader === 'description' && !description) {
                        description = parsedVal;
                    }
                    if (normHeader === 'project' && !project) {
                        project = parsedVal;
                    }
                    if (normHeader === 'activity' && !activity) {
                        activity = parsedVal;
                    }
                    if (normHeader === 'notes' && !linkedNote) {
                        const wikiMatch = parsedVal.match(/\[\[([^\]]+)\]\]/);
                        linkedNote = wikiMatch ? wikiMatch[1] : (parsedVal || undefined);
                    }
                }
            }

            if (!description) {
                const titleFieldVal = fields['activity_name'] || fields['category'];
                description = typeof titleFieldVal === 'string' ? titleFieldVal : (Array.isArray(titleFieldVal) ? titleFieldVal.join(', ') : '');
            }

            if (schema) {
                let missingRequired = false;
                for (const col of columnMappings) {
                    if (col.field && col.field.required) {
                        const val = fields[col.field.id];
                        if (val === undefined || val === '' || (Array.isArray(val) && val.length === 0)) {
                            missingRequired = true;
                            break;
                        }
                    }
                }
                if (missingRequired) continue;
            } else if (hasClientCol && !client) {
                continue;
            }

            entries.push({
                date,
                start,
                end,
                description,
                client,
                project,
                activity,
                linkedNote,
                fields,
                unmappedFields: Object.keys(unmappedFields).length > 0 ? unmappedFields : undefined,
                startDateTime,
                endDateTime,
                lineNumber: r,
                durationMinutes,
            });
        }

        return entries;
    }

    /**
     * Parse ## Daily Diaries and ## Monthly AI Summary sections from markdown AST
     */
    private static parseSections(
        tree: Root,
        content: string,
        diariesByDate: Map<string, DailyDiary>,
        onSummary: (summary: string) => void
    ): void {
        const children = tree.children;

        for (let i = 0; i < children.length; i++) {
            const node = children[i];
            if (node.type !== 'heading') continue;

            const heading = node as Heading;
            const headingText = this.getNodeText(heading).trim().toLowerCase();

            // Detect ## Daily Diaries
            if (heading.depth === 2 && headingText.includes('daily diar')) {
                // Parse H3 children under Daily Diaries until the next H2 or end of file
                for (let j = i + 1; j < children.length; j++) {
                    const sibling = children[j];
                    if (sibling.type === 'heading') {
                        const sibHeading = sibling as Heading;
                        if (sibHeading.depth <= 2) {
                            // Reached next top-level section
                            break;
                        }
                        if (sibHeading.depth === 3) {
                            const dateStr = this.getNodeText(sibHeading).trim();
                            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                                const diaryContent = this.extractSectionContent(children, j, content);
                                diariesByDate.set(dateStr, {
                                    date: dateStr,
                                    content: diaryContent,
                                });
                            }
                        }
                    }
                }
            }

            // Detect ## Monthly AI Summary
            if (heading.depth === 2 && (headingText.includes('summary') || headingText.includes('reflection'))) {
                const summaryContent = this.extractSectionContent(children, i, content, 2);
                if (summaryContent) {
                    onSummary(summaryContent);
                }
            }
        }
    }

    /**
     * Extract raw markdown content between an AST heading and the next heading of equal or higher depth
     */
    private static extractSectionContent(
        nodes: Root['children'],
        headingIndex: number,
        fullContent: string,
        maxDepth?: number
    ): string {
        const headingNode = nodes[headingIndex] as Heading;
        const targetDepth = maxDepth !== undefined ? maxDepth : headingNode.depth;

        // Determine content start offset
        let startOffset: number | undefined;
        if (headingNode.position?.end?.offset !== undefined) {
            startOffset = headingNode.position.end.offset;
        }

        // Determine content end offset (start of next relevant heading or end of file)
        let endOffset: number | undefined;
        for (let k = headingIndex + 1; k < nodes.length; k++) {
            const nextNode = nodes[k];
            if (nextNode.type === 'heading') {
                const nextHeading = nextNode as Heading;
                if (nextHeading.depth <= targetDepth) {
                    if (nextHeading.position?.start?.offset !== undefined) {
                        endOffset = nextHeading.position.start.offset;
                    }
                    break;
                }
            }
        }

        if (startOffset !== undefined) {
            const rawSlice = endOffset !== undefined
                ? fullContent.substring(startOffset, endOffset)
                : fullContent.substring(startOffset);
            return rawSlice.trim();
        }

        // Fallback using node text serialization
        const collectedTexts: string[] = [];
        for (let k = headingIndex + 1; k < nodes.length; k++) {
            const nextNode = nodes[k];
            if (nextNode.type === 'heading' && (nextNode as Heading).depth <= targetDepth) {
                break;
            }
            collectedTexts.push(this.getNodeText(nextNode));
        }
        return collectedTexts.join('\n\n').trim();
    }

    /**
     * Get text content from a table cell
     */
    private static getCellText(cell: TableCell): string {
        let text = '';
        for (const child of cell.children) {
            if (child.type === 'text') {
                text += child.value;
            } else if (child.type === 'inlineCode') {
                text += child.value;
            } else if ('children' in child) {
                text += this.getNodeText(child);
            }
        }
        return text.trim();
    }

    /**
     * Recursively get text from any node
     */
    private static getNodeText(node: unknown): string {
        if (!node || typeof node !== 'object') return '';

        const n = node as { type?: string; value?: string; children?: unknown[] };

        if (n.type === 'text' && typeof n.value === 'string') {
            return n.value;
        }

        if (Array.isArray(n.children)) {
            return n.children.map(child => this.getNodeText(child)).join('');
        }

        return '';
    }

    /**
     * Parse datetime string "YYYY-MM-DD HH:mm" into Date
     */
    static parseDateTime(str: string): Date | null {
        const match = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
        if (!match) {
            return null;
        }

        const [, year, month, day, hours, minutes] = match.map(Number);
        return new Date(year, month - 1, day, hours, minutes);
    }

    /**
     * Format a Date to HH:mm string
     */
    static formatTime(date: Date): string {
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }

    /**
     * Get the date string (YYYY-MM-DD) for a given date
     */
    static getDateString(date: Date): string {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * Get the month string (YYYY-MM) for a given date
     */
    static getMonthString(date: Date): string {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        return `${year}-${month}`;
    }

    /**
     * Format a Date to "YYYY-MM-DD HH:mm" string for table cells
     */
    static formatDateTime(date: Date): string {
        return `${this.getDateString(date)} ${this.formatTime(date)}`;
    }

    /**
     * Generate markdown table content from entries with dynamic schema columns
     */
    static generateTable(entries: TimeEntry[], schema?: TrackingSchemaConfig): string {
        // Sort entries chronologically by start time
        const sorted = [...entries].sort((a, b) =>
            a.startDateTime.getTime() - b.startDateTime.getTime()
        );

        // Determine column headers
        let headers: string[] = [];

        if (schema && schema.fields && schema.fields.length > 0) {
            headers = ['Start', 'End', ...schema.fields.map(f => f.label)];

            // Retain any unmapped columns present in existing entries
            const unmappedSeen = new Set<string>();
            for (const entry of sorted) {
                if (entry.unmappedFields) {
                    for (const unmappedCol of Object.keys(entry.unmappedFields)) {
                        if (!headers.some(h => h.toLowerCase() === unmappedCol.toLowerCase())) {
                            unmappedSeen.add(unmappedCol);
                        }
                    }
                }
                if (entry.client && !headers.some(h => h.toLowerCase() === 'client')) {
                    unmappedSeen.add('Client');
                }
            }
            headers.push(...Array.from(unmappedSeen));
        } else {
            // Check if entries have client or legacy format
            const hasClient = entries.some(e => Boolean(e.client));
            if (hasClient) {
                headers = [...this.LEGACY_HEADERS];
            } else {
                headers = ['Start', 'End', 'Category', 'Activity Name', 'Location', 'Tags', 'Notes'];
            }
        }

        // Build table AST
        const tableRows: TableRow[] = [];

        // Header row
        tableRows.push({
            type: 'tableRow',
            children: headers.map(h => ({
                type: 'tableCell',
                children: [{ type: 'text', value: h }],
            })) as TableCell[],
        });

        // Data rows
        for (const entry of sorted) {
            const rowCells: TableCell[] = [];

            for (const h of headers) {
                const norm = h.toLowerCase();

                if (norm === 'start') {
                    rowCells.push(this.createCell(this.formatDateTime(entry.startDateTime)));
                    continue;
                }
                if (norm === 'end') {
                    rowCells.push(this.createCell(this.formatDateTime(entry.endDateTime)));
                    continue;
                }

                // Match with schema field
                let matchedField: FieldDefinition | undefined;
                if (schema && schema.fields) {
                    matchedField = schema.fields.find(f =>
                        f.id.toLowerCase() === norm ||
                        f.label.toLowerCase() === norm ||
                        (f.aliases && f.aliases.some(a => a.toLowerCase() === norm))
                    );
                }

                if (matchedField) {
                    let cellVal = '';
                    const rawVal = entry.fields?.[matchedField.id];

                    if (rawVal !== undefined && rawVal !== null) {
                        cellVal = Array.isArray(rawVal) ? rawVal.join(', ') : String(rawVal);
                    } else {
                        // Fallback to legacy properties
                        if (matchedField.id === 'activity_name') cellVal = entry.description || '';
                        else if (matchedField.id === 'category') cellVal = entry.activity || '';
                        else if (matchedField.id === 'project') cellVal = entry.project || '';
                        else if (matchedField.id === 'notes') cellVal = entry.linkedNote ? `[[${entry.linkedNote}]]` : '';
                    }

                    if (matchedField.ui?.widget === 'note-link' && cellVal && !cellVal.startsWith('[[')) {
                        cellVal = `[[${cellVal}]]`;
                    }

                    rowCells.push(this.createCell(this.serializeDescription(cellVal)));
                } else {
                    // Check unmapped or legacy properties
                    let val = entry.unmappedFields?.[h] || '';
                    if (!val) {
                        if (norm === 'client') val = entry.client || '';
                        else if (norm === 'description') val = entry.description || '';
                        else if (norm === 'project') val = entry.project || '';
                        else if (norm === 'activity') val = entry.activity || '';
                        else if (norm === 'notes') val = entry.linkedNote ? `[[${entry.linkedNote}]]` : '';
                    }
                    rowCells.push(this.createCell(this.serializeDescription(val)));
                }
            }

            tableRows.push({
                type: 'tableRow',
                children: rowCells,
            });
        }

        const table: Table = {
            type: 'table',
            align: headers.map(() => 'left'),
            children: tableRows,
        };

        const root: Root = {
            type: 'root',
            children: [table],
        };

        const processor = this.createSerializer();
        let result = processor.stringify(root);

        // Unescape wikilinks (remark escapes [[ but Obsidian needs them)
        result = result.replace(/\\\[\\\[/g, '[[').replace(/\\\]\\\]/g, ']]');

        return result;
    }

    /**
     * Create a table cell with text content
     */
    private static createCell(text: string): TableCell {
        return {
            type: 'tableCell',
            children: [{ type: 'text', value: text }],
        };
    }

    /**
     * Convert newlines to <br> for table storage
     */
    private static serializeDescription(description: string): string {
        return description.replace(/\n/g, '<br>');
    }

    /**
     * Convert <br> back to newlines for display
     */
    static parseDescription(description: string): string {
        return description.replace(/<br\s*\/?>/gi, '\n');
    }

    /**
     * Generate complete month file with header, dynamic table, daily diaries, and AI summary
     */
    static generateMonthFile(
        entries: TimeEntry[],
        monthStr: string,
        schemaOrHideTable?: TrackingSchemaConfig | boolean,
        diaries?: Map<string, DailyDiary> | DailyDiary[],
        aiSummary?: string,
        hideTable: boolean = true
    ): string {
        let schema: TrackingSchemaConfig | undefined;
        let effectiveHideTable = hideTable;

        if (typeof schemaOrHideTable === 'boolean') {
            effectiveHideTable = schemaOrHideTable;
            schema = undefined;
        } else {
            schema = schemaOrHideTable;
        }

        const header = this.getFileHeader();
        const table = this.generateTable(entries, schema);

        const tableContent = effectiveHideTable ? `%%\n${table}%%\n` : `${table}\n`;

        // Format Daily Diaries
        let diarySection = '';
        const diaryList: DailyDiary[] = diaries instanceof Map
            ? Array.from(diaries.values())
            : Array.isArray(diaries) ? diaries : [];

        if (diaryList.length > 0) {
            const sortedDiaries = [...diaryList]
                .filter(d => Boolean(d.date))
                .sort((a, b) => a.date.localeCompare(b.date));

            if (sortedDiaries.length > 0) {
                diarySection = `\n## Daily Diaries\n\n` +
                    sortedDiaries.map(d => `### ${d.date}\n${d.content.trim()}`).join('\n\n') + '\n';
            }
        }

        // Format AI Summary
        let summarySection = '';
        if (aiSummary && aiSummary.trim()) {
            summarySection = `\n## Monthly AI Summary\n\n${aiSummary.trim()}\n`;
        }

        return `${header}\n# ${monthStr}\n\n${tableContent}${diarySection}${summarySection}`.trimEnd() + '\n';
    }

    /**
     * Warning header added to the top of monthly files
     */
    static getFileHeader(): string {
        return `%%
⚠️ WARNING: This file is managed by the Personal Time Tracker plugin.
Do not edit activities manually - your changes may be overwritten.
Use the Timeline view to create, edit, or delete entries.
%%`;
    }
}

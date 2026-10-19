#!/usr/bin/env node
/**
 * Generate stress test data files for the Where Did The Time Go plugin.
 *
 * Usage:
 *   node scripts/generate-stress-test.js [options]
 *
 * Options:
 *   --month=YYYY-MM     Month to generate (default: next month)
 *   --interval=N        Appointment interval in minutes (default: 15)
 *   --start-hour=N      Start hour of day, 0-23 (default: 0 for 24h, or 7 for partial)
 *   --end-hour=N        End hour of day, 0-23 (default: 24 for full day, or 21 for partial)
 *   --output=PATH       Output directory (default: uses OBSIDIAN_TEST_VAULT env or test vault)
 *
 * Examples:
 *   node scripts/generate-stress-test.js --month=2026-03 --interval=10
 *   node scripts/generate-stress-test.js --month=2026-02 --interval=15 --start-hour=7 --end-hour=21
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = {};
process.argv.slice(2).forEach(arg => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    args[key] = value;
});

// Configuration
const now = new Date();
const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}`;
const month = args.month || defaultMonth;
const interval = parseInt(args.interval) || 15;
const startHour = parseInt(args['start-hour']) ?? 0;
const endHour = parseInt(args['end-hour']) ?? 24;
const outputDir = args.output || (process.env.OBSIDIAN_TEST_VAULT
    ? path.join(process.env.OBSIDIAN_TEST_VAULT, 'TimeTracking')
    : path.join(process.cwd(), 'vaults/personal-time-tracking-vault/TimeTracking'));

// Validate month format
if (!/^\d{4}-\d{2}$/.test(month)) {
    console.error('Invalid month format. Use YYYY-MM');
    process.exit(1);
}

// Calculate days in month
const [year, monthNum] = month.split('-').map(Number);
const daysInMonth = new Date(year, monthNum, 0).getDate();

// Calculate slots per day
const hoursPerDay = endHour - startHour;
const slotsPerDay = Math.floor((hoursPerDay * 60) / interval);
const totalEntries = daysInMonth * slotsPerDay;

console.log(`Generating stress test for ${month}`);
console.log(`  Days: ${daysInMonth}`);
console.log(`  Hours/day: ${startHour}:00 - ${endHour}:00 (${hoursPerDay}h)`);
console.log(`  Interval: ${interval} min`);
console.log(`  Entries/day: ${slotsPerDay}`);
console.log(`  Total entries: ${totalEntries}`);
console.log(`  Output: ${outputDir}/${month}.md`);

// File header
const header = `%%
⚠️ WARNING: This file is managed by the "Where Did The Time Go" plugin.
Do not edit manually - your changes may be overwritten.
Use the Timeline view to create, edit, or delete entries.

FILE STRUCTURE:
- One file per month, named YYYY-MM.md
- Single table containing all entries for the month
- Entries sorted chronologically by start time

TABLE COLUMNS:
| Start | End | Category | Activity Name | Location | Tags | Notes | With Who |
- Start (required): Start date and time (YYYY-MM-DD HH:mm)
- End (required): End date and time (may be next day for overnight entries)
- Category (required): Tracking category
- Activity Name (required): Activity description
- Location (optional): Place / location
- Tags (optional): Comma-separated tags
- Notes (optional): Obsidian wikilink [[linked note]]
- With Who (optional): People / collaborators
%%
`;

// Test data
const categories = ['Deep Work', 'Shallow Work', 'Fitness', 'Learning', 'Personal', 'Chores', 'Entertainment'];
const activities = [
    'Coding',
    'Architecture',
    'Code Review',
    'Debugging',
    'Reading',
    'Running',
    'Cooking',
    'Gaming',
    'Planning',
    'Writing',
];
const locations = ['Home Office', 'Coffee Shop', 'Gym', 'Transit', ''];
const tagsList = ['focus', 'routine', 'deep-dive', 'quick', ''];
const withWhoList = ['Bob', 'Alice', 'Joan', 'Cindy', ''];

// Generate table rows
let rows = [];
rows.push('| Start | End | Category | Activity Name | Location | Tags | Notes | With Who |');
rows.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');

for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${month}-${day.toString().padStart(2, '0')}`;

    for (let slot = 0; slot < slotsPerDay; slot++) {
        const startMinutes = startHour * 60 + slot * interval;
        const endMinutes = startMinutes + interval;

        const startH = Math.floor(startMinutes / 60);
        const startM = startMinutes % 60;
        const endH = Math.floor(endMinutes / 60);
        const endM = endMinutes % 60;

        const start = `${dateStr} ${startH.toString().padStart(2, '0')}:${startM.toString().padStart(2, '0')}`;
        const end = `${dateStr} ${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;

        const category = categories[(day + slot) % categories.length];
        const activity = activities[(day + slot * 2) % activities.length];
        const location = locations[(day + slot) % locations.length];
        const tag = tagsList[(day + slot) % tagsList.length];
        const withWho = withWhoList[(day + slot) % withWhoList.length];

        rows.push(`| ${start} | ${end} | ${category} | ${activity} | ${location} | ${tag} | | ${withWho} |`);
    }
}

const table = rows.join('\n');
const content = `${header}
# ${month}

%%
${table}
%%
`;

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Write file
const outputPath = path.join(outputDir, `${month}.md`);
fs.writeFileSync(outputPath, content);

console.log(`\nGenerated ${outputPath}`);
console.log(`File size: ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB`);

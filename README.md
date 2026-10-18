# Where Did The Time Go?

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://www.buymeacoffee.com/plattnum)

**A visual personal time tracking and daily reflection plugin for Obsidian.** An interactive timeline to log your focus blocks, daily reflection diaries co-located with your tracked activities, and configurable multi-level reports to see where your time went. Your data stays in your vault as plain markdown tables and journals — no cloud, no sync, no subscriptions.

## Why This Exists

I got tired of:
- SaaS time trackers that take 10 seconds to load
- Monthly subscriptions for what amounts to a fancy spreadsheet
- Freelance tools forcing hourly billing rates and invoice workflows onto personal life tracking
- Apps that include "team collaboration features" when I just work alone
- Syncing conflicts, server outages, and "we're updating our privacy policy" emails

I wanted something **focused on personal time allocation and mindful reflection**:
- Click or drag on a timeline, enter what you focused on, and you're done.
- Write daily reflections directly alongside your time entries.
- Fully customize your schema (categories, activities, locations, tags) in a clean Markdown table (`Schema.md`).
- Data lives in your vault as plain markdown. Works offline. Loads instantly. No account required. No telemetry.

**No timer feature.** I don't track my work by hitting start/stop on a stopwatch — it just doesn't fit how I work. I enter my time after the fact.

## Features

### ∞ Timeline
Visual day-by-day timeline that scrolls smoothly. Drag to create entries, drag to move them, resize handles to adjust duration.
- **Dynamic card styling**: Colored by your designated category, titled by activity, with badges for location.
- **Daily diary tray**: Sticky day header with a one-click 📝 diary button to write or read daily reflections.

### Daily Reflection Diaries
Reflect on your energy, focus, and learnings right inside your monthly file (`TimeTracking/YYYY-MM.md` under `## Daily Diaries`).
- Word and character counter with instant `Cmd/Ctrl + Enter` save.
- Timeline header button opens the diary for the day currently visible on screen.

### Configurable Activity Schema (`Schema.md`)
Define your own tracking dimensions in `<vault>/TimeTracking/Schema.md`:
- Pure Markdown table: `Field Name`, `Type`, `Required`, `Options`, `Allow Multiple`, `Timeline Role`, `Report Dimension`, `Aliases`.
- Automatic deterministic color hashing: consistent colors for categories without tedious hex code editing.
- Live file watcher: changes made to `Schema.md` reload immediately across your timeline and reports.

### Multi-Level Reports View (1 to 3 Dimensions)
Analyze where your hours actually went across customizable hierarchies:
- Select 1 to 3 grouping dimensions (e.g., **Category → Activity Name → Location**).
- Summary KPI cards: **Total Time**, **Daily Average**, **Top Focus**, and **Active Days**.
- Expandable/collapsible tree table with % of parent, % of total, and visual distribution bars.
- Export to **CSV** or **JSON** preserving all dynamic schema attributes.

### Plain Markdown Storage
Your data lives in `TimeTracking/YYYY-MM.md` files:
```markdown
%%
⚠️ WARNING: This file is managed by the "Where Did The Time Go" plugin.
Do not edit manually - your changes may be overwritten.
%%

# 2026-10

%%
| Start            | End              | Category  | Activity Name          | Location    | Tags             | Notes              |
| :--------------- | :--------------- | :-------- | :--------------------- | :---------- | :--------------- | :----------------- |
| 2026-10-15 08:30 | 2026-10-15 10:00 | Deep Work | System architecture    | Home Office | coding, planning | [[ArchitectureDoc]]|
| 2026-10-15 10:15 | 2026-10-15 11:15 | Fitness   | Morning 5k run         | Gym         | cardio           |                    |
%%

## Daily Diaries

### 2026-10-15
High mental clarity this morning. Finished the parser and schema specifications before lunch.
```

One file per month. Human-readable. Git-friendly. Portable — if this plugin dies, your data doesn't.

### Overlap Detection & Magnetic Snap
- Live conflict warning prevents accidental double-booking.
- Magnetic snap buttons (🧲) connect seamlessly to adjacent entries without gaps.

### Midnight-Spanning Entries
Entries can cross midnight cleanly without breaking. Duration math and reports handle multi-day entries seamlessly.

## Usage

After enabling, click the ribbon icons on the left:
- 🕒 **Open Timeline**
- 📊 **Open Reports**

### Keyboard Shortcuts & Command Palette (`Ctrl/Cmd + P`)
- `Create Time Entry`: Open entry form directly
- `Open Timeline`: Open timeline view
- `Open Reports`: Open reports view
- `Open Today's Diary`: Open reflection modal for today

## Settings

| Setting | Description |
|---------|-------------|
| **Time tracking folder** | Where to store monthly files and Schema.md (default: `TimeTracking`) |
| **Open Schema.md** | One-click button to open and edit your activity schema |
| **Reload Schema** | Reload schema definitions into memory |
| **Hide tables in reading view** | Wrap tables in `%%` comments for cleaner preview rendering |
| **Hour height** | Pixels per hour in timeline view |
| **Day start/end hour** | Visible hour range in timeline view |
| **Week start** | Monday or Sunday |
| **24-hour format** | Toggle 24h vs 12h time display |
| **Description max length** | Character limit for descriptions (0 = unlimited) |
| **Debug mode** | Verbose developer logging in console |

## Development

A pre-configured test vault is included at `vaults/personal-time-tracking-vault/`.

```bash
# Install dependencies
npm install

# Watch mode (auto-builds and copies to test vault)
npm run dev

# Run unit tests
npm test

# Production build
npm run build
```

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for full architecture and test details.

## License

MIT

# Vergil CLI (`vg`)

> Command-line toolkit for [Vergil Astro Theme](https://github.com/vergil-astro/vergil-astro-theme)

Create blog posts, project showcases, photo albums, and manage your entire Vergil site from the terminal.

## Install

```bash
# Via npx (no install)
npx @vergil-astro/vergil-cli --help

# Global install
npm install -g @vergil-astro/vergil-cli
vg --help
```

## Quick Start

```bash
# 1. Initialize a Vergil project
vg init

# 2. Start dev server
vg serve

# 3. Write your first post
vg new post "Hello Vergil"
```

## Commands

### Initialize

```bash
vg init                              # Initialize in current directory
vg init --template <name>            # Clone from a specific GitHub repo (default: vergil-astro/vergil-astro-theme)
vg init --skip-install               # Skip dependency installation
vg init --skip-serve                 # Skip starting dev server
```

### Create Content

```bash
# Blog post
vg new post "Title" --tags astro,tutorial --series "技术" --draft

# Standalone page
vg new page "About"

# Project showcase
vg new project "My App" --website https://example.com --repo owner/repo --description "A cool app"

# Photo album
vg new album "Tokyo Nights" --theme golden

# Short thought (card stream at /thoughts)
vg new thought "今天学到了..." --tags 随笔

# Moment / status update (timeline at /moments)
vg new moment "刚刚发布了新版本！" --tags 动态

# Documentation
vg new doc "Getting Started" --path guide/basics
```

**Note:** For `thought` and `moment`, the title argument is the content text. Both support `--tags`.

#### `vg new` Options

**All types:**
- `-d, --draft` — Create as a draft (hidden from the site until published)
- `-t, --tags <list>` — Comma-separated tags, e.g. `astro,tutorial`

**Post:**
- `-s, --series <name>` — Assign to a series / column
- `-c, --cover <path>` — Cover image path (stored as `banner` in frontmatter)

**Project:**
- `-w, --website <url>` — Project website URL
- `-r, --repo <url>` — GitHub repo URL
- `--description <text>` — Short project description

**Album:**
- `--theme <name>` — Album visual theme: `golden` or `seasons` (default: `golden`)
- `-c, --cover <path>` — Album cover image path

**Doc:**
- `-p, --path <path>` — Create inside a sub-directory, e.g. `guide/basics` creates `docs/guide/basics/index.md`

### Development

```bash
vg serve -p 4321 -h                  # Start dev server (auto-detects npm/yarn/pnpm)
vg build                               # Build the site for production
vg deploy -t github|vercel|netlify     # Build then deploy to hosting
vg clean                               # Clean cache and build output
```

### Content Management

```bash
vg publish                             # List all drafts, pick one to publish
vg publish my-post-slug               # Publish a specific draft by its slug

vg list                                # Summary of all content (except docs)
vg list <type>                         # List items: post|page|project|album|thought|moment
vg list -d                             # Summary of drafts across all types
vg list <type> -d                      # Drafts in a specific type

vg series                              # List all series and their post counts
vg series "技术专栏"                    # Show all posts in a series
vg series list                         # Same as `vg series` (alias)
vg series show "技术专栏"               # Same as `vg series <name>` (alias)

vg docs                                # List all documentation books
vg docs guide                          # Show a book's chapter tree
vg docs list                           # Same as `vg docs` (alias)
vg docs show guide                     # Same as `vg docs <book>` (alias)
```

**What is a draft?** Files created with `--draft` are hidden from your site. Run `vg publish` to remove the draft flag and make them visible.

**What is a slug?** The URL-friendly part of a filename. For a file named `2024-01-01--hello-world-1.md`, the slug is `hello-world`.

### AI Skill Management

```bash
vg skill install                          # Install writing skill to detected AI agents
vg skill install --ai claude -g          # Install to a specific agent globally
vg skill list                             # List installed skills
vg skill uninstall --ai claude           # Remove skill from an agent
```

### Help

```bash
vg help                                   # Show all available commands
vg help directives                        # List all Markdown directives
```

## Content Types

| Type | Format | URL Path | Description |
|------|--------|----------|-------------|
| **post** | Markdown | `/blog` | Blog articles, supports series grouping |
| **page** | Markdown | `/pages` | Standalone pages like About, Contact |
| **project** | Markdown | `/projects` | Project showcases with links |
| **album** | Markdown | `/albums` | Photo albums with visual themes |
| **thought** | Markdown | `/thoughts` | Short ideas displayed as a card stream |
| **moment** | JSON | `/moments` | Status updates displayed as a timeline |
| **doc** | Markdown | `/docs` | Documentation with nested hierarchy |

## Project Detection

`vg` auto-detects Vergil projects by looking for:
- `astro.config.mjs` or `astro.config.ts`
- `src/data/site-config.ts`

Run commands from anywhere inside your project tree.

## Site Configuration

Edit `src/data/site-config.ts` directly to customize:
- Site title, description, URL
- Navigation menu, social links
- Hero section, splash screen
- Comments, sidebar, themes
- Fonts, albums, links, and more

## Requirements

- Node.js >= 18.14.0
- npm, yarn, or pnpm

## License

MIT

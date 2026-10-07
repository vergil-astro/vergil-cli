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

# Documentation: start a book, then add docs to it
vg new doc "My Guide"
vg new doc "Getting Started" --path my-guide
vg new doc "Config" --path my-guide/advanced
```

**Note:** For `thought` and `moment`, the title argument is the content text. Both support `--tags`.

**Filenames are URLs.** Posts, pages, projects and albums are saved as `<slug>.md`, and the slug becomes the address (`/blog/<slug>/`, `/projects/<slug>/` …). Chinese titles keep their characters, so `vg new post "我的第一篇文章"` creates `blog/我的第一篇文章.md`. Folders under `blog/` don't count toward the URL, so `vg` refuses a post whose name is already used in any folder.

#### `vg new` Options

**All types:**
- `-t, --tags <list>` — Comma-separated tags, e.g. `astro,tutorial`

**Post:**
- `-d, --draft` — Create as a draft (hidden from the site until published)
- `-s, --series <name>` — Assign to a series. If the series claims a folder with `dir` in `src/content/series/`, the post is created in that folder instead of getting a `series` field
- `-c, --cover <path>` — Cover image (stored as `banner`), e.g. `'@img/blog/my-post/cover.jpg'`

**Project:**
- `-w, --website <url>` — Project website, added to the body as a button
- `-r, --repo <repo>` — GitHub repo (`owner/repo` or a github.com URL), added to the body as a `ghcard`
- `--description <text>` — Short project description

**Album:**
- `--theme <name>` — Album visual theme: `golden` or `seasons` (default: `golden`)
- `-c, --cover <path>` — Album cover image path

**Doc:**
- `-d, --draft` — Create as a draft
- `-p, --path <path>` — The folder to put the doc in: a book (`my-guide`) or a chapter inside it (`my-guide/advanced`). The book's `_meta.md` is created if it doesn't exist yet. A chapter folder has to be listed under `dirs` in `_meta.md` before the theme shows its docs in the sidebar; `vg` warns when it isn't. Without `--path`, the title starts a new book and becomes its first page

### Development

```bash
vg serve -p 4321 -h                  # Start dev server (auto-detects npm/yarn/pnpm)
vg build                               # Run the theme's build script (tidies images, then astro build)
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
vg docs -d                             # List all docs drafts
vg docs guide                          # Show a book's chapter tree
vg docs guide -d                       # Show only drafts in a book
vg docs list                           # Same as `vg docs` (alias)
vg docs list -d                        # Same as `vg docs -d` (alias)
vg docs show guide                     # Same as `vg docs <book>` (alias)
vg docs show guide -d                  # Same as `vg docs <book> -d` (alias)
```

**What is a draft?** Files created with `--draft` are hidden from your site. Run `vg publish` to remove the draft flag and make them visible.

**What is a slug?** The filename without `.md`, which is also the page's URL. For `blog/hello-world.md` the slug is `hello-world`.

**How are series counted?** The same way the theme does it: a post's `series` field wins, otherwise a post sitting in a folder claimed by a series' `dir` belongs to that series. Series defined in `src/content/series/` show up even before they have posts.

### AI Skill Management

The writing skill ([vergil-writing-skills](https://github.com/vergil-astro/vergil-writing-skills)) drafts, typesets and enhances articles. It follows [kami](https://github.com/tw93/kami)'s writing rules; installing kami as well gives agents the full reference.

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
| **page** | Markdown | `/<slug>` | Standalone pages like About, Contact |
| **project** | Markdown | `/projects` | Project showcases with links |
| **album** | Markdown | `/albums` | Photo albums with visual themes |
| **thought** | Markdown | `/thoughts` | Short ideas displayed as a card stream |
| **moment** | JSON | `/moments` | Status updates displayed as a timeline |
| **doc** | Markdown | `/docs/<book>` | Knowledge-base books: `_meta.md` plus docs and chapter folders |

## Project Detection

`vg` auto-detects Vergil projects by looking for:
- `astro.config.mjs` or `astro.config.ts`
- `src/data/config/`

Run commands from anywhere inside your project tree.

## Site Configuration

Site settings live in `src/data/config/`, one file per area:

- `identity.ts` — site title and description, language, skin, social links, homepage hero
- `nav.ts` — navigation menu
- `splash.ts` — splash screen
- `features.ts` — comments, sidebar and other switches
- `fonts.ts`, `links.ts`, `welcome.ts`, `notice.ts`, `analytics.ts`

The theme's own docs (`/docs/vergil-guide/` on your site) cover each one.

## Requirements

- Node.js >= 18.14.0 for `vg` itself
- The theme needs Node.js 22 and pnpm

## License

MIT

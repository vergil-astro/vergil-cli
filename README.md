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
# 1. Create a Vergil site in a new folder
vg init my-site
cd my-site

# 2. Start dev server
vg serve

# 3. Write your first post
vg new post "Hello Vergil"
```

## Commands

### Initialize

```bash
vg init my-site                      # Create a site in a new folder my-site
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

### AI Writing

AI writing lives in the [vergil-skills](https://github.com/vergil-astro/vergil-skills) agent plugin, not in `vg`. It drafts and typesets posts with Vergil directives and checks directive syntax after every edit:

```text
/plugin marketplace add vergil-astro/vergil-skills
/plugin install vergil@vergil-astro
```

### Skins

A Vergil site loads skins like zsh plugins: a skin lives in `skins/<name>/` at the site root, and is enabled by listing its name in `src/data/config/identity.ts`. `vg` does both steps for you. Each skin brings its own color schemes, and visitors pick from the current skin's schemes: the built-in A–I and K belong to the classic skin. There are no standalone scheme packages.

```bash
vg skin add island                        # Install skins/island from vergil-skins and enable it
vg skin add island#v1.0                   # ...at a tag, branch or commit of vergil-skins
vg skin add someone/vergil-skin-paper     # A GitHub repo that is one skin
vg skin add someone/skins/paper           # A folder inside a GitHub repo
vg skin add ./my-skin                     # A local folder
vg skin list                              # Built-in, installed and enabled skins
vg skin use paper                         # Make it the default for new visitors
vg skin update [name]                     # Re-fetch from where it was installed
vg skin remove paper                      # Disable it and delete its folder
```

Skins live in [vergil-skins](https://github.com/vergil-astro/vergil-skins), official and contributed alike, and a bare name installs `skins/<name>/` from there. To share a skin you made, open a pull request in that repo.

**Options for `add`:** `-n, --name <name>` installs under another name (by default the folder name, or the repo name minus a `vergil-skin-` prefix); `-f, --force` replaces an existing install; `--no-enable` installs without touching `identity.ts`. `remove` asks for confirmation; pass `-y, --yes` in scripts.

**Installed skins are committed with your site.** `add` copies a snapshot of the files into `skins/<name>/`, without a nested `.git`, so CI builds have everything they need. The source is recorded in `skins/<name>/.vg-source.json`, which is what `update` reads.

**Packages are data and CSS only.** `add` copies `.json`, `.css`, `.md`, images, fonts and license files; scripts, configs and dotfiles are left out and listed. It refuses archives with links or paths that escape the folder, and checks the manifest against the appearance contract of the theme the site runs (`appearance/contract.json` in the theme) before installing, so a package that would break the build never lands. See the theme docs, *皮肤与配色接口*, for the package format.

### Help

```bash
vg                                        # Show all available commands
vg help directives                        # List all Markdown directives
vg help callout                           # Syntax, attributes and an example for one directive
```

Directive help reads the directive rules of the theme your site runs (from the installed `@vergil-astro/theme` package, or from `src/` in older sites that carry the theme source), so it matches the theme version you run. Run it from your site folder.

### Images and Directives

```bash
vg images organize                        # Move post images under src/assets/img/ and reference them as @img/
vg images check                           # Report image references that point to missing files
vg images expand                          # Rewrite @img/ references as relative paths
vg directives check                       # Check directive syntax in every Markdown file under src/content
vg directives check src/content/blog/a.md # ...or only in the given files
vg directives ref                         # The full directive reference as Markdown
vg directives ref callout tabs            # ...or only some directives
```

A site's `build` script runs `vg images organize` before `astro build`, so a post can reference images next to it and they still end up in one place. Like `vg help`, the directive commands read the rules of the theme the site runs.

### Starting Out

```bash
vg reset --dry                            # Preview what would be cleared
vg reset                                  # Clear the sample posts, docs, albums and placeholder config
vg reset --all                            # ...and the Vergil guide docs too
```

### Upgrading the Theme

```bash
vg upgrade --dry-run                      # Show the plan: versions, migrations, steps
vg upgrade                                # Upgrade @vergil-astro/theme to the latest release
vg upgrade --to 1.2.0                     # Upgrade to a given version
vg upgrade --skip-check                   # Skip the before/after build comparison
```

The site holds only content and config, so an upgrade is a package update. `vg upgrade` works on a new git branch `vergil-upgrade/<version>`. It builds the site, updates the package with the site's package manager, runs the migrations of any breaking release in between, builds again and lists the pages that changed. On pnpm sites it also declares the install scripts the new version brings (`allowBuilds` in `pnpm-workspace.yaml`), leaving the site's own choices as they are. To undo: `git switch - && git branch -D vergil-upgrade/<version>`.

## For Agents and Scripts

vg works the same in a terminal and in a pipe, apart from things only a person needs:

- `--json` on `list`, `series`, `docs` and `help` prints one JSON document to stdout and nothing else. Paths are relative to the site root.
- Errors and warnings go to stderr, and a failed command exits with 1.
- Outside a terminal there are no colors, file hyperlinks, banner or spinner animation.
- Nothing waits for an answer outside a terminal: `vg publish` needs a slug, and `vg skin remove` needs `--yes`.

```bash
vg list post -d --json                    # Draft posts
vg series --json                          # Series with post and draft counts
vg docs vergil-guide --json               # A book's chapter tree
vg help callout --json                    # One directive's full spec
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

- Node.js 24 or later (the newest LTS is recommended), for `vg` and for Vergil sites
- pnpm for Vergil sites; `vg init` also needs Git

## License

MIT

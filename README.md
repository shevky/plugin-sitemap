# Shevky Plugin: Sitemap

Generate `sitemap.xml` for Shevky sites. The plugin collects published pages, optionally includes paginated listings and configured collections, then writes the sitemap into `dist/sitemap.xml`.

## Features

- Builds `sitemap.xml` during `content:ready`
- Optional pagination URLs (when `seo.includePaging` is enabled)
- Optional collection URLs (when `seo.includeCollections` is enabled)
- Generates absolute URLs based on `identity.url`

## Installation

```bash
npm i @shevky/plugin-sitemap
```

## Usage

Add the plugin to your config:

```json
{
  "identity": {
    "url": "https://example.com"
  },
  "seo": {
    "includePaging": true,
    "includeCollections": true
  },
  "plugins": [
    "@shevky/plugin-sitemap"
  ]
}
```

The sitemap will be generated at:

```
dist/sitemap.xml
```

## License

MIT

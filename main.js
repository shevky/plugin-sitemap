import { i18n, plugin, format } from "@shevky/base";

const PLUGIN_NAME = "shevky-sitemap";
const PLUGIN_VERSION = "0.0.3";
const SITEMAP_FILENAME = "sitemap.xml";

const escape = (value) => format.escape(value ?? "");
const lastmod = (value) => format.lastMod(value) ?? new Date().toISOString();

const parseDate = (value) => (value ? Date.parse(String(value)) || 0 : 0);

const sortByLastmodDesc = (a, b) => {
  const aDate = a?.lastmod ? Date.parse(String(a.lastmod)) : NaN;
  const bDate = b?.lastmod ? Date.parse(String(b.lastmod)) : NaN;

  if (!Number.isNaN(aDate) && !Number.isNaN(bDate) && aDate !== bDate) {
    return bDate - aDate;
  }

  return (a?.loc || "").localeCompare(b?.loc || "");
};

const resolvePaginationSegment = (lang, config) => {
  const segmentConfig = config?.content?.pagination?.segment ?? {};
  if (typeof segmentConfig[lang] === "string" && segmentConfig[lang].trim()) {
    return segmentConfig[lang].trim();
  }

  if (typeof segmentConfig[i18n.default] === "string") {
    return segmentConfig[i18n.default].trim();
  }

  return "page";
};

const normalizeCollectionTypeValue = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const dedupeCollectionItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) return items;
  const seen = new Map();
  const order = [];
  items.forEach((item) => {
    const id = item?.id;
    if (!id) {
      order.push(item);
      return;
    }
    const existingIndex = seen.get(id);
    const hasSeriesTitle = Boolean(item?.seriesTitle);
    if (existingIndex == null) {
      seen.set(id, order.length);
      order.push(item);
      return;
    }
    const existing = order[existingIndex];
    const existingHasSeries = Boolean(existing?.seriesTitle);
    if (hasSeriesTitle && !existingHasSeries) {
      order[existingIndex] = item;
    }
  });
  return order;
};

const buildContentUrl = (canonical, lang, slug) => {
  if (typeof canonical === "string" && canonical.trim()) {
    return format.ensureDirectoryTrailingSlash(canonical.trim());
  }

  const normalizedLang = lang ?? i18n.default;
  const slugSegment = slug ? `/${slug}` : "/";
  if (normalizedLang !== i18n.default) {
    const langPath = `/${normalizedLang}${slugSegment}`.replace(/\/+/, "/");
    return format.ensureDirectoryTrailingSlash(langPath);
  }

  const normalizedSlug = slugSegment.replace(/\/+/, "/");
  return format.ensureDirectoryTrailingSlash(normalizedSlug);
};

const resolveUrl = (value, ctx) =>
  format.resolveUrl(value, ctx?.config?.identity?.url ?? "");

class SitemapBuilder {
  async build(ctx) {
    const pluginConfig = ctx.config.get(PLUGIN_NAME) ?? {};
    const sitemapFilename =
      typeof pluginConfig.sitemapFilename === "string" &&
      pluginConfig.sitemapFilename.trim().length > 0
        ? pluginConfig.sitemapFilename.trim()
        : SITEMAP_FILENAME;

    const includeCollections = Boolean(ctx?.config?.seo?.includeCollections);
    const entries = await this._collectContentEntries(ctx);
    const collectionEntries = includeCollections
      ? this._collectCollectionEntries(ctx)
      : [];

    const combined = [...entries, ...collectionEntries];
    if (!combined.length) {
      return;
    }

    const entryByLoc = this._mergeEntries(combined);
    const xml = this._renderSitemap(entryByLoc);
    await this._writeSitemap(ctx, xml, entryByLoc.length, sitemapFilename);
  }

  async _collectContentEntries(ctx) {
    const contentFiles = ctx?.contentFiles ?? [];
    if (!contentFiles.length) {
      return [];
    }

    const pages = ctx?.pages ?? {};
    const includePaging = Boolean(ctx?.config?.seo?.includePaging);
    const urls = [];

    for (const file of contentFiles) {
      if (!file?.isValid || file?.isDraft || !file?.isPublished) {
        continue;
      }

      const canonical =
        file.canonical ?? buildContentUrl(null, file.lang, file.slug);
      const absoluteLoc = resolveUrl(canonical, ctx);
      const updated = file.updated ?? file.date;
      const baseLastmod = lastmod(updated);

      urls.push({ loc: absoluteLoc, lastmod: baseLastmod });

      if (
        includePaging &&
        (file.template === "collection" || file.template === "home")
      ) {
        const langCollections = pages[file.lang] ?? {};
        const key =
          typeof file?.header?.listKey === "string"
            ? file.header.listKey
            : file?.header?.slug;
        const allItems =
          key && Array.isArray(langCollections[key])
            ? langCollections[key]
            : [];
        const pageSizeSetting = ctx?.config?.content?.pagination?.pageSize ?? 5;
        const pageSize = pageSizeSetting > 0 ? pageSizeSetting : 5;
        const totalPages = Math.max(
          1,
          pageSize > 0 ? Math.ceil(allItems.length / pageSize) : 1,
        );

        if (totalPages > 1) {
          const segment = resolvePaginationSegment(file.lang, ctx?.config);
          const baseSlug = (file.slug ?? "").replace(/\/+$/, "");

          let latestTimestamp = null;
          if (Array.isArray(allItems)) {
            allItems.forEach((item) => {
              if (!item) return;
              const ts = parseDate(item.updated ?? item.date);
              if (ts && (latestTimestamp == null || ts > latestTimestamp)) {
                latestTimestamp = ts;
              }
            });
          }

          const listingLastmod =
            latestTimestamp != null
              ? lastmod(new Date(latestTimestamp))
              : baseLastmod;

          for (let pageIndex = 2; pageIndex <= totalPages; pageIndex += 1) {
            const pageSlug = baseSlug
              ? `${baseSlug}/${segment}-${pageIndex}`
              : `${segment}-${pageIndex}`;

            let canonicalOverride;
            const canonicalSource =
              typeof file?.header?.canonical === "string"
                ? file.header.canonical
                : file.canonical;
            if (typeof canonicalSource === "string" && canonicalSource.trim()) {
              const trimmed = canonicalSource.trim().replace(/\/+$/, "");
              canonicalOverride = `${trimmed}/${segment}-${pageIndex}/`;
            }

            const pageCanonical = buildContentUrl(
              canonicalOverride,
              file.lang,
              pageSlug,
            );
            const pageAbsoluteLoc = resolveUrl(pageCanonical, ctx);
            urls.push({ loc: pageAbsoluteLoc, lastmod: listingLastmod });
          }
        }
      }
    }

    return urls;
  }

  _collectCollectionEntries(ctx) {
    const urls = [];
    const collectionsConfig = ctx?.config?.content?.collections ?? {};
    const pages = ctx?.pages ?? {};

    const configKeys = Object.keys(collectionsConfig).filter(
      (key) => key !== "includeContentFile",
    );
    for (const configKey of configKeys) {
      const entry = collectionsConfig[configKey];
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const slugPattern =
        entry.slugPattern && typeof entry.slugPattern === "object"
          ? entry.slugPattern
          : {};

      const rawTypes = Array.isArray(entry.types) ? entry.types : null;
      const types = rawTypes
        ? rawTypes
            .map((value) =>
              normalizeCollectionTypeValue(
                typeof value === "string" ? value : "",
              ),
            )
            .filter(Boolean)
        : null;

      if (!types || !types.length) {
        continue;
      }

      const languages = Object.keys(pages);
      for (const lang of languages) {
        const langCollections = pages[lang] ?? {};
        const langSlugPattern =
          typeof slugPattern[lang] === "string" ? slugPattern[lang] : null;

        const collectionKeys = Object.keys(langCollections);
        for (const key of collectionKeys) {
          const sourceItems = langCollections[key] ?? [];
          if (!Array.isArray(sourceItems) || sourceItems.length === 0) {
            continue;
          }

          const items = dedupeCollectionItems(sourceItems);
          if (items.length === 0) {
            continue;
          }

          const hasMatchingType = items.some((entryItem) =>
            types.includes(normalizeCollectionTypeValue(entryItem.type)),
          );
          if (!hasMatchingType) {
            continue;
          }

          const slug =
            langSlugPattern && langSlugPattern.includes("{{key}}")
              ? langSlugPattern.replace("{{key}}", key)
              : (langSlugPattern ?? key);

          const canonical = buildContentUrl(null, lang, slug);
          const absoluteLoc = resolveUrl(canonical, ctx);

          let latestTimestamp = null;
          items.forEach((item) => {
            if (!item) return;
            const ts = parseDate(item.updated ?? item.date);
            if (ts && (latestTimestamp == null || ts > latestTimestamp)) {
              latestTimestamp = ts;
            }
          });

          const entryLastmod =
            latestTimestamp != null
              ? lastmod(new Date(latestTimestamp))
              : lastmod();

          urls.push({ loc: absoluteLoc, lastmod: entryLastmod });
        }
      }
    }

    return urls;
  }

  _mergeEntries(entries) {
    const entryByLoc = new Map();
    entries.forEach((entry) => {
      if (!entry || !entry.loc) return;
      const key = entry.loc;
      const existing = entryByLoc.get(key);
      if (!existing) {
        entryByLoc.set(key, entry);
        return;
      }
      const existingDate = existing.lastmod
        ? Date.parse(String(existing.lastmod))
        : null;
      const incomingDate = entry.lastmod
        ? Date.parse(String(entry.lastmod))
        : null;
      if (
        incomingDate != null &&
        !Number.isNaN(incomingDate) &&
        (existingDate == null ||
          Number.isNaN(existingDate) ||
          incomingDate > existingDate)
      ) {
        entryByLoc.set(key, entry);
      }
    });

    return Array.from(entryByLoc.values()).sort(sortByLastmodDesc);
  }

  _renderSitemap(entries) {
    const urlset = entries
      .map((entry) => {
        const parts = ["  <url>", `    <loc>${escape(entry.loc)}</loc>`];
        if (entry.lastmod) {
          parts.push(`    <lastmod>${escape(entry.lastmod)}</lastmod>`);
        }
        parts.push("  </url>");
        return parts.join("\n");
      })
      .join("\n");

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<?xml-stylesheet type="text/xsl" href="/assets/sitemap.xsl"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      urlset,
      "</urlset>",
      "",
    ].join("\n");
  }

  async _writeSitemap(ctx, xml, count, sitemapFilename) {
    const relativePath = sitemapFilename;
    const targetPath = ctx.path.combine(ctx.paths.dist, relativePath);
    await ctx.directory.create(ctx.path.name(targetPath));
    await ctx.file.write(targetPath, xml);
    ctx.log.debug(`[${PLUGIN_NAME}] Sitemap has been created.`);
  }
}

const sitemapBuilder = new SitemapBuilder();

/** @type {import("@shevky/base").PluginHooks} */
const hooks = {
  [plugin.hooks.CONTENT_READY]: async function (ctx) {
    await sitemapBuilder.build(ctx);
  },
};

const PLUGIN = { name: PLUGIN_NAME, version: PLUGIN_VERSION, hooks };
export default PLUGIN;

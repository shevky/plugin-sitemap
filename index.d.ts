import type { PluginDefinition, PluginHooks } from "@shevky/base";

export type SitemapPluginConfig = {
  sitemapFilename?: string;
};

declare const plugin: PluginDefinition & { hooks: PluginHooks };

export default plugin;

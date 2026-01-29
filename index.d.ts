import type { PluginDefinition, PluginHooks } from "@shevky/base";

declare const plugin: PluginDefinition & { hooks: PluginHooks };

export default plugin;

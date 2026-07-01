# pageAssets capability

`tab.capabilities.pageAssets.list()` inventories resources visible to the page: images, fonts, stylesheets, videos, scripts, SVGs and DOM-discovered media.

`bundle()` should be implemented by streaming selected assets to the native host:

```text
asset_create -> asset_append_chunk* -> asset_finish
```

Do not put screenshots, DOM snapshots, or large asset bundles into one Native Messaging payload.

# Lume Browser

Lume Browser enables Agent control of the Lume Core in-app browser. It uses the
versioned Browser Broker contract and defaults to the `iab` backend. External
Chrome remains a separate, explicitly enabled `lume-chrome` capability.

The plugin never receives passwords, cookies, local file paths, raw CDP, or
arbitrary JavaScript. High-risk actions continue through Lume confirmation.

The packaged client is generated from the same compiled BrowserClient and shared
modules as `lume-chrome`; this plugin does not maintain a second client API.

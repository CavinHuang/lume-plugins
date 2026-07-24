# Lume Browser

Use the Lume in-app browser through the versioned Browser Broker. The default
backend is `iab`; choose external Chrome only when the user explicitly asks for
Chrome or a current Chrome tab and the separate `lume-chrome` plugin is enabled.

Keep passwords, cookies, OTPs, file paths, raw CDP and arbitrary JavaScript out
of Agent messages and tool output. Re-observe before every automatic action.
Ordinary navigation and the locked automatic click/input actions remain
available, while submit, send, delete, purchase, authorization, file,
clipboard, credential, CAPTCHA and payment actions require exact confirmation
or user handoff.

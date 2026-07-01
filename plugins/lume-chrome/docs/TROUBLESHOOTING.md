# Troubleshooting checklist

1. Chrome installed
2. Chrome running
3. Extension installed in the same profile the user is using
4. Extension enabled
5. Native Messaging manifest installed
6. Native host executable path exists
7. Extension ID matches manifest `allowed_origins`
8. Native host connects to Lume app server/sidecar
9. Debugger permission granted when a tab action starts
10. Browser session/turn id present

The popup should expose a compact status view and a diagnostic report.

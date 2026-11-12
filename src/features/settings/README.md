# settings

UI for hierarchical settings (#607): a value set on an enterprise or organization is inherited by the teams below it unless a team overrides it or a higher level locks it.

- `TeamSettingRow` is one team setting: the switch, where its value comes from, and reset-to-inherited.
- `TeamSettingsRows` is a team's settings as rows that save themselves; the Teams page's Settings tab and Settings → Team both render it.
- `TeamSettings` is Settings → Team: it edits the selected team (the header's, and `?team=`), with a picker over the teams you manage in the selected organization.
- `DefaultsCard` is the "defaults and locks" editor an organization or enterprise shows for what is below it.
- `settingsCopy.ts` holds the strings and the one place that words a setting's source.
- `SourcesCard` is one list of every ticket server a member can connect: the deployment's Redmine and the servers their orgs registered, each connected, checked and disconnected with their own key (#734).
- `settingsSections.ts` lists the Settings page's sections (its side nav, `?section=`) and `settingsPath()` links straight to one. The page itself is `src/ui/SettingsPage.tsx`.
- Values and sources come resolved from the server; nothing here applies a default.

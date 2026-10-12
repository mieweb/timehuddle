# settings

UI for hierarchical settings (#607): a value set on an enterprise or organization is inherited by the teams below it unless a team overrides it or a higher level locks it.

- `TeamSettingRow` is one team setting: the switch, where its value comes from, and reset-to-inherited.
- `DefaultsCard` is the "defaults and locks" editor an organization or enterprise shows for what is below it.
- `settingsCopy.ts` holds the strings and the one place that words a setting's source.
- Values and sources come resolved from the server; nothing here applies a default.

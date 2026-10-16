# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Zaptec chargers (Go, Go 2, Pro) in Gladys, through the official Zaptec cloud
  API: one device per charger with its connector status, charging state,
  detailed Zaptec status, charging power, current per phase, session energy
  and total energy (a meter index for the Gladys energy monitoring).
- A charge switch on each charger: off pauses the charge, on resumes a charge
  paused from Gladys or the Zaptec app.
- One device per installation the account has the rights on (owner or
  service), with its available current, adjustable from Gladys, and its
  maximum.
- A `cloud` / `unreachable` badge on each device, following its connection.
- Scene triggers _Vehicle plugged in_ and _Charging completed_, and the scene
  action _Control a Zaptec charge_ (pause, resume, end the session).
- The _Zaptec charger_ dashboard widget: status, power, session energy and the
  pause, resume and end-of-session buttons that fit the situation.
- A _Test the connection_ button in the configuration.
- The integration refreshes the devices itself every 1, 2 or 5 minutes,
  follows the Zaptec API fair use policy (documented endpoints only, a pause
  on HTTP 429) and keeps its login token in `/data`.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-zaptec/commits/main

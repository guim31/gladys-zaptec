# Zaptec for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for the **Zaptec
EV chargers** (Zaptec Go, Go 2 and Pro), through the official Zaptec cloud API
(`api.zaptec.com`) and the account of the Zaptec app and Zaptec Portal.

> **Developed without the hardware: feedback welcome.** No Zaptec charger nor
> account was available while writing it, and the Zaptec API could not be
> reached from the development environment: the API answers come from the
> open-source clients and the Zaptec documentation, and the integration was
> tested against a fake Zaptec cloud built from them. Please
> [open an issue](https://github.com/guim31/gladys-zaptec/issues) with what you
> see on a real charger.

## Features

- **One device per charger**: connector status and charging state (the Gladys
  5 _charging station_ vocabulary, aligned on OCPP), the detailed Zaptec
  status, charging power, current per phase, session energy, **total energy**
  (the signed meter index, which the Gladys 5.2 energy monitoring turns into a
  consumption).
- **Charge switch**: off pauses the charge, on resumes a charge paused from
  Gladys or the Zaptec app.
- **One device per installation** the account has the rights on (owner or
  service): the **available current** shared by its chargers, adjustable like
  in the app, and the installation maximum.
- **Online badge**: each charger shows the `cloud` transport, `unreachable`
  when Zaptec reports it offline.
- **Scene triggers**: _Vehicle plugged in_, _Charging completed_ (with the
  session energy).
- **Scene action**: _Control a Zaptec charge_ (pause, resume, end the session).
- **Dashboard widget**: one charger with its status, live tiles and the
  buttons that fit the situation.
- Texts in English, French, German and Spanish.

Not offered: **authorizing a charge** (the Zaptec app does it through an
internal endpoint, which Zaptec's fair use policy forbids to third parties),
unlocking the cable, restarting a charger, firmware updates.

## Requirements

- Gladys Assistant **5.1.0** or later (5.2 for the energy monitoring).
- A Zaptec account with access to the chargers; the owner or service rights to
  send commands and to set the available current. Internet access for Gladys.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and give
   `https://github.com/guim31/gladys-zaptec` (or install it from the store).
2. In its configuration, fill in the e-mail address and the password of the
   Zaptec account, the language of the device texts and the refresh interval,
   then **Test the connection**.
3. Add the chargers and the installation from the **Discovery** tab.

The full documentation is in [`docs/`](docs/en.md) ([en](docs/en.md),
[fr](docs/fr.md), [de](docs/de.md), [es](docs/es.md)).

## How it works

- **Account**: OAuth2 password grant, `POST /oauth/token`. The access token
  (about one day, no refresh token) is kept in `/data/zaptec-token.json`
  (mode 600) so a restart does not log in again; the password stays in the
  Gladys configuration. Refused credentials stop every request until the
  configuration is saved again: retrying could lock the account.
- **Discovery**: `GET /api/chargers`, then `GET /api/installation/{id}` for
  each installation of the chargers (403, or an empty 204, for a plain user:
  no installation device then). Each device is keyed on the Zaptec id.
- **Readings**: `GET /api/chargers/{id}/state` (the observations: operating
  mode 710, final stop 718, power 513, currents 507-509, session energy 553,
  signed meter value 554, completed session 723) for each added charger, once
  per refresh interval (1, 2 or 5 minutes); the installation every ten
  minutes. Nothing is read for a device the user did not add.
- **Refresh**: the container runs its own timer. The core does not poll
  external devices reliably (GladysAssistant/Gladys#3198, still in 5.2.1): the
  devices are published with `should_poll` and a one-minute frequency, and the
  core's `onPoll` is only a fallback, skipped while the timer keeps up.
- **Fair use**: Zaptec allows 10 requests per second per account, asks not to
  poll aggressively and forbids undocumented endpoints. The integration only
  calls documented endpoints, publishes only the changed values (plus a
  heartbeat every 6 hours), and on HTTP 429 pauses for the `Retry-After`
  delay, 5 minutes when Zaptec does not give one.
- **Commands**: `POST /api/chargers/{id}/sendCommand/{506|507|10001}` (pause,
  resume, end the session), checked first against Zaptec's own preconditions
  (506 only while charging, 507 only after a 506); and
  `POST /api/installation/{id}/update` (`availableCurrent`). The device is
  read again 10 seconds later. Zaptec answers 500 to 10001 although it carries
  it out: that answer is accepted and checked by the next reading.
- **No real-time stream**: Zaptec also pushes the observations over Azure
  Service Bus. It is not used: it needs a heavy client, could not be tested
  against the real service, and polling is enough for the states and triggers
  above. See [`CLAUDE.md`](CLAUDE.md).

## Limitations

- Developed and tested without the hardware nor an account (see above).
- Cloud only; nothing works without internet or when the Zaptec cloud is down.
- The state is up to one refresh interval old; the total energy is signed by
  the charger about once an hour.
- No "authorize charge" (see above), no error state (the API exposes no fault
  mode a third party can rely on).
- Not handled: charger maximum current, phase switching, schedules, Zaptec
  Sense, cable lock.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory Zaptec cloud (`test/helpers/fakeZaptec.js`) serving the
fixtures of `test/fixtures/zaptec/`. `test/gladys-rules.test.js` checks every
device against the feature table of the Gladys core.

`node scripts/probe.mjs` checks the observation, mode and command numbers
against the public `GET /api/constants`, then runs the real login with an
invented account and checks Zaptec refuses it; with `ZAPTEC_USERNAME` and
`ZAPTEC_PASSWORD` set, it reads (GET only) a real account and prints the shape
of the answers, without ids, serial numbers, names or tokens.

Releases go through **Actions → Release**, which bumps the versions, rolls
[`CHANGELOG.md`](CHANGELOG.md) and builds the image. The hand-pushed tag path
of the template (`git tag vX.Y.Z && git push --tags`) still works, but only
after bumping `version` in `package.json` and in the manifest, with its
`docker_image` tag. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [Zaptec for Home Assistant](https://github.com/custom-components/zaptec) by
  Hellowlol, Svein Seldal and contributors (MIT): the endpoints, the
  observations used, the command preconditions, the OCMF meter reading, the
  model prefixes and the anonymized real messages behind the fixtures.
- [evcc](https://github.com/evcc-io/evcc), read only (its Zaptec module is not
  under an open licence, no code was copied): the numbers of the observations
  and commands.
- The Zaptec developer documentation: the command ids, their preconditions and
  the API fair use policy.
- The architecture and the conformity tests follow
  [gladys-easee](https://github.com/guim31/gladys-easee),
  [gladys-wled](https://github.com/guim31/gladys-wled) and
  [gladys-subsonic](https://github.com/guim31/gladys-subsonic).

## Disclaimer

This project is **not affiliated with Zaptec**, nor endorsed or sponsored by
Zaptec ASA. "Zaptec" is a trademark of its owner.

## License

[Apache-2.0](LICENSE)

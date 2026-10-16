# Zaptec API fixtures

The session that wrote this integration had no network access to
`api.zaptec.com` (refused by its proxy), and no Zaptec account. These answers
are therefore **reconstructed**, not recorded, from public sources:

- the Home Assistant integration
  [custom-components/zaptec](https://github.com/custom-components/zaptec) (MIT):
  its API client (`zaptec/api.py`, `zaptec/validate.py`), and the anonymized
  real messages of its tests (`tests/zaptec/test_utils.py`: observation 554
  as an OCMF string, `tests/zaptec/test_validate.py`: the state list format);
- the observation, command and operating mode numbers of the Zaptec API
  (`GET /api/constants`), as evcc lists them (`charger/zaptec/const.go`, read
  for the numbers only: that module is not under the MIT license);
- the Zaptec developer documentation (command ids 506, 507 and 10001, their
  preconditions, the fair use policy).

Every identifier is invented: UUIDs `00000000-0000-4000-8000-…`, serial
numbers `ZAP000101` and `ZPR000202`, no real name or address.

| File                              | What it is                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `token-ok.json`                   | `POST /oauth/token` accepted (the fake replaces the token)                                   |
| `token-refused.json`              | `POST /oauth/token` refused (HTTP 400, `invalid_grant`)                                      |
| `chargers.json`                   | `GET /api/chargers`: a Zaptec Go (owner) and a Zaptec Pro (plain user, another installation) |
| `installation.json`               | `GET /api/installation/{id}` of the Go's installation (40 A fuse, 25 A available)            |
| `charger-state-charging.json`     | `GET /api/chargers/{id}/state`: charging on three phases, about 10.9 kW                      |
| `charger-state-requesting.json`   | vehicle plugged in, waiting (mode 2)                                                         |
| `charger-state-paused.json`       | paused by a command (mode 5, FinalStopActive 1)                                              |
| `charger-state-completed.json`    | ended by the vehicle (mode 5, FinalStopActive 0)                                             |
| `charger-state-disconnected.json` | no vehicle (mode 1), the Pro                                                                 |
| `charger-state-offline.json`      | the Go offline (IsOnline 0)                                                                  |

`scripts/probe.mjs` confronts them with the real API from a machine that has
the network: run it, then fix these files and the code where they differ.

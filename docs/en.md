# Zaptec

## Overview

This integration brings your **Zaptec EV chargers** (Zaptec Go, Go 2 and Pro) into Gladys, through the **official Zaptec cloud API** (`api.zaptec.com`), with the account of the Zaptec app and Zaptec Portal.

- Each charger becomes a Gladys device: connector status, charging state, detailed status, power, current per phase, session energy, total energy, and a charge switch (pause / resume).
- Each installation you have the rights on (owner or service) becomes a device with its **available current**, the limit shared by its chargers, adjustable from Gladys like in the app.
- The total energy of a charger is a meter index: the energy monitoring of Gladys 5.2 turns it into a consumption every 30 minutes.
- A dashboard widget, two scene triggers and a scene action complete it.

This integration is not affiliated with Zaptec. It was developed without the hardware: feedback is welcome on the [GitHub repository](https://github.com/guim31/gladys-zaptec/issues).

## Requirements

- Gladys Assistant 5.1.0 or later (5.2 for the energy monitoring of the total energy).
- A Zaptec account (the one of the Zaptec app or of [Zaptec Portal](https://portal.zaptec.com)) with access to the chargers.
- To pause, resume or end a charge: the **owner** or **service** rights on the charger. To change the available current: the same rights on the installation, Zaptec Sense (automatic power management) and stand-alone mode turned off.
- The chargers connected to the internet (Wi-Fi, 4G or Ethernet), and Gladys too: everything goes through the Zaptec cloud.

## Configuration

1. In Gladys, open **Integrations**, install **Zaptec**, then open its configuration.
2. Fill in the **e-mail address** and the **password** of the Zaptec account.
3. Choose the **language of the device texts**: the names of the features (set when you add a device) and the detailed status of the chargers. French by default.
4. Choose the **refresh interval**: 1, 2 (default) or 5 minutes.
5. Save, then press **Test the connection**: the message lists the chargers and the installations whose current you can set.
6. Open the **Discovery** tab and add the devices you want.

How the integration talks to Zaptec:

- It logs in with the password (OAuth2 "password" grant), then keeps the access token (valid about one day) in its private `/data` volume. The password stays in the Gladys configuration and is never written in the logs.
- **Zaptec's API fair use policy** caps an account at 10 requests per second and asks not to poll aggressively; it also forbids the internal endpoints of the Zaptec app. The integration only uses documented endpoints, reads the state of each added charger once per interval (1 to 5 minutes), the installation every ten minutes, and nothing for the devices you did not add. On HTTP 429 it pauses for the delay Zaptec asks (5 minutes otherwise).
- If Zaptec refuses the credentials, the integration stops trying until you save the configuration again, so the account is not locked by repeated attempts.

## Devices

### Charger

| Feature            | Type in Gladys              | Content                                                                                    |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------------------ |
| Connector          | Charging station, connector | Available (no vehicle), occupied (vehicle plugged in), unavailable (offline)               |
| Charging state     | Charging station, charging  | Charging, vehicle connected, paused by the vehicle, paused by the charger, idle            |
| Zaptec status      | Text                        | No vehicle, vehicle plugged in (waiting), charging, charging paused, charging completed... |
| Charging power     | Power (W)                   | Power delivered to the vehicle                                                             |
| Current L1, L2, L3 | Current (A)                 | Current of each phase                                                                      |
| Session energy     | Energy added (kWh)          | Energy of the session in progress, or of the last one                                      |
| Total energy       | Index (kWh)                 | Signed meter of the charger (sent by the charger about once an hour)                       |
| Charging           | Charge switch, control      | Off: pause the charge. On: resume a charge paused from Gladys or the app                   |

The charger is also shown with a **cloud** badge, which turns to **unreachable** when the charger is offline: the connector then reads "unavailable" and the status "Offline".

**Charging paused** is a pause sent from Gladys or the Zaptec app (the cable stays plugged in, the charger may unlock it). **Charging completed** means the vehicle stopped by itself (full battery, its own schedule): Zaptec cannot resume it, unplug and plug again.

### Installation

| Feature              | Type in Gladys              | Content                                                                  |
| -------------------- | --------------------------- | ------------------------------------------------------------------------ |
| Available current    | Target current (A), control | Current all the chargers of the installation may draw, on all the phases |
| Installation maximum | Current (A)                 | The rating of the installation (its fuse), the upper bound of the above  |

The installation only appears when the account may read it (owner or service). Zaptec recommends not changing the available current more than once every 15 minutes: many vehicles dislike frequent changes. Setting 0 A stops every charger of the installation.

## Widget

The **Zaptec charger** widget shows one charger: charging power and session energy as live tiles, the Zaptec status and the connection, and the buttons that fit the situation:

- while charging: **Pause** and **End session**;
- paused from Gladys or the app: **Resume** and **End session**;
- vehicle plugged in, waiting or charge completed: **End session**;
- no vehicle or charger offline: no button.

**End session** asks for a confirmation: it stops the charge and withdraws the authorization of the session. Choose the charger in the widget settings.

## Scene triggers and action

### Triggers

- **Vehicle plugged in**: a vehicle was plugged into a charger that had none. Variable: the charger name.
- **Charging completed**: the vehicle stopped taking current by itself (full battery or its own limit) and is still plugged in. A pause sent from Gladys or the app does not fire it. Variables: the charger name, the session energy in kWh.

Both are detected at each reading, so within one refresh interval. A charger coming back online with a vehicle already plugged in does not fire **Vehicle plugged in**. Each trigger can be limited to one charger. They exist because the scene editor offers no list for the charging station states.

### Action

**Control a Zaptec charge** pauses or resumes the charge of a charger, or ends the session. Its output is the Zaptec command sent (`stop_charging_final`, `resume_charging` or `deauthorize_and_stop`). Zaptec only accepts a pause while charging and a resume after a pause: in other cases the action fails with a message that says why.

The controllable features (charging, available current) can also be set by the standard **Control a device** action of Gladys.

## Scene examples

- **Off-peak charging**: trigger **Vehicle plugged in** → wait 2 minutes → if the time is between 7:00 and 22:00, **Control a Zaptec charge** "Pause"; every day at 22:00, "Resume".
- **Reminder**: every weekday at 21:00, if the **Connector** of the charger is "available" (no vehicle), send the message "The car is not plugged in".
- **Welcome home**: trigger **Vehicle plugged in** → turn on the garage light for 5 minutes.
- **End of charge**: trigger **Charging completed** → send "Charge done: `{{triggerEvent.data.session_energy}}` kWh on `{{triggerEvent.data.charger_name}}`".
- **Load shedding**: when the house power goes above 9000 W (measured by another integration), set the **Available current** of the installation to 10 A; back below 6000 W, set it to 25 A.

## Troubleshooting

- **"Zaptec refused the e-mail address and password"**: check them on Zaptec Portal, then save the configuration again (the integration does not retry before that).
- **"Cannot reach the Zaptec cloud"**: Gladys has no internet access, or the Zaptec cloud is down. The integration retries at each interval and says when it works again.
- **A charger stays "unavailable"**: the charger itself is offline for Zaptec. Check it in the Zaptec app.
- **No installation device**: the account has neither the owner nor the service rights on the installation. The chargers still work.
- **"The Zaptec account lacks the rights"**: a command or the available current needs owner or service rights; ask the owner of the installation in Zaptec Portal.
- **"Only a paused charge can resume"**: Zaptec resumes only a charge paused by a command. A charge ended by the vehicle, by its schedule or by 0 A available does not resume from the charger.
- **The charge does not start when the vehicle is plugged in**: with authorization required (RFID or app), authorize it in the Zaptec app; Gladys cannot (see Limitations).
- **Too many requests**: other tools use the same Zaptec account at the same time. Choose a longer refresh interval.
- **Total energy does not move**: the charger signs its meter about once an hour; the session energy moves during the charge.
- **Detailed logs**: in the container settings, set `LOG_LEVEL=debug`. A normal reading writes nothing at the default level.

## Limitations

- Developed without the hardware: the answers of the Zaptec API come from the open-source clients (Home Assistant), not from a real charger. Feedback is welcome.
- Cloud only: no local connection to the charger, nothing works without internet.
- No real-time stream: the state is read every 1, 2 or 5 minutes, and once more 10 seconds after a command. Zaptec's real-time channel (Service Bus) is not used.
- **No "authorize charge"**: the Zaptec app does it through an internal endpoint, and Zaptec's fair use policy forbids internal endpoints to third parties. Authorize from the Zaptec app, by RFID, or turn authorization off for the installation.
- No error state: the Zaptec API reports no fault mode a third party can read reliably.
- Not handled: charger maximum current, phase switching, charging schedules, Zaptec Sense, cable lock, restart and firmware update. Unlocking the cable is deliberately not offered.

# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes, in
particular:

- the Zaptec credentials: the e-mail address and the password live in the
  Gladys configuration, are only sent to `https://api.zaptec.com/oauth/token`,
  and must never reach the logs;
- the Zaptec token: the access token is kept in `/data/zaptec-token.json`
  (readable by the container user only), tagged with a hash of the account,
  never with the address itself. There is no refresh token: an expired token
  means a new login;
- the network: the container only talks to Gladys and to `api.zaptec.com`
  over HTTPS; it opens no port;
- the commands: the integration can pause, resume and end a charge, and change
  the available current of an installation. It never unlocks the cable,
  never restarts a charger or updates its firmware, and never calls the
  internal (undocumented) endpoints of the Zaptec app.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Zaptec cloud, app and chargers (report those to Zaptec).

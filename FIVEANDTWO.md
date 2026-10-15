# 5and2 integration context

This fork (`5und2/FreeShow`) adds a `fiveandtwo` content provider. It connects FreeShow to 5and2 and imports its run-of-show and songs.

## What 5and2 is

5and2 is a church app for planning events, groups, songs, and the run-of-show of a service. It runs at `https://5and2.app`, and one origin serves every organisation. The source is in `5und2/5and2app`.

Treat `5und2/5and2app` as a read-only reference. Never commit to it, never open pull requests against it, and never copy FreeShow code into it. The 5and2 side of this integration is already merged:

- [5und2/5and2app#318](https://github.com/5und2/5and2app/pull/318) adds device tokens and the v1 presentation sync API.
- [5und2/5and2app#323](https://github.com/5und2/5and2app/pull/323) adds OAuth 2.0 with PKCE, so FreeShow connects with one click.

The design decision is ADR-054 in the 5and2 agent wiki.

## Presentation sync API v1

The API is read-only, except for slide reports. It is served under `/api/presentation/v1` on the organisation's origin. Every request carries `Authorization: Bearer <token>`. A missing, unknown, or revoked token gets `401` with `WWW-Authenticate: Bearer realm="5and2"`. The response never says which of those it was.

| Method and path | Purpose |
| --- | --- |
| `GET /plans?days=N` | The events of the next `N` days (1 to 28, default 7) as one plans document. Sends an `ETag`. A matching `If-None-Match` gets `304`. A bad `days` gets `422`. |
| `GET /events/{id}/live` | Server-sent events for one event. `404` for an unknown event. `429` with `Retry-After: 30` when the device has too many open streams. |
| `POST /events/{id}/live` | Reports the slide the device shows. Body `{ "slide": { "songVersionId", "partId", "slideIndex" } }` or `{ "slide": null }`. Answers `204`. A song version that is not in the plan gets `422`. |

The plans document has `schema: "presentation/v1"`, an `organisation` (`name`, `ccliLicenseNumber`), `events`, and `songs`:

- An event has `id`, `title`, `startsAt`, `endsAt`, `timezone`, and an `agenda` in play order. The order is each section, then the rows inside it.
- An agenda row has `kind` `section`, `item`, or `song`, plus `parentId`, `title`, times, and `durationMinutes`. A `song` row names a `songVersionId` and the `key` this event plays it in.
- A song version has `parts` (`p1`, `p2`, and so on), each with a `label` and `slides`. A slide is a list of lines with `lyrics` and `chordPro`. The `sequence` lists part ids in the order they are sung, and a part can recur. The text of a version never changes. An edit in 5and2 makes a new version id. `changeToken` differs whenever anything in the version differs.

The live stream sends three frame types. Each frame replaces the consumer's copy, so a reconnect works like a first connect:

- `plan` carries a plans document with exactly one event.
- `cursor` carries `{ eventId, agendaItemId, source }`. `source` is `leader` when somebody moved the cursor, or `clock` when it follows the agenda times.
- `end` carries `{ reason: "revoked" | "gone" }`. Reconnecting does not help after it.

A device sees only events that every member of the organisation sees. Events of confidential groups never appear.

Inside v1, 5and2 only adds fields. It never renames, retypes, or removes one. A breaking change gets a new path and a new `schema` literal.

## Connect FreeShow with OAuth and PKCE

FreeShow is the public OAuth client `freeshow`. The flow is the authorization code grant with PKCE (RFC 7636, `S256` only) and a loopback redirect (RFC 8252 section 7.3). It is the same pattern as FreeShow's OnStage provider.

| Endpoint | Path |
| --- | --- |
| Consent page (browser) | `GET /connect/presentation` |
| Token | `POST /api/presentation/v1/oauth/token` |
| Revoke | `POST /api/presentation/v1/oauth/revoke` |

The flow runs in five steps:

1. FreeShow starts a listener on `http://localhost:5504/auth/complete`. 5and2 accepts `localhost` or `127.0.0.1`, any port from 1024 to 65535, and only the path `/auth/complete`, spelled canonically.
2. FreeShow opens `/connect/presentation?client_id=freeshow&redirect_uri=…&response_type=code&code_challenge=…&code_challenge_method=S256&state=…` in the browser.
3. An organisation admin, meaning a person with the `tenant:manage` permission, sees which organisation FreeShow connects to and clicks **Verbinden**. A logged-out visitor logs in first. A non-admin sees a notice and cannot connect. **Abbrechen** redirects with `error=access_denied`.
4. 5and2 redirects to the loopback URL with `code` and `state`. The code is single-use and expires after 10 minutes.
5. FreeShow posts `grant_type=authorization_code`, `code`, `client_id`, `redirect_uri`, and `code_verifier` to the token endpoint, as JSON or as a form.

A successful token response has `Cache-Control: no-store` and this body:

```json
{ "access_token": "…", "token_type": "Bearer", "scope": "presentation", "api_base_url": "https://5and2.app/api/presentation/v1" }
```

`presentation` is the only scope. There is no refresh token and no `expires_in`. The access token is a device token, and it stops working after 90 days without a request. A `401` means the user connects again. A failed exchange returns one of `invalid_request`, `invalid_grant`, `unsupported_grant_type`, or `invalid_client`. Every mismatch of code, redirect, or verifier is `invalid_grant`, and the code is consumed even when the verifier is wrong.

The revoke endpoint takes `{ "token": "…" }` (RFC 7009) and always answers `200`. The connection appears as "FreeShow" in the 5and2 device list under **Einstellungen > Präsentation verbinden**. An admin can disconnect it there. An admin can also create a device token by hand on that page and paste it.

## Where things live in 5und2/5and2app

| Path | Contents |
| --- | --- |
| `libs/modules/presentation/src/wire.ts` | The wire contract in zod: `PRESENTATION_OAUTH`, the token response, the plans document, live frames, and the slide report. The source of truth for `src/electron/contentProviders/fiveAndTwo/wire.ts`. |
| `libs/modules/presentation/src/__fixtures__/plans-v1.example.json` | The shared contract example. FreeShow keeps a copy for its tests. |
| `libs/modules/presentation/src/lib/oauth.ts` | The client registry, the loopback redirect rule, and the authorize and token request schemas. |
| `libs/modules/presentation/src/lib/pkce.ts` | The S256 check. |
| `libs/modules/presentation/src/server/oauth.ts` | Code storage, code exchange, and revocation. |
| `libs/modules/presentation/src/server/devices.ts` | Device tokens: mint, authenticate, and revoke. |
| `libs/modules/presentation/src/server/sync.ts` | Builds the plans document and the live stream. |
| `app/api/presentation/v1/` | The REST routes: `plans`, `events/[id]/live`, `oauth/token`, and `oauth/revoke`. |
| `app/api/presentation/oauth/authorize/route.ts` | The session-only endpoint that the consent page posts to. FreeShow never calls it. |
| `app/(app)/connect/presentation/page.tsx` | The consent page. |
| `app/(app)/(modules)/settings/presentation/` | The device list and the dialog for a pasted token. |
| `supabase/migrations/233_presentation_devices.sql`, `260_presentation_oauth_codes.sql` | The tables. |
| `e2e/presentation-devices.spec.ts` | The end-to-end tests for both flows. |

## Where things live in this fork

| Path | Contents |
| --- | --- |
| `src/electron/contentProviders/fiveAndTwo/connect.ts` | The PKCE flow, token storage, revoke on disconnect, and the HTTP helper. |
| `src/electron/contentProviders/fiveAndTwo/request.ts` | Fetches `/plans?days=28`. On a `401` it forgets the token and asks the user to connect again. |
| `src/electron/contentProviders/fiveAndTwo/mapping.ts` | A pure mapping from a plans document to FreeShow shows and projects. |
| `src/electron/contentProviders/fiveAndTwo/wire.ts` | The wire types without zod, because FreeShow does not depend on zod. |
| `src/electron/contentProviders/fiveAndTwo/mapping.test.ts` | Parses the contract example and checks the mapping. |

The provider makes one project per event, with id `fiveandtwo_<eventId>`, in a folder named after the organisation. It makes one show per song version, with id `fiveandtwosong_<songVersionId>`. Sections and items become project sections. A song's parts become groups, and its `sequence` becomes the layout. Slides show `lyrics` without chords.

Set `FIVEANDTWO_URL` to point FreeShow at another 5and2 origin, for example `http://localhost:3000` for a local dev server.

The live stream, slide reports, `ETag` caching, and chords are not built yet.

This fork is meant to become a pull request to `ChurchApps/FreeShow`. Open that pull request only when the maintainer asks for it.

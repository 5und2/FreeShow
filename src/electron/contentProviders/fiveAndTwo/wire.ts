/**
 * The 5and2 presentation sync API, wire contract v1, as plain types.
 * Mirrors libs/modules/presentation/src/wire.ts in 5und2/5and2app. That file is zod-based, and
 * FreeShow does not depend on zod, so the shape is repeated here and checked once at the boundary.
 * Inside v1 fields are only ever added, so unknown keys are ignored.
 */

export const PRESENTATION_SCHEMA = "presentation/v1"

export const PRESENTATION_OAUTH = {
    clientId: "freeshow",
    authorizePath: "/connect/presentation",
    tokenPath: "/api/presentation/v1/oauth/token",
    revokePath: "/api/presentation/v1/oauth/revoke",
    redirectPath: "/auth/complete"
} as const

/** There is no refresh token and no expires_in. The token stops working after 90 days without a request. */
export type OAuthTokenResponse = {
    access_token: string
    token_type: "Bearer"
    scope: string
    /** The presentation API root on the organisation's origin, e.g. https://5and2.app/api/presentation/v1 */
    api_base_url: string
}

export type WireLine = { lyrics: string; chordPro: string }

export type WireSongPart = {
    /** p1, p2, … Stable for a song version. */
    id: string
    label: string | null
    /** Empty for an instrumental. */
    slides: WireLine[][]
}

export type WireSongVersion = {
    /** A version's text never changes: an edit in 5and2 is a new id. */
    id: string
    songId: string
    title: string
    author: string | null
    ccliNumber: string | null
    versionLabel: string | null
    versionNumber: number
    key: string | null
    /** Empty when the version is only a file (a PDF lead sheet). */
    parts: WireSongPart[]
    /** Part ids in the order they are sung. A part can recur. */
    sequence: string[]
    changeToken: string
}

type WireRowBase = {
    id: string
    parentId: string | null
    title: string
    startsAt: string
    endsAt: string
    durationMinutes: number | null
}

export type WireAgendaRow = (WireRowBase & { kind: "section" }) | (WireRowBase & { kind: "item" }) | (WireRowBase & { kind: "song"; song: { songVersionId: string; key: string | null } })

export type WireEvent = {
    id: string
    title: string
    startsAt: string
    endsAt: string
    timezone: string
    /** The run-of-show in the order it is played: each section, then the rows inside it. */
    agenda: WireAgendaRow[]
}

export type PlansDocument = {
    schema: typeof PRESENTATION_SCHEMA
    organisation: { name: string; ccliLicenseNumber: string | null }
    events: WireEvent[]
    /** Every song version an agenda row names, once each. */
    songs: WireSongVersion[]
}

/** Rejects a document of another schema version or without its top-level shape. */
export function parsePlansDocument(input: any): PlansDocument | null {
    if (input?.schema !== PRESENTATION_SCHEMA) return null
    if (!input.organisation || !Array.isArray(input.events) || !Array.isArray(input.songs)) return null
    return input as PlansDocument
}

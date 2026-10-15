import { ContentProvider } from "../base/ContentProvider"
import { FIVEANDTWO_PORT, FIVEANDTWO_URL, fiveAndTwoAccess, fiveAndTwoConnect, fiveAndTwoDisconnect, type FiveAndTwoScopes } from "./connect"
import { fiveAndTwoLoadServices } from "./request"

export type { FiveAndTwoScopes } from "./connect"

type FiveAndTwoAuthDataResolved = {
    access_token: string
    refresh_token: string
    token_type: "Bearer"
    created_at: number
    expires_in: number
    scope: FiveAndTwoScopes
}

/**
 * 5and2 (church planning app) provider: OAuth with PKCE as the public client "freeshow", then the
 * read-only presentation sync API v1. See FIVEANDTWO.md at the repository root.
 */
export class FiveAndTwoProvider extends ContentProvider<FiveAndTwoScopes, FiveAndTwoAuthDataResolved> {
    constructor() {
        super({
            providerId: "fiveandtwo",
            displayName: "5and2",
            port: FIVEANDTWO_PORT,
            clientId: "freeshow",
            clientSecret: "", // public client, PKCE only
            apiUrl: FIVEANDTWO_URL,
            scopes: ["presentation"] as const
        })
    }

    isConnected(scope: FiveAndTwoScopes): boolean {
        return !!fiveAndTwoAccess(scope)
    }

    // The token never expires on a clock, so there is no refresh: the base class token fields are not used.
    async connect(scope: FiveAndTwoScopes): Promise<FiveAndTwoAuthDataResolved | null> {
        const access = await fiveAndTwoConnect(scope)
        return access ? ({ ...access, refresh_token: "", expires_in: 0 } as FiveAndTwoAuthDataResolved) : null
    }

    disconnect(scope: FiveAndTwoScopes = "presentation"): void {
        fiveAndTwoDisconnect(scope)
    }

    apiRequest(): Promise<any> {
        // Not used: request.ts owns the presentation API calls.
        return Promise.resolve(null)
    }

    // `data` carries an eventId when one project is refreshed.
    async loadServices(data?: { eventId?: string }): Promise<void> {
        return fiveAndTwoLoadServices(data)
    }

    async startupLoad(scope: FiveAndTwoScopes): Promise<void> {
        if (!fiveAndTwoAccess(scope)) return
        return fiveAndTwoLoadServices()
    }

    protected handleAuthCallback(): void {
        // Not used: connect.ts runs its own loopback listener.
    }

    // There is no refresh token: a 401 means connecting again.
    protected refreshToken(): Promise<null> {
        return Promise.resolve(null)
    }
    protected authenticate(): Promise<null> {
        return Promise.resolve(null)
    }
}

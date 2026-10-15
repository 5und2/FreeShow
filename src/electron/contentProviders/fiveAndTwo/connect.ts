/**
 * WARNING: This file should ONLY be accessed through FiveAndTwoProvider.
 * Use ContentProviderRegistry or FiveAndTwoProvider instead.
 */

import express from "express"
import http from "http"
import https from "https"

import { ToMain } from "../../../types/IPC/ToMain"
import { getContentProviderAccess, setContentProviderAccess } from "../../data/contentProviders"
import { sendToMain } from "../../IPC/main"
import { openURL } from "../../IPC/responsesMain"
import { PKCEHelper } from "../base/OAuth2Helper"
import { PRESENTATION_OAUTH, type OAuthTokenResponse } from "./wire"

export type FiveAndTwoScopes = "presentation"
export type FiveAndTwoAuthData = OAuthTokenResponse & { scope: FiveAndTwoScopes; created_at: number }

export const FIVEANDTWO_URL = process.env.FIVEANDTWO_URL || "https://5and2.app"
export const FIVEANDTWO_PORT = 5504
const AUTH_FLOW_TIMEOUT_MS = 10 * 60 * 1000

const HTML_RESULT = (title: string, message: string) => `
    <head><title>${title}</title></head>
    <body style="padding: 80px;background: #242832;color: #f0f0ff;font-family: system-ui;font-size: 1.2em;">
        <h1 style="color: #f0008c;">${title}</h1>
        <p>${message}</p>
    </body>
`

export class FiveAndTwoHttpError extends Error {
    constructor(
        readonly status: number,
        body: string
    ) {
        super(`HTTP ${status}: ${body}`)
    }
}

export type FiveAndTwoResponse = { status: number; etag: string | undefined; body: any }

/** http as well as https, so a local 5and2 dev server (FIVEANDTWO_URL=http://localhost:3000) works. A 304 resolves with a null body. */
export function fiveAndTwoFetch(url: string, options: { method?: "GET" | "POST"; token?: string; body?: object; ifNoneMatch?: string } = {}): Promise<FiveAndTwoResponse> {
    const target = new URL(url)
    const body = options.body ? JSON.stringify(options.body) : ""
    const client = target.protocol === "http:" ? http : https

    return new Promise((resolve, reject) => {
        const request = client.request(
            target,
            {
                method: options.method || "GET",
                headers: {
                    Accept: "application/json",
                    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
                    ...(options.ifNoneMatch ? { "If-None-Match": options.ifNoneMatch } : {}),
                    ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {})
                },
                timeout: 30000
            },
            (response) => {
                let data = ""
                response.on("data", (chunk) => (data += chunk))
                response.on("end", () => {
                    const status = response.statusCode || 0
                    if (status >= 400) return reject(new FiveAndTwoHttpError(status, data))
                    try {
                        resolve({ status, etag: response.headers.etag, body: data ? JSON.parse(data) : null })
                    } catch (err) {
                        reject(err)
                    }
                })
            }
        )
        request.on("timeout", () => request.destroy(new Error("Request timed out")))
        request.on("error", reject)
        if (body) request.write(body)
        request.end()
    })
}

export function fiveAndTwoAccess(scope: FiveAndTwoScopes = "presentation"): FiveAndTwoAuthData | null {
    return getContentProviderAccess("fiveandtwo", scope)
}

// Two concurrent flows would each open a tab with its own verifier, so all callers share one.
let pendingAuthentication: Promise<FiveAndTwoAuthData | null> | null = null
let pendingAuthUrl = ""

function authenticate(scope: FiveAndTwoScopes): Promise<FiveAndTwoAuthData | null> {
    if (pendingAuthentication) {
        if (pendingAuthUrl) openURL(pendingAuthUrl)
        return pendingAuthentication
    }
    pendingAuthentication = startAuthentication(scope).finally(() => {
        pendingAuthentication = null
        pendingAuthUrl = ""
    })
    return pendingAuthentication
}

function startAuthentication(scope: FiveAndTwoScopes): Promise<FiveAndTwoAuthData | null> {
    const redirectUri = `http://localhost:${FIVEANDTWO_PORT}${PRESENTATION_OAUTH.redirectPath}`
    const codeVerifier = PKCEHelper.generateCodeVerifier()
    const state = PKCEHelper.generateCodeVerifier()

    const app = express()

    return new Promise((resolve) => {
        let settled = false
        const finish = (result: FiveAndTwoAuthData | null) => {
            if (settled) return
            settled = true
            clearTimeout(abandonTimer)
            server.close()
            resolve(result)
        }
        const abandonTimer = setTimeout(() => finish(null), AUTH_FLOW_TIMEOUT_MS)

        const server = app.listen(FIVEANDTWO_PORT)
        server.once("error", (err: Error & { code?: string }) => {
            if (err.code === "EADDRINUSE") sendToMain(ToMain.ALERT, `Port ${FIVEANDTWO_PORT} is in use, could not connect to 5and2`)
            finish(null)
        })

        app.get(PRESENTATION_OAUTH.redirectPath, async (req, res) => {
            res.setHeader("Content-Type", "text/html")
            const code = req.query.code?.toString()
            if (!code || req.query.state !== state) {
                res.send(HTML_RESULT("Not connected", "5and2 was not connected. You can close this page."))
                return finish(null)
            }

            try {
                const { body: token }: { body: OAuthTokenResponse } = await fiveAndTwoFetch(FIVEANDTWO_URL + PRESENTATION_OAUTH.tokenPath, {
                    method: "POST",
                    body: { grant_type: "authorization_code", code, client_id: PRESENTATION_OAUTH.clientId, redirect_uri: redirectUri, code_verifier: codeVerifier }
                })
                const access: FiveAndTwoAuthData = { ...token, scope, created_at: Math.floor(Date.now() / 1000) }
                setContentProviderAccess("fiveandtwo", scope, access)
                res.send(HTML_RESULT("Success!", "You can close this page"))
                sendToMain(ToMain.PROVIDER_CONNECT, { providerId: "fiveandtwo", success: true, isFirstConnection: true })
                finish(access)
            } catch (err: any) {
                res.send(HTML_RESULT("Could not complete authentication!", String(err?.message)))
                sendToMain(ToMain.ALERT, "Could not authorize! " + String(err?.message))
                finish(null)
            }
        })

        const params = new URLSearchParams({
            client_id: PRESENTATION_OAUTH.clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            code_challenge: PKCEHelper.generateCodeChallenge(codeVerifier),
            code_challenge_method: "S256",
            state
        })
        pendingAuthUrl = `${FIVEANDTWO_URL}${PRESENTATION_OAUTH.authorizePath}?${params.toString()}`
        openURL(pendingAuthUrl)
    })
}

export async function fiveAndTwoConnect(scope: FiveAndTwoScopes = "presentation"): Promise<FiveAndTwoAuthData | null> {
    const access = fiveAndTwoAccess(scope)
    if (access) {
        sendToMain(ToMain.PROVIDER_CONNECT, { providerId: "fiveandtwo", success: true, isFirstConnection: false })
        return access
    }
    return authenticate(scope)
}

/** Revoked in 5and2 or unused for 90 days: there is no refresh token, only a new connection. */
export function fiveAndTwoConnectionEnded(scope: FiveAndTwoScopes = "presentation") {
    setContentProviderAccess("fiveandtwo", scope, null)
    sendToMain(ToMain.ALERT, "The 5and2 connection has ended. Please connect to 5and2 again.")
}

export function fiveAndTwoDisconnect(scope: FiveAndTwoScopes = "presentation") {
    // revoke server-side so the device disappears from the 5and2 settings list
    const access = fiveAndTwoAccess(scope)
    if (access) fiveAndTwoFetch(FIVEANDTWO_URL + PRESENTATION_OAUTH.revokePath, { method: "POST", body: { token: access.access_token } }).catch(() => undefined)
    setContentProviderAccess("fiveandtwo", scope, null)
}

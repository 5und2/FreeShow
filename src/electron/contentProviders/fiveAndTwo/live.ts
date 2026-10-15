/**
 * WARNING: This file should ONLY be accessed through FiveAndTwoProvider.
 * Use ContentProviderRegistry or FiveAndTwoProvider instead.
 */

import { ToMain } from "../../../types/IPC/ToMain"
import { sendToMain } from "../../IPC/main"
import { fiveAndTwoAccess, fiveAndTwoConnectionEnded, fiveAndTwoFetch, FiveAndTwoHttpError } from "./connect"
import { deliveredEvent, deliverLivePlan } from "./deliver"
import { cursorTargetOf, PROJECT_ID_PREFIX, slideRefOf } from "./mapping"
import { parseLiveFrame, parseSse } from "./sse"

/** The server sends at least a heartbeat every 25 seconds. */
const STALE_MS = 60_000
const RETRY_MS = 5_000
const MAX_RETRY_MS = 60_000

/** What the frontend shows: the active 5and2 project, and the slide on the output. */
export type FiveAndTwoLiveState = { eventId: string | null; slideId: string | null }

type Following = { eventId: string; abort: AbortController; lastReport: string | null }
let following: Following | null = null

/** Converges on the state the frontend sends: follows that one event's stream and reports its slide. */
export function fiveAndTwoLive(state: FiveAndTwoLiveState) {
    follow(state.eventId)
    if (following) report(following, state.slideId)
}

export function fiveAndTwoStopLive() {
    follow(null)
}

function follow(eventId: string | null) {
    if (following?.eventId === eventId) return
    following?.abort.abort()
    following = null
    if (!eventId || !fiveAndTwoAccess()) return

    const current: Following = { eventId, abort: new AbortController(), lastReport: null }
    following = current
    void keepStreaming(current)
}

type Outcome = { kind: "stop" } | { kind: "retry"; afterMs?: number; connected: boolean }

async function keepStreaming(current: Following) {
    let delay = RETRY_MS
    while (!current.abort.signal.aborted) {
        const outcome = await stream(current)
        if (outcome.kind === "stop") break
        if (outcome.connected) delay = RETRY_MS
        await sleep(outcome.afterMs ?? delay, current.abort.signal)
        delay = Math.min(delay * 2, MAX_RETRY_MS)
    }
    if (following === current) following = null
}

async function stream(current: Following): Promise<Outcome> {
    const access = fiveAndTwoAccess()
    if (!access) return { kind: "stop" }

    const attempt = new AbortController()
    const stopAttempt = () => attempt.abort()
    current.abort.signal.addEventListener("abort", stopAttempt)
    let watchdog = setTimeout(stopAttempt, STALE_MS)
    let connected = false

    try {
        const response = await fetch(`${access.api_base_url}/events/${current.eventId}/live`, {
            headers: { Accept: "text/event-stream", Authorization: `Bearer ${access.access_token}` },
            signal: attempt.signal
        })
        if (response.status === 401) {
            fiveAndTwoConnectionEnded(access.scope)
            return { kind: "stop" }
        }
        if (response.status === 404) return { kind: "stop" }
        if (response.status === 429) return { kind: "retry", afterMs: Number(response.headers.get("Retry-After") || 30) * 1000, connected }
        if (!response.ok || !response.body) return { kind: "retry", connected }

        connected = true
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        while (true) {
            const { done, value } = await reader.read()
            if (done) return { kind: "retry", connected }

            clearTimeout(watchdog)
            watchdog = setTimeout(stopAttempt, STALE_MS)

            const parsed = parseSse(buffer + decoder.decode(value, { stream: true }))
            buffer = parsed.rest
            for (const message of parsed.messages) {
                if (handle(current, message.event, message.data) === "stop") return { kind: "stop" }
            }
        }
    } catch (err) {
        if (current.abort.signal.aborted) return { kind: "stop" }
        if (!attempt.signal.aborted) console.warn("5and2 live stream failed:", err)
        return { kind: "retry", connected }
    } finally {
        clearTimeout(watchdog)
        current.abort.signal.removeEventListener("abort", stopAttempt)
        attempt.abort()
    }
}

function handle(current: Following, event: string, data: string): "stop" | void {
    const frame = parseLiveFrame(event, data)
    if (!frame) return

    if (frame.event === "plan") {
        if (frame.data.events[0]?.id === current.eventId) deliverLivePlan(frame.data)
        return
    }

    if (frame.event === "cursor") {
        // a `clock` cursor only follows the agenda times, which FreeShow already has
        if (frame.data.source !== "leader" || frame.data.eventId !== current.eventId) return
        const delivered = deliveredEvent(current.eventId)
        const target = delivered && cursorTargetOf(delivered, frame.data.agendaItemId)
        if (target) sendToMain(ToMain.FIVEANDTWO_CURSOR, { projectId: PROJECT_ID_PREFIX + current.eventId, ...target })
        return
    }

    if (frame.data.reason === "revoked") fiveAndTwoConnectionEnded()
    return "stop"
}

function report(current: Following, slideId: string | null) {
    const slide = slideId ? slideRefOf(slideId) : null
    const key = JSON.stringify(slide)
    if (key === current.lastReport) return
    current.lastReport = key

    const access = fiveAndTwoAccess()
    if (!access) return
    fiveAndTwoFetch(`${access.api_base_url}/events/${current.eventId}/live`, { method: "POST", token: access.access_token, body: { slide } }).catch((err) => {
        if (err instanceof FiveAndTwoHttpError && err.status === 401) return fiveAndTwoConnectionEnded(access.scope)
        // a 422 means the song is not in this event's plan, which a local edit of the project can cause
        if (!(err instanceof FiveAndTwoHttpError && err.status === 422)) console.warn("Could not report the slide to 5and2:", err)
    })
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(done, ms)
        signal.addEventListener("abort", done, { once: true })
        function done() {
            clearTimeout(timer)
            signal.removeEventListener("abort", done)
            resolve()
        }
    })
}

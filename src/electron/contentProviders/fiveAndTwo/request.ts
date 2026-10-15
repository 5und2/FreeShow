/**
 * WARNING: This file should ONLY be accessed through FiveAndTwoProvider.
 * Use ContentProviderRegistry or FiveAndTwoProvider instead.
 */

import { ToMain } from "../../../types/IPC/ToMain"
import { sendToMain } from "../../IPC/main"
import { fiveAndTwoConnect, fiveAndTwoConnectionEnded, fiveAndTwoFetch, FiveAndTwoHttpError } from "./connect"
import { deliverPlans } from "./deliver"
import { parsePlansDocument, type PlansDocument } from "./wire"

/** The API allows 28 at most. */
const PLAN_DAYS = 28

/** The last plans document and its ETag, so an unchanged sync gets a 304 instead of the whole document. */
let cached: { token: string; etag: string; plans: PlansDocument } | null = null

async function fetchPlans(): Promise<PlansDocument | null> {
    // the settings connect button lands here, so a missing token starts the browser consent
    const access = await fiveAndTwoConnect()
    if (!access) return null

    const previous = cached?.token === access.access_token ? cached : null
    try {
        const response = await fiveAndTwoFetch(`${access.api_base_url}/plans?days=${PLAN_DAYS}`, { token: access.access_token, ifNoneMatch: previous?.etag })
        if (response.status === 304 && previous) return previous.plans

        const plans = parsePlansDocument(response.body)
        if (!plans) sendToMain(ToMain.ALERT, "5and2 sent plans in a format this FreeShow version does not understand")
        cached = plans && response.etag ? { token: access.access_token, etag: response.etag, plans } : null
        return plans
    } catch (err) {
        if (err instanceof FiveAndTwoHttpError && err.status === 401) {
            cached = null
            fiveAndTwoConnectionEnded(access.scope)
            return null
        }
        console.error("Could not get 5and2 plans:", err)
        return null
    }
}

/** Loads every event of the next four weeks, or just one when a project is refreshed. */
export async function fiveAndTwoLoadServices(data?: { eventId?: string }): Promise<void> {
    const plans = await fetchPlans()
    if (!plans?.events.length) return

    sendToMain(ToMain.TOAST, "Getting schedules from 5and2")
    deliverPlans(plans, data?.eventId)
}

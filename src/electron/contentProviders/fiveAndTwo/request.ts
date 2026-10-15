/**
 * WARNING: This file should ONLY be accessed through FiveAndTwoProvider.
 * Use ContentProviderRegistry or FiveAndTwoProvider instead.
 */

import { ToMain } from "../../../types/IPC/ToMain"
import { setContentProviderAccess } from "../../data/contentProviders"
import { sendToMain } from "../../IPC/main"
import { fiveAndTwoConnect, fiveAndTwoFetch, FiveAndTwoHttpError } from "./connect"
import { plansToProjects } from "./mapping"
import { parsePlansDocument, type PlansDocument } from "./wire"

/** The API allows 28 at most. */
const PLAN_DAYS = 28

async function fetchPlans(): Promise<PlansDocument | null> {
    // the settings connect button lands here, so a missing token starts the browser consent
    const access = await fiveAndTwoConnect()
    if (!access) return null

    try {
        const plans = parsePlansDocument(await fiveAndTwoFetch(`${access.api_base_url}/plans?days=${PLAN_DAYS}`, { token: access.access_token }))
        if (!plans) sendToMain(ToMain.ALERT, "5and2 sent plans in a format this FreeShow version does not understand")
        return plans
    } catch (err) {
        if (err instanceof FiveAndTwoHttpError && err.status === 401) {
            // revoked in 5and2 or unused for 90 days: there is no refresh token, only a new connection
            setContentProviderAccess("fiveandtwo", access.scope, null)
            sendToMain(ToMain.ALERT, "The 5and2 connection has ended. Please connect to 5and2 again.")
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
    const { shows, projects } = plansToProjects(plans, data?.eventId)
    if (!projects.length) return

    sendToMain(ToMain.PROVIDER_PROJECTS, { providerId: "fiveandtwo", categoryName: "5and2", shows, projects })
}

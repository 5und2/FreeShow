/**
 * WARNING: This file should ONLY be accessed through FiveAndTwoProvider.
 * Use ContentProviderRegistry or FiveAndTwoProvider instead.
 */

import { ToMain } from "../../../types/IPC/ToMain"
import { sendToMain } from "../../IPC/main"
import { plansToProjects } from "./mapping"
import type { PlansDocument, WireEvent } from "./wire"

/** What FreeShow last got per event, so a live plan frame that repeats it is not imported again. */
const deliveredEvents = new Map<string, { event: WireEvent; fingerprint: string }>()

/** Only the songs this event plays, sorted, so the same event from GET /plans and from a plan frame compares equal. */
function fingerprintOf(plans: PlansDocument, event: WireEvent): string {
    const songIds = new Set(event.agenda.flatMap((row) => (row.kind === "song" ? [row.song.songVersionId] : [])))
    return JSON.stringify([plans.organisation, event, plans.songs.filter((song) => songIds.has(song.id)).sort((a, b) => a.id.localeCompare(b.id))])
}

function send(plans: PlansDocument, eventId: string | undefined, keepExistingShows: boolean) {
    const { shows, projects } = plansToProjects(plans, eventId)
    if (!projects.length) return

    plans.events.filter((event) => !eventId || event.id === eventId).forEach((event) => deliveredEvents.set(event.id, { event, fingerprint: fingerprintOf(plans, event) }))
    sendToMain(ToMain.PROVIDER_PROJECTS, { providerId: "fiveandtwo", categoryName: "5and2", shows, projects, keepExistingShows })
}

/** A sync the user asked for: every event and song again, so a deleted project comes back. */
export function deliverPlans(plans: PlansDocument, eventId?: string) {
    send(plans, eventId, false)
}

/**
 * A `plan` frame of the live stream: imported only when the event changed. A song version's text never
 * changes, so a show FreeShow already has is kept without asking.
 */
export function deliverLivePlan(plans: PlansDocument) {
    const [event] = plans.events
    if (!event || deliveredEvents.get(event.id)?.fingerprint === fingerprintOf(plans, event)) return
    send(plans, event.id, true)
}

export function deliveredEvent(eventId: string): WireEvent | undefined {
    return deliveredEvents.get(eventId)?.event
}

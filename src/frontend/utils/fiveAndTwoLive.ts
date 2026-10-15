import { derived, get } from "svelte/store"
import { Main } from "../../types/IPC/Main"
import type { ToMain, ToMainSendPayloads } from "../../types/IPC/ToMain"
import { getAllNormalOutputs } from "../components/helpers/output"
import { _show } from "../components/helpers/shows"
import { selectProjectShow } from "../components/helpers/showActions"
import { sendMain } from "../IPC/main"
import { activeProject, activeShow, contentProviderData, outputs, projects, providerConnections } from "../stores"

const PROJECT_ID_PREFIX = "fiveandtwo_"

/** The slide id on the first output, which for a 5and2 song names its part and slide index. */
function outputSlideId(): string | null {
    const slide = getAllNormalOutputs().find((output) => output.out?.slide?.id)?.out?.slide
    if (!slide || slide.id === "temp") return null
    const ref = _show(slide.id).layouts([slide.layout]).ref()[0]?.[slide.index ?? -1]
    return ref?.id || null
}

/** Sends main what to follow: the active 5and2 project's event, and the slide on the output. Main reports it to 5and2. */
export function startFiveAndTwoLive() {
    const state = derived([activeProject, outputs, providerConnections, contentProviderData], ([projectId, , connections, providerData]) => {
        const following = !!connections.fiveandtwo && providerData.fiveandtwo?.liveSync !== false && !!projectId?.startsWith(PROJECT_ID_PREFIX)
        return following ? { eventId: projectId!.slice(PROJECT_ID_PREFIX.length), slideId: outputSlideId() } : { eventId: null, slideId: null }
    })

    let sent = ""
    state.subscribe((value) => {
        const key = JSON.stringify(value)
        if (key === sent) return
        sent = key
        sendMain(Main.FIVEANDTWO_LIVE, value)
    })
}

/** The leader moved the 5and2 cursor: select that item when its project is open. */
export function followFiveAndTwoCursor({ projectId, itemId, occurrence }: ToMainSendPayloads[ToMain.FIVEANDTWO_CURSOR]) {
    if (get(activeProject) !== projectId) return
    const indexes = (get(projects)[projectId]?.shows || []).flatMap((item, i) => (item.id === itemId ? [i] : []))
    const index = indexes[occurrence]
    if (index === undefined || get(activeShow)?.index === index) return
    selectProjectShow(index)
}

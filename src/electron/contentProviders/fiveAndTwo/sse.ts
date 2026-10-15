import { parsePlansDocument, type LiveFrame } from "./wire"

export type SseMessage = { event: string; data: string }

/** Splits a server-sent events buffer into complete messages and the incomplete rest. Comments and `retry:` are dropped. */
export function parseSse(buffer: string): { messages: SseMessage[]; rest: string } {
    const blocks = buffer.split(/\r\n\r\n|\n\n|\r\r/)
    const rest = blocks.pop() ?? ""

    const messages = blocks.flatMap((block) => {
        let event = "message"
        const data: string[] = []
        for (const line of block.split(/\r\n|\n|\r/)) {
            const colon = line.indexOf(":")
            const field = colon < 0 ? line : line.slice(0, colon)
            const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "")
            if (field === "event") event = value
            else if (field === "data") data.push(value)
        }
        return data.length ? [{ event, data: data.join("\n") }] : []
    })

    return { messages, rest }
}

/** Checks one frame of the live stream at the boundary. An unknown frame name or a malformed frame is null. */
export function parseLiveFrame(event: string, data: string): LiveFrame | null {
    let json: any
    try {
        json = JSON.parse(data)
    } catch {
        return null
    }

    if (event === "plan") {
        const plans = parsePlansDocument(json)
        return plans && plans.events.length === 1 ? { event, data: plans } : null
    }
    if (event === "cursor") {
        const valid = typeof json?.eventId === "string" && (json.agendaItemId === null || typeof json.agendaItemId === "string") && (json.source === "leader" || json.source === "clock")
        return valid ? { event, data: json } : null
    }
    if (event === "end") return json?.reason === "revoked" || json?.reason === "gone" ? { event, data: json } : null
    return null
}

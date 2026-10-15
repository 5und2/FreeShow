import { describe, expect, it } from "vitest"
import example from "./__fixtures__/plans-v1.example.json"
import { parseLiveFrame, parseSse } from "./sse"

describe("5and2 live stream frames", () => {
    it("keeps a message that is split across chunks for the next read", () => {
        const first = parseSse('retry: 5000\n\n: heartbeat\n\nevent: cursor\ndata: {"eventId"')
        expect(first.messages).toEqual([])

        const second = parseSse(first.rest + ':"e1","agendaItemId":null,"source":"clock"}\n\nevent: end\r\ndata: {"reason":"gone"}\r\n\r\n')
        expect(second.messages).toEqual([
            { event: "cursor", data: '{"eventId":"e1","agendaItemId":null,"source":"clock"}' },
            { event: "end", data: '{"reason":"gone"}' }
        ])
        expect(second.rest).toBe("")
    })

    it("checks each frame at the boundary", () => {
        expect(parseLiveFrame("plan", JSON.stringify(example))?.event).toBe("plan")
        expect(parseLiveFrame("plan", JSON.stringify({ ...example, events: [] }))).toBeNull()
        expect(parseLiveFrame("cursor", '{"eventId":"e1","agendaItemId":"a1","source":"leader"}')).toEqual({ event: "cursor", data: { eventId: "e1", agendaItemId: "a1", source: "leader" } })
        expect(parseLiveFrame("cursor", '{"eventId":"e1","agendaItemId":"a1","source":"robot"}')).toBeNull()
        expect(parseLiveFrame("end", '{"reason":"revoked"}')).toEqual({ event: "end", data: { reason: "revoked" } })
        expect(parseLiveFrame("presence", "{}")).toBeNull()
        expect(parseLiveFrame("cursor", "not json")).toBeNull()
    })
})

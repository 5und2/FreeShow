import http from "http"
import type { AddressInfo } from "net"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { ToMain } from "../../../types/IPC/ToMain"
import { sendToMain } from "../../IPC/main"
import example from "./__fixtures__/plans-v1.example.json"
import { fiveAndTwoLive, fiveAndTwoStopLive } from "./live"
import { fiveAndTwoLoadServices } from "./request"

const store = vi.hoisted(() => ({ access: null as any }))
vi.mock("../../IPC/main", () => ({ sendToMain: vi.fn() }))
vi.mock("../../IPC/responsesMain", () => ({ openURL: vi.fn() }))
vi.mock("../../utils/requests", () => ({ httpsRequest: vi.fn() }))
vi.mock("../../data/contentProviders", () => ({
    getContentProviderAccess: () => store.access,
    setContentProviderAccess: (_provider: string, _scope: string, data: any) => (store.access = data)
}))

const EVENT_ID = example.events[0].id
const SONG_ID = example.songs[0].id
const LIVE_PATH = `/api/presentation/v1/events/${EVENT_ID}/live`

/** A stand-in for 5and2: GET /plans with an ETag, and one event's live stream and slide reports. */
const server = {
    http: null as http.Server | null,
    plansRequests: [] as (string | undefined)[],
    reports: [] as any[],
    stream: null as http.ServerResponse | null,
    send(event: string, data: object) {
        const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        // split mid-frame, as TCP may
        this.stream!.write(frame.slice(0, 20))
        this.stream!.write(frame.slice(20))
    }
}

function sent(channel: ToMain): any[] {
    return vi
        .mocked(sendToMain)
        .mock.calls.filter(([id]) => id === channel)
        .map(([, value]) => value)
}

async function until(check: () => boolean) {
    for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(check()).toBe(true)
}

beforeAll(async () => {
    server.http = http.createServer((req, res) => {
        if (req.headers.authorization !== "Bearer device-token") return res.writeHead(401).end()

        if (req.url?.startsWith("/api/presentation/v1/plans")) {
            server.plansRequests.push(req.headers["if-none-match"])
            if (req.headers["if-none-match"] === '"v1"') return res.writeHead(304, { ETag: '"v1"' }).end()
            return res.writeHead(200, { ETag: '"v1"', "Content-Type": "application/json" }).end(JSON.stringify(example))
        }

        if (req.url === LIVE_PATH && req.method === "POST") {
            let body = ""
            req.on("data", (chunk) => (body += chunk))
            req.on("end", () => {
                server.reports.push(JSON.parse(body))
                res.writeHead(204).end()
            })
            return
        }

        if (req.url === LIVE_PATH) {
            res.writeHead(200, { "Content-Type": "text/event-stream" })
            res.write("retry: 5000\n\n")
            server.stream = res
            server.send("plan", example)
            return
        }

        res.writeHead(404).end()
    })
    await new Promise<void>((resolve) => server.http!.listen(0, "127.0.0.1", resolve))
    const { port } = server.http!.address() as AddressInfo
    store.access = { access_token: "device-token", token_type: "Bearer", scope: "presentation", api_base_url: `http://127.0.0.1:${port}/api/presentation/v1`, created_at: 0 }
})

afterAll(() => {
    fiveAndTwoStopLive()
    server.stream?.end()
    server.http?.closeAllConnections()
    server.http?.close()
})

describe("5and2 sync and live stream against a stand-in server", () => {
    it("asks for the plans with the last ETag and imports the cached document on a 304", async () => {
        await fiveAndTwoLoadServices()
        await fiveAndTwoLoadServices()

        expect(server.plansRequests).toEqual([undefined, '"v1"'])
        const [first, second] = sent(ToMain.PROVIDER_PROJECTS)
        expect(second.projects.map((project: any) => project.items)).toEqual(first.projects.map((project: any) => project.items))
        expect(second.keepExistingShows).toBe(false)
    })

    it("reports the output slide, and does not re-import a plan frame FreeShow already has", async () => {
        fiveAndTwoLive({ eventId: EVENT_ID, slideId: `${SONG_ID}_p2_0` })
        await until(() => server.reports.length === 1)
        expect(server.reports[0]).toEqual({ slide: { songVersionId: SONG_ID, partId: "p2", slideIndex: 0 } })

        fiveAndTwoLive({ eventId: EVENT_ID, slideId: `${SONG_ID}_p2_0` })
        fiveAndTwoLive({ eventId: EVENT_ID, slideId: "a-local-slide" })
        await until(() => server.reports.length === 2)
        expect(server.reports[1]).toEqual({ slide: null })
        expect(sent(ToMain.PROVIDER_PROJECTS)).toHaveLength(2)
    })

    it("imports a changed plan without asking about songs FreeShow has", async () => {
        const changed = { ...example, events: [{ ...example.events[0], title: "Gottesdienst mit Taufe" }] }
        server.send("plan", changed)
        await until(() => sent(ToMain.PROVIDER_PROJECTS).length === 3)

        const live = sent(ToMain.PROVIDER_PROJECTS)[2]
        expect(live.projects[0].name).toBe("Gottesdienst mit Taufe")
        expect(live.keepExistingShows).toBe(true)
    })

    it("follows the leader's cursor but not the clock", async () => {
        const songRow = example.events[0].agenda[3]
        server.send("cursor", { eventId: EVENT_ID, agendaItemId: example.events[0].agenda[1].id, source: "clock" })
        server.send("cursor", { eventId: EVENT_ID, agendaItemId: songRow.id, source: "leader" })
        await until(() => sent(ToMain.FIVEANDTWO_CURSOR).length > 0)

        expect(sent(ToMain.FIVEANDTWO_CURSOR)).toEqual([{ projectId: `fiveandtwo_${EVENT_ID}`, itemId: `fiveandtwosong_${songRow.song!.songVersionId}`, occurrence: 0 }])
    })

    it("forgets the token when 5and2 ends the stream as revoked", async () => {
        server.send("end", { reason: "revoked" })
        await until(() => store.access === null)
        expect(sent(ToMain.ALERT)).toEqual(["The 5and2 connection has ended. Please connect to 5and2 again."])
    })
})

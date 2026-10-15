import { describe, expect, it } from "vitest"
import example from "./__fixtures__/plans-v1.example.json"
import { chordsOf, plansToProjects } from "./mapping"
import { parsePlansDocument, type PlansDocument } from "./wire"

// The fixture is 5and2's own contract example (5und2/5and2app libs/modules/presentation/src/__fixtures__).
const plans = parsePlansDocument(example) as PlansDocument

function layoutGroups(show: any): string[] {
    return show.layouts[show.settings.activeLayout].slides.map((slide: { id: string }) => show.slides[slide.id].group)
}

describe("5and2 plans to FreeShow projects", () => {
    it("parses the 5and2 contract example", () => {
        expect(plans).not.toBeNull()
        expect(parsePlansDocument({ ...example, schema: "presentation/v2" })).toBeNull()
    })

    it("makes one project per event with the agenda in order", () => {
        const { projects } = plansToProjects(plans)
        expect(projects).toHaveLength(1)
        const [project] = projects
        expect(project.id).toBe("fiveandtwo_00000000-0000-4000-8000-00000000e001")
        expect(project.folderName).toBe("Gemeinde am See")
        expect(project.scheduledTo).toBe(Date.parse("2026-10-18T08:00:00.000Z"))
        expect(project.items.map((item) => [item.type, item.name ?? item.id])).toEqual([
            ["section", "Ankommen und Lobpreis"],
            ["section", "Begrüßung"],
            ["show", "fiveandtwosong_00000000-0000-4000-8000-000000005a01"],
            ["show", "fiveandtwosong_00000000-0000-4000-8000-000000005b02"],
            ["section", "Wort"],
            ["section", "Predigt"]
        ])
        expect(project.items[1].scheduleLength).toBe(300)
    })

    it("plays a song in its sequence, reusing a recurring part", () => {
        const { shows } = plansToProjects(plans)
        const grosserGott = shows.find((show) => show.id.endsWith("5b02"))!
        expect(grosserGott.name).toBe("Großer Gott, wir loben dich (Gemeinde-Fassung)")
        expect(layoutGroups(grosserGott)).toEqual(["Strophe 1", "Refrain", "Strophe 1"])

        const refrain = Object.values(grosserGott.slides).find((slide) => slide.group === "Refrain")!
        expect(refrain.globalGroup).toBe("chorus")
        expect(refrain.children).toHaveLength(1)
    })

    it("projects the lyrics and keeps the chords for chord views", () => {
        const { shows } = plansToProjects(plans)
        const amazingGrace = shows.find((show) => show.id.endsWith("5a01"))!
        const firstSlide = amazingGrace.slides[amazingGrace.layouts[amazingGrace.settings.activeLayout].slides[0].id]
        const [item] = firstSlide.items
        expect(item.lines!.map((line) => line.text[0].value)).toEqual(["Amazing grace! How sweet the sound", "That saved a wretch like me!"])
        expect(item.chords?.enabled).toBeFalsy()
        expect(item.lines!.map((line) => line.chords?.map(({ pos, key }) => [pos, key]))).toEqual([
            [
                [1, "G"],
                [19, "C"],
                [29, "G"]
            ],
            [[25, "D"]]
        ])
        expect(amazingGrace.meta).toMatchObject({ title: "Amazing Grace", artist: "John Newton", CCLI: "22025", key: "G" })
    })

    it("drops chords that do not line up with the lyrics", () => {
        expect(chordsOf({ lyrics: "Holy", chordPro: "[D]Holy" }).map((chord) => chord.key)).toEqual(["D"])
        expect(chordsOf({ lyrics: "Holy, holy", chordPro: "[D]Holy" })).toEqual([])
        expect(chordsOf({ lyrics: "Holy", chordPro: "[D]Ho[ly" })).toEqual([])
    })

    it("refreshes one event without the songs of others", () => {
        expect(plansToProjects(plans, "00000000-0000-4000-8000-00000000ffff")).toEqual({ shows: [], projects: [] })
    })
})

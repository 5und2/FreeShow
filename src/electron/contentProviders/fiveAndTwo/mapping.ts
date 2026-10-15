import { uid } from "uid"
import type { Show, SlideData } from "../../../types/Show"
import type { PlansDocument, WireAgendaRow, WireSongVersion } from "./wire"

const ITEM_STYLE = "left:50px;top:120px;width:1820px;height:840px;"
export const LAYOUT_ID = "fiveandtwo"

// 5and2 charts are mostly German, so both spellings map to FreeShow's global groups.
const GLOBAL_GROUPS: [RegExp, string][] = [
    [/^(pre-?chorus|vor-?refrain|prechorus)/i, "pre_chorus"],
    [/^(strophe|verse|vers)\b/i, "verse"],
    [/^(refrain|chorus|kehrvers)\b/i, "chorus"],
    [/^bridge\b/i, "bridge"],
    [/^(intro|vorspiel)\b/i, "intro"],
    [/^(outro|schluss|nachspiel|ending)\b/i, "outro"],
    [/^tag\b/i, "tag"],
    [/^(zwischenspiel|instrumental|interlude)\b/i, "break"]
]

function globalGroupOf(label: string): string | undefined {
    return GLOBAL_GROUPS.find(([pattern]) => pattern.test(label.trim()))?.[1]
}

/**
 * One show per song version: a version's text never changes in 5and2, so its id is a stable show id.
 * Each part becomes a group whose slides follow the chart, and the sequence becomes the one layout.
 */
export function buildSongShow(song: WireSongVersion, category: string): Show {
    const slides: Show["slides"] = {}
    const parentByPart: { [partId: string]: string } = {}

    song.parts.forEach((part, index) => {
        const partSlides = part.slides.length ? part.slides : [[]]
        const groupName = part.label || `${index + 1}`
        const globalGroup = part.label ? globalGroupOf(part.label) : "verse"
        const ids = partSlides.map(() => uid())

        partSlides.forEach((lines, i) => {
            const isParent = i === 0
            slides[ids[i]] = {
                group: isParent ? groupName : null,
                ...(isParent && globalGroup ? { globalGroup } : {}),
                color: null,
                settings: {},
                notes: "",
                items: lines.length ? [{ style: ITEM_STYLE, lines: lines.map((line) => ({ align: "", text: [{ style: "", value: line.lyrics }] })) }] : []
            }
        })

        if (ids.length > 1) slides[ids[0]].children = ids.slice(1)
        parentByPart[part.id] = ids[0]
    })

    const order = song.sequence.length ? song.sequence : song.parts.map((part) => part.id)
    const layoutSlides: SlideData[] = order.filter((partId) => parentByPart[partId]).map((partId) => ({ id: parentByPart[partId] }))

    return {
        name: song.versionLabel ? `${song.title} (${song.versionLabel})` : song.title,
        category,
        timestamps: { created: Date.now(), modified: null, used: null },
        meta: {
            title: song.title,
            artist: song.author || "",
            CCLI: song.ccliNumber || "",
            key: song.key || ""
        },
        settings: { activeLayout: LAYOUT_ID, template: null },
        layouts: { [LAYOUT_ID]: { name: "Default", notes: "", slides: layoutSlides } },
        slides,
        media: {}
    }
}

type ProviderProjectItem = { type: "show" | "section"; id: string; scheduleLength: number; name?: string }
type ProviderProject = { id: string; name: string; scheduledTo: number; created: number; folderId: string; folderName: string; items: ProviderProjectItem[] }

const PROJECT_ID_PREFIX = "fiveandtwo_"
const SHOW_ID_PREFIX = "fiveandtwosong_"
const CATEGORY = "fiveandtwo"

function projectItem(row: WireAgendaRow): ProviderProjectItem {
    const scheduleLength = (row.durationMinutes || 0) * 60
    if (row.kind === "song") return { type: "show", id: SHOW_ID_PREFIX + row.song.songVersionId, scheduleLength }
    return { type: "section", id: row.id, name: row.title, scheduleLength }
}

/** Pure mapping of a plans document to FreeShow shows and projects, one project per event. */
export function plansToProjects(plans: PlansDocument, eventId?: string): { shows: (Show & { id: string })[]; projects: ProviderProject[] } {
    const events = plans.events.filter((event) => !eventId || event.id === eventId)
    const usedSongs = new Set(events.flatMap((event) => event.agenda.flatMap((row) => (row.kind === "song" ? [row.song.songVersionId] : []))))

    const shows = plans.songs.filter((song) => usedSongs.has(song.id)).map((song) => ({ id: SHOW_ID_PREFIX + song.id, ...buildSongShow(song, CATEGORY) }))

    const projects = events.map((event) => ({
        id: PROJECT_ID_PREFIX + event.id,
        name: event.title,
        scheduledTo: new Date(event.startsAt).getTime(),
        created: Date.now(),
        folderId: "fiveandtwo",
        folderName: plans.organisation.name,
        items: event.agenda.map(projectItem)
    }))

    return { shows, projects }
}

class Provider implements CustomSource {
    api = "https://yuzuki.kagane.org/api/v2"

    getSettings(): Settings {
        return { supportsAnime: false, supportsManga: true }
    }

    private mapStatus(status?: string): string {
        if (!status) return "FINISHED";
        const s = status.toUpperCase();
        if (s.includes("ONGOING") || s.includes("PUBLISHING")) return "RELEASING";
        if (s.includes("COMPLETED") || s.includes("FINISHED")) return "FINISHED";
        if (s.includes("CANCELLED") || s.includes("DISCONTINUED")) return "CANCELLED";
        if (s.includes("HIATUS")) return "HIATUS";
        return "FINISHED";
    }

    private mapFormat(format?: string): string {
        if (!format) return "MANGA";
        const f = format.toUpperCase();
        if (f.includes("NOVEL")) return "NOVEL";
        if (f.includes("ONE") || f.includes("SHOT")) return "ONE_SHOT";
        return "MANGA";
    }

    async listManga(search: string, page: number, perPage: number): Promise<ListResponse<$app.AL_BaseManga>> {
        try {
            const currentPage = Math.max(0, page - 1);

            const res = await fetch(`${this.api}/search/series?page=${currentPage}&size=${perPage}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    title: search || "",
                    content_rating: ["Safe", "Suggestive", "Erotica", "Pornographic"]
                })
            });

            if (!res.ok) return { media: [], page: 1, totalPages: 1, total: 0 };

            const json = await res.json();
            const items = Array.isArray(json.content) ? json.content : [];

            const idMap = $store.get("kagane") ?? {};

            const results = items.map((m: any) => {
                const hashed = this.hashUUID(m.series_id);
                idMap[hashed] = m.series_id;

                const coverUrl = m.cover_image_id
                    ? `https://yuzuki.kagane.org/api/v2/image/${m.cover_image_id}`
                    : "";

                return {
                    id: hashed,
                    siteUrl: `https://kagane.org/series/${m.series_id}`,
                    status: this.mapStatus(m.publication_status || m.upload_status),
                    type: "MANGA",
                    format: this.mapFormat(m.format),
                    title: {
                        userPreferred: m.title || "Untitled",
                        romaji: m.title || "Untitled",
                    },
                    coverImage: {
                        extraLarge: coverUrl,
                        large: coverUrl,
                        medium: coverUrl,
                        color: "#ffffff"
                    },
                    isAdult: ["Erotica", "Pornographic"].includes(m.content_rating),
                    genres: [],
                    synonyms: m.alternate_titles || [],
                    startDate: { year: 2024, month: 1, day: 1 },
                    chapters: m.current_books || 0,
                    volumes: m.current_volumes || 0
                };
            });

            $store.set("kagane", idMap);

            return {
                media: results,
                page: json.page + 1,
                totalPages: json.total_pages || 1,
                total: json.total_elements || results.length
            };

        } catch (e) {
            console.error("Error en listManga:", e);
            return { media: [], page: 1, totalPages: 1, total: 0 };
        }
    }

    async getManga(ids: number[]): Promise<$app.AL_BaseManga[]> {
        const map = $store.get("kagane") ?? {};
        let out: $app.AL_BaseManga[] = [];

        for (const numericId of ids) {
            const realId = map[numericId];
            if (!realId) continue;

            try {
                const res = await fetch(`${this.api}/series/${realId}`);
                if (!res.ok) continue;
                const m = await res.json();

                const coverUrl = m.cover_image_id
                    ? `${this.api}/image/${m.cover_image_id}/compressed`
                    : "";

                out.push({
                    id: numericId,
                    siteUrl: `https://kagane.org/series/${realId}`,
                    status: this.mapStatus(m.publication_status),
                    type: "MANGA",
                    format: this.mapFormat(m.format),
                    chapters: m.current_books || 0,
                    volumes: m.current_volumes || 0,
                    synonyms: m.alternate_titles ?? [],
                    title: {
                        userPreferred: m.title || "Unknown",
                        romaji: m.title || "Unknown",
                    },
                    coverImage: {
                        large: coverUrl,
                        medium: coverUrl,
                        extraLarge: coverUrl
                    },
                    description: m.description || "",
                    isAdult: ["Erotica", "Pornographic"].includes(m.content_rating),
                    startDate: { year: 2024, month: 1, day: 1 }
                });
            } catch (e) {}
        }
        return out;
    }

    private hashUUID(uuid: string): number {
        if (!uuid) return 0;
        let hash = 0;
        for (let i = 0; i < uuid.length; i++) {
            hash = ((hash << 5) - hash) + uuid.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    }
}
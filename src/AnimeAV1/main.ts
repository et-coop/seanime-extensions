// <reference path="../online-streaming-provider.d.ts" />

class Provider {
    baseUrl = "https://monoschino2.com";

    getSettings(): Settings {
        return {
            episodeServers: ["Default"],
            supportsDub: false, // MonosChinos es primordialmente subtitulado
        };
    }

    async search(query: SearchOptions): Promise<SearchResult[]> {
        if (!query.query || query.query.trim() === "") return [];

        // MonosChinos utiliza /buscar?q=nombre-del-anime
        const url = `${this.baseUrl}/buscar?q=${encodeURIComponent(query.query)}`;

        try {
            const response = await fetch(url);
            if (!response.ok) return [];
            const html = await response.text();

            const results: SearchResult[] = [];
            
            // Regex para capturar las tarjetas de anime en la búsqueda
            // Estructura típica: <div class="col-md-3..."><a href="URL"><img src="IMAGE" alt="TITLE">...
            const cardRegex = /<div class="col-[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>[\s\S]*?<img src="([^"]+)" alt="([^"]+)"/g;
            let match;

            while ((match = cardRegex.exec(html)) !== null) {
                const animeUrl = match[1];
                const image = match[2];
                const title = match[3];

                // Extraer el slug de la URL (ej: https://monoschino2.com/anime/shingeki-no-kyojin -> shingeki-no-kyojin)
                const slugMatch = animeUrl.match(/\/anime\/([^/]+)/);
                if (!slugMatch) continue;
                const slug = slugMatch[1];

                results.push({
                    id: slug,
                    title: title.trim(),
                    url: animeUrl,
                    image: image,
                    subOrDub: "sub"
                });
            }

            return results;
        } catch (error) {
            console.error("Error searching MonosChinos:", error);
            return [];
        }
    }

    async findEpisodes(animeId: string): Promise<EpisodeDetails[]> {
        // En este caso, el animeId es directamente el slug (ej: "one-piece")
        const url = `${this.baseUrl}/anime/${animeId}`;

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error("Error fetching anime page");
            const html = await res.text();

            const episodes: EpisodeDetails[] = [];

            // Capturar la imagen de fondo o portada principal por si acaso
            const backdropMatch = html.match(/<div class="banner-anime"[^>]*style="background-image: url\('([^']+)'\)/);
            const image = backdropMatch ? backdropMatch[1] : undefined;

            // Regex para capturar los episodios del listado inferior
            // Estructura típica: <a href="https://monoschino2.com/ver/slug-episodio-X" ...>
            const epRegex = /<a href="([^"]+\/ver\/([^"]+)-episodio-(\d+))"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/g;
            let match;

            while ((match = epRegex.exec(html)) !== null) {
                const epUrl = match[1];
                const epSlug = match[2];
                const epNumber = parseInt(match[3], 10);
                const epTitle = match[4].replace(/<[^>]*>/g, '').trim(); // Limpiar tags HTML si los hay

                const episodeIdPayload = JSON.stringify({
                    slug: epSlug,
                    number: epNumber
                });

                episodes.push({
                    id: episodeIdPayload,
                    number: epNumber,
                    title: epTitle || `Episodio ${epNumber}`,
                    url: epUrl,
                    image: image
                });
            }

            // MonosChinos suele listar los episodios del más reciente al más antiguo. 
            // Los ordenamos de menor a mayor para que Seanime los procese correctamente.
            return episodes.sort((a, b) => a.number - b.number);

        } catch (err) {
            console.error('Error finding episodes on MonosChinos:', err);
            return [];
        }
    }

    async findEpisodeServer(episodeOrId: any, _server: string): Promise<EpisodeServer> {
        let slug: string;
        let number: number;

        const idStr = typeof episodeOrId === "string" ? episodeOrId : episodeOrId.id;

        try {
            const parsed = JSON.parse(idStr);
            slug = parsed.slug;
            number = parsed.number;
        } catch (e) {
            throw new Error("ID inválido");
        }

        // Construir la URL del reproductor del episodio
        const pageUrl = `${this.baseUrl}/ver/${slug}-episodio-${number}`;
        const res = await fetch(pageUrl);
        if (!res.ok) throw new Error("Error obteniendo el reproductor del episodio");
        const html = await res.text();

        // MonosChinos carga los reproductores mediante un array de pestañas o botones que contienen iframes codificados o directos.
        // Buscamos los enlaces dentro de los atributos "data-player" o dentro de los scripts de los botones.
        // Común: <button class="play-video" data-player="BASE64_O_URL">
        const playerRegex = /data-player="([^"]+)"/g;
        let match;
        let streamUrl: string | null = null;

        while ((match = playerRegex.exec(html)) !== null) {
            let rawUrl = match[1];

            // Si está en Base64 (muy común en webs de anime para ocultar servidores), lo decodificamos
            if (!rawUrl.startsWith('http') && !rawUrl.startsWith('//')) {
                try {
                    rawUrl = atob(rawUrl);
                } catch (e) {
                    continue; 
                }
            }

            if (rawUrl.startsWith('//')) {
                rawUrl = 'https:' + rawUrl;
            }

            // Buscamos prioritariamente streams que contengan archivos de video directos o HLS directos.
            // Nota: Si MonosChinos usa reproductores externos puros (como Fembed, Mega, Okru), Seanime no los reproducirá nativamente 
            // a menos que uses un extractor interno, pero si devuelve un .mp4 o un .m3u8, funcionará directo.
            if (rawUrl.includes('m3u8') || rawUrl.includes('google') || rawUrl.includes('monoschino')) {
                streamUrl = rawUrl;
                break;
            }
            
            // Guardamos el primero disponible como fallback si no hay HLS ideal
            if (!streamUrl) streamUrl = rawUrl;
        }

        if (!streamUrl) throw new Error("No se encontraron servidores de streaming válidos");

        // Determinar el tipo de stream
        const isM3U8 = streamUrl.includes('m3u8');

        return {
            server: "Default",
            headers: { 
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": this.baseUrl 
            },
            videoSources: [{
                url: streamUrl,
                type: isM3U8 ? "m3u8" : "mp4",
                quality: "auto",
                subtitles: []
            }]
        };
    }
}

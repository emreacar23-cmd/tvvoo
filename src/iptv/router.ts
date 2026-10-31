import crypto from 'crypto';
import express, { Request, Response } from 'express';
import { buildM3UPlaylist } from './playlist';
import { IPTVChannel } from './types';

type CatalogItem = {
    name?: string;
    url?: string;
    play?: string;
    href?: string;
    link?: string;
    poster?: string;
    image?: string;
};

type Country = {
    id: string;
    name: string;
};

type Resolver = (
    url: string,
    clientIp: string | null
) => Promise<{
    url: string;
    headers?: Record<string, string>;
    validUntil?: number;
} | null>;

type LiveManifestProvider = {
    getLiveManifest(
        playUrl: string,
        clientIp: string | null,
        resolveFn: Resolver
    ): Promise<string>;
};

type IPTVRouterOptions = {
    countries: Country[];
    getCountryCatalog: (countryId: string) => Promise<CatalogItem[]>;
    resolveVavooCleanUrl: Resolver;
    liveManifestManager: LiveManifestProvider;
};

function cleanName(value: unknown): string {
    return String(value || 'Unknown')
        .replace(/\s*(\.[a-z0-9]{1,3})+$/i, '')
        .replace(/\s*\((?:\d+|[A-Za-z]{1,3})\)\s*$/i, '')
        .trim() || 'Unknown';
}
function normalizeTRKey(value: string): string {
    return String(value || '')
        .toLocaleUpperCase('tr-TR')
        .replace(/İ/g, 'I')
        .replace(/Ü/g, 'U')
        .replace(/Ğ/g, 'G')
        .replace(/Ş/g, 'S')
        .replace(/Ç/g, 'C')
        .replace(/Ö/g, 'O')
        .replace(/[^A-Z0-9]/g, '');
}

const TR_NAME_FIXES: Record<string, string> = {
    AKT: 'AKİT',
    BENGTRK: 'BENGÜTÜRK',
    TRK: 'TÜRK',
    HABERTRK: 'HABERTÜRK',
    LKETV: 'ÜLKE TV',
    MNKAGO: 'MİNİKA GO',
    MNKAOCUK: 'MİNİKA ÇOCUK',
    SNEMAALE: 'SİNEMA AİLE',
    SNEMAKSYON: 'SİNEMA AKSİYON',
    SNEMAKOMED: 'SİNEMA KOMEDİ',
    SNEMATV: 'SİNEMA TV',
    SNEMAYERL: 'SİNEMA YERLİ',
    MZK: 'MÜZİK',
    MZIK: 'MÜZİK',
    ANAKKALE: 'ÇANAKKALE',
    TRKIYEM: 'TÜRKİYEM',
    ANLIURFA: 'ŞANLIURFA',
    DGNTV: 'DÜĞÜN TV',
    TRKCE: 'TÜRKÇE',
    TRKE: 'TÜRKÇE'
};

function normalizeTurkishChannelName(value: string): string {
    const original = cleanName(value);
    const exact = TR_NAME_FIXES[normalizeTRKey(original)];

    if (exact) return exact;

    let name = original;

    const rules: Array<[RegExp, string]> = [
        [/\bS\s*N\s*E\s*M\s*A\b/gi, 'SİNEMA'],
        [/\bK\s*O\s*M\s*E\s*D\b/gi, 'KOMEDİ'],
        [/\bA\s*L\s*E\b/gi, 'AİLE'],
        [/\bA\s*K\s*S\s*Y\s*O\s*N\b/gi, 'AKSİYON'],
        [/\bY\s*E\s*R\s*L\b/gi, 'YERLİ'],
        [/\bM\s*N\s*K\s*A\b/gi, 'MİNİKA'],
        [/\bO\s*C\s*U\s*K\b/gi, 'ÇOCUK'],
        [/\bT\s*R\s*K\s*C\s*E\b/gi, 'TÜRKÇE'],
        [/\bT\s*R\s*K\s*E\b/gi, 'TÜRKÇE'],
        [/\bT\s*R\s*K\b/gi, 'TÜRK'],
        [/\bA\s*K\s*T\b/gi, 'AKİT'],
        [/\bBENG\s*T\s*R\s*K\b/gi, 'BENGÜTÜRK'],
        [/\bHABER\s*T\s*R\s*K\b/gi, 'HABERTÜRK'],
        [/\bL\s*K\s*E\s+TV\b/gi, 'ÜLKE TV'],
        [/\bM\s*Z\s*K\b/gi, 'MÜZİK'],
        [/\bM\s*Z\s*I\s*K\b/gi, 'MÜZİK'],
        [/\bT\s*R\s*K\s*I\s*Y\s*E\s*M\b/gi, 'TÜRKİYEM'],
        [/\bA\s*N\s*A\s*K\s*K\s*A\s*L\s*E\b/gi, 'ÇANAKKALE'],
        [/\bA\s*N\s*L\s*I\s*U\s*R\s*F\s*A\b/gi, 'ŞANLIURFA'],
        [/\bD\s*Ğ\s*N\s+TV\b/gi, 'DÜĞÜN TV']
    ];

    for (const [pattern, replacement] of rules) {
        name = name.replace(pattern, replacement);
    }

    return name.replace(/\s{2,}/g, ' ').trim();
}



function getTurkishCategory(name: string): string {
    // Kalite etiketlerini ve 4K TR önekini temizle.
    let key = normalizeTRKey(
        name.replace(/^4K\s*TR\s*:\s*/i, '').replace(/^4K\s*/i, '')
    );

    key = key.replace(
        /(FHD|UHD|HD|SD|RAW|HEVC|H265|H264|8K)+$/g,
        ''
    );

    const has = (...parts: string[]) =>
        parts.some(part => key.includes(part));

    const starts = (...parts: string[]) =>
        parts.some(part => key.startsWith(part));

    // SPOR
    if (has(
        'SPOR', 'SPORT', 'BEIN', 'EUROSPORT', 'ASPOR',
        'TIVIBUSP', 'FBTV', 'GSTV', 'BJKTV', 'SSPORT',
        'SPORTSMART', 'NBATV', 'TJKTV', 'TAYTV',
        'REDBULL', 'MOTORSPORT', 'FORMULA1', 'UFC',
        'WWE', 'IDMANTV'
    )) {
        return 'Spor';
    }

    // ÇOCUK
    if (has(
        'COCUK', 'MINIKA', 'CARTOON', 'KIDS', 'BABY',
        'NICK', 'SUNGERBOB', 'DISNEYJR', 'DISNEYJUNIOR',
        'DISNEYCHANNEL', 'BOOMERANG', 'PEPEE', 'PEPETV',
        'NILOYA', 'RAFADANTAYFA', 'SIRINLER', 'TOMJERRY',
        'DUCKTV', 'CAILLOU', 'BOOBA', 'BEN10', 'BARBIE',
        'GABBY', 'PEPPAPIG', 'ADIBESA', 'BABYTV', 'TAYOTV',
        'PATRONBEBEK', 'PAWPETROL', 'PIJAMAMASKELILER',
        'POKEMON', 'KOSTEBEKGILLER', 'MASALTV',
        'NASREDDINHOCA', 'CANIMKARDESIM', 'DORUTV',
        'CHICKYTV', 'EBATV', 'DAVINCI', 'ELIFINRUYASI',
        'SEVIMLIDOSTLAR', 'ANIMATION', 'EGEILEGAGA',
        'TRTEBA'
    )) {
        return 'Çocuk';
    }

    // BELGESEL
    if (has(
        'BELGESEL', 'DISCOVERY', 'NATGEO',
        'NATIONALGEOGRAPHIC', 'ANIMALPLANET', 'HISTORY',
        'DOCU', 'YABAN', 'OUTDOOR', 'BBCEARTH',
        'LOVENATURE', 'DMAX', 'TRTBELGESEL', 'IZTV',
        'TARIHTV', 'VIASAT', 'ANIMAUX', 'WILD',
        'JURASSICWORLD', 'MUFFETISGADGET',
        'GIZEMLERDIYARI', 'VIKINGLER', 'CIFTCITV',
        'AGROTV', 'TGRTBELGESEL', 'TLC'
    )) {
        return 'Belgesel';
    }

    // MÜZİK
    if (has(
        'MUZIK', 'MUSIC', 'KLIP', 'POWER', 'KRAL',
        'DUGUN', 'NUMBER1', 'DREAMTURK', 'DREAMTV',
        'NR1', 'MTV', 'TATLISESTV', 'SELDABAGCAN',
        'DAMAR', 'RADIOROCK', 'TURKCEKLASIK',
        'VINTAGE', 'AHMETKAYA', 'MUSLUMGURSES',
        'SONERARICA', 'TARKAN', 'FASILNEVIZADE',
        'SONCBOOM', 'AKUSTIK', 'REDBOXARABESK',
        'REDBOXTURKCEPOP', 'BABARADYO', 'BESTFM'
    )) {
        return 'Müzik';
    }

    // SİNEMA
    if (
        has(
            'SINEMA', 'CINEMA', 'FILM', 'MOVIE', 'DIZI',
            'YESILCAM', 'AKSIYON', 'KOMEDI', 'KORKU',
            'DRAM', 'WESTERN', 'BILIMKURGU', 'ANIMASYON',
            'GLOBALBOX', 'HORROR', 'EPICDRAMA', 'FOXCRIME',
            'DINAMIK', 'DREAM', 'BEST', 'MAX',
            'ULTRAKORKU', 'ULTRAKEMALSUNAL', 'ARENABOX',
            'KINGBOX', 'DUCUBOX', 'SALON', 'SHOWMAX',
            'FIXCINEMA', 'MOVIESMART', 'DIZISMART',
            'ULTRAKSIYON', 'ULTRABILIMKURGU', 'ULTRAKOMEDI'
        ) || starts('FX')
    ) {
        return 'Sinema';
    }

    // YEREL
    if (has(
        'CANAKKALE', 'SANLIURFA', 'ADATV', 'ADIYAMAN',
        'AFYON', 'AKSARAY', 'ANTALYA', 'BURSA',
        'CAYTV', 'DENIZLI', 'EDIRNE', 'ELAZIG',
        'ERZURUM', 'GAZIANTEP', 'KAYSERI', 'KIBRIS',
        'KOCAELI', 'ZONGULDAK', 'KANALV', 'KANAL23',
        'KANAL68', 'KANALZ', 'BRTV', 'VUSLAT',
        'MERCANTV', 'YENIKOCAELI', 'KENTTV', 'ORDU',
        'TRABZON', 'KARADENIZ', 'TUNCELI', 'ESKISEHIR',
        'MANISA', 'ICEL', 'MERSIN', 'ALANYA',
        'AKSUTV', 'DIMTV', 'KANAL32', 'KANAL33',
        'KANAL34', 'KANAL15', 'KANAL12', 'KANAL3',
        'KANAL26', 'KANAL58', 'KANALFIRAT', 'KOZATV',
        'GRTTV', 'KONTV', 'TONTV', 'EDESSA', 'HRT',
        'KANALURFA', 'TVKAYSERI', 'SIVASVIZYON',
        'VIZYON58', 'TVDEN', 'ERCIS', 'TV1',
        'TV264', 'TV41', 'TV42', 'TV52',
        'EGETURK', 'BRT1', 'BRT2', 'BRT3'
    )) {
        return 'Yerel';
    }

    // HABER
    if (
        has(
            'HABER', 'NEWS', 'AKIT', 'BENGUTURK',
            'BENGTURK', 'ULKETV', 'BLOOMBERG',
            'CNNTURK', 'HALKTV', 'SOZCU', 'TELE1',
            'KRT', 'EKOTURK', 'HABERGLOBAL', 'TGRT',
            'TVNET', '24HABER', 'ANEWS', 'FLASHHABER',
            'GURBET24', 'HABER61', 'LIDERHABER',
            'MEDYAHABER', 'VATANTV', 'ULUSALKANAL',
            'APARA', 'ILKETV', 'TRTWORLD', 'KANAL24',
            'TV5', 'YOLTV', 'DHA', 'SZC'
        ) ||
        starts('NTV', '24TV', '24HD', '24RAW', 'EKOLTV', 'TV100') ||
        (starts('24') && !starts('24KITCHEN'))
    ) {
        return 'Haber';
    }

    // ULUSAL GENEL YAYIN
    if (starts(
        'TRT', 'SHOW', 'STAR', 'KANALD', 'NOW',
        'FOX', 'ATV', 'TV8', 'KANAL7', 'BEYAZTV',
        'TEVE2', 'A2', '360', 'TV4', 'EUROD',
        'EUROSTAR', 'SHOWTURK', 'KANAL7AVRUPA',
        'KANAL7EUROPA', 'KANALAVRUPA', 'FLASH'
    )) {
        return 'Ulusal';
    }

    return 'Diğer';
}


function sourceUrl(item: CatalogItem): string {
    return String(
        item.url ||
        item.play ||
        item.href ||
        item.link ||
        ''
    ).trim();
}

/*
 * Stable local channel ID.
 *
 * We hash country + channel name + original catalog URL.
 * The original Vavoo URL is NEVER exposed in the M3U playlist.
 */
function channelHash(
    countryId: string,
    item: CatalogItem
): string {
    const canonical = [
        countryId.toLowerCase(),
        cleanName(item.name),
        sourceUrl(item)
    ].join('|');

    return crypto
        .createHash('sha256')
        .update(canonical, 'utf8')
        .digest('hex')
        .slice(0, 24);
}

function channelId(
    countryId: string,
    item: CatalogItem
): string {
    return `${countryId.toLowerCase()}_${channelHash(countryId, item)}`;
}

function getRequestBaseUrl(req: Request): string {
    const proto = String(
        req.headers['x-forwarded-proto'] ||
        req.protocol ||
        'http'
    )
        .split(',')[0]
        .trim();

    const host = String(
        req.headers['x-forwarded-host'] ||
        req.headers.host ||
        ''
    )
        .split(',')[0]
        .trim();

    if (!host) return '';

    return `${proto}://${host}`;
}

function getClientIp(req: Request): string | null {
    const forwarded = String(
        req.headers['x-forwarded-for'] || ''
    )
        .split(',')[0]
        .trim();

    return (
        forwarded ||
        String(req.headers['cf-connecting-ip'] || '').trim() ||
        String((req.socket as any)?.remoteAddress || '').trim() ||
        null
    );
}

function toIPTVChannel(
    country: Country,
    item: CatalogItem
): IPTVChannel | null {
    const url = sourceUrl(item);

    if (!url) return null;

    const isTurkey = country.id.toLowerCase() === 'tr';

    const displayName = isTurkey
        ? normalizeTurkishChannelName(String(item.name || 'Unknown'))
        : cleanName(item.name);

    return {
        id: channelId(country.id, item),
        name: displayName,
        countryId: country.id,
        countryName: country.name,
        group: isTurkey
            ? getTurkishCategory(displayName)
            : country.name,
        logo: item.poster || item.image || undefined
    };
}

async function findChannel(
    id: string,
    countries: Country[],
    getCountryCatalog: (
        countryId: string
    ) => Promise<CatalogItem[]>
): Promise<{
    country: Country;
    item: CatalogItem;
} | null> {
    const separator = id.indexOf('_');

    if (separator <= 0) return null;

    const countryId = id
        .slice(0, separator)
        .toLowerCase();

    const hash = id
        .slice(separator + 1)
        .toLowerCase();

    const country = countries.find(
        c => c.id.toLowerCase() === countryId
    );

    if (!country) return null;

    if (!/^[a-f0-9]{24}$/.test(hash)) {
        return null;
    }

    const items = await getCountryCatalog(country.id);

    for (const item of items) {
        if (channelHash(country.id, item) === hash) {
            return {
                country,
                item
            };
        }
    }

    return null;
}

export function createIPTVRouter(
    options: IPTVRouterOptions
) {
    const router = express.Router();

    
    /*
     * Shared playlist handler.
     *
     * Used by:
     * /iptv/playlist.m3u
     * /iptv/playlist.m3u?country=tr
     * /iptv/tr.m3u
     * /iptv/de.m3u
     */
    const sendPlaylist = async (
        req: Request,
        res: Response,
        requestedCountry?: string
    ) => {
        try {
            const baseUrl =
                getRequestBaseUrl(req);

            if (!baseUrl) {
                return res
                    .status(400)
                    .send('Cannot determine server base URL');
            }

            const countryFilter =
                requestedCountry
                    ? requestedCountry.trim().toLowerCase()
                    : undefined;

            const countries =
                countryFilter
                    ? options.countries.filter(
                        c =>
                            c.id.toLowerCase() === countryFilter
                    )
                    : options.countries;

            if (
                countryFilter &&
                countries.length === 0
            ) {
                return res
                    .status(404)
                    .send('Unknown country');
            }

            const channels: IPTVChannel[] = [];

            for (const country of countries) {
                const catalogPromise =
                    options.getCountryCatalog(country.id);

                const timeoutPromise =
                    new Promise<never>((_, reject) => {
                        setTimeout(
                            () =>
                                reject(
                                    new Error(
                                        `Catalog timeout for ${country.id}`
                                    )
                                ),
                            15000
                        );
                    });

                const items =
                    await Promise.race([
                        catalogPromise,
                        timeoutPromise
                    ]);

                for (const item of items) {
                    const channel =
                        toIPTVChannel(country, item);

                    if (channel) {
                        channels.push(channel);
                    }
                }
            }

            const playlist =
                buildM3UPlaylist(
                    channels,
                    {
                        baseUrl,
                        countryId: countryFilter
                    }
                );

            res.setHeader(
                'Content-Type',
                'audio/x-mpegurl; charset=utf-8'
            );

            res.setHeader(
                'Cache-Control',
                'no-cache, no-store, must-revalidate'
            );

            res.setHeader(
                'Access-Control-Allow-Origin',
                '*'
            );

            return res.send(playlist);

        } catch (error: any) {
            console.error(
                '[IPTV] Playlist error:',
                error?.message || error
            );

            return res
                .status(500)
                .send('Failed to build IPTV playlist');
        }
    };

    /*
     * GET /iptv/playlist.m3u
     * GET /iptv/playlist.m3u?country=tr
     */
    router.get(
        '/playlist.m3u',
        async (req: Request, res: Response) => {
            const country =
                typeof req.query.country === 'string'
                    ? req.query.country
                    : undefined;

            return sendPlaylist(req, res, country);
        }
    );

    /*
     * GET /iptv/tr.m3u
     * GET /iptv/de.m3u
     * GET /iptv/it.m3u
     * etc.
     */
    router.get(
        '/:country.m3u',
        async (req: Request, res: Response) => {
            const country =
                String(req.params.country || '').trim();

            return sendPlaylist(req, res, country);
        }
    );


    /*
     * GET /iptv/play/:channelId
     *
     * IMPORTANT:
     * No Vavoo URL is stored in the M3U.
     *
     * The channel is resolved here, only when
     * the IPTV player actually starts playback.
     */
    router.get(
        '/play/:channelId',
        async (req: Request, res: Response) => {
            const id =
                String(
                    req.params.channelId || ''
                ).trim();

            if (!id) {
                return res
                    .status(400)
                    .send(
                        'Missing channel id'
                    );
            }

            try {
                const found =
                    await findChannel(
                        id,
                        options.countries,
                        options.getCountryCatalog
                    );

                if (!found) {
                    return res
                        .status(404)
                        .send(
                            'Channel not found'
                        );
                }

                const upstreamUrl =
                    sourceUrl(found.item);

                if (!upstreamUrl) {
                    return res
                        .status(502)
                        .send(
                            'Channel has no upstream URL'
                        );
                }

                const clientIp =
                    getClientIp(req);

                /*
                 * Existing TvVoo LiveManifestManager
                 * performs the actual Vavoo resolution,
                 * token refresh and HLS manifest rewrite.
                 */
                const manifest =
                    await options
                        .liveManifestManager
                        .getLiveManifest(
                            upstreamUrl,
                            clientIp,
                            options
                                .resolveVavooCleanUrl
                        );

                res.setHeader(
                    'Content-Type',
                    'application/vnd.apple.mpegurl'
                );

                res.setHeader(
                    'Cache-Control',
                    'no-cache, no-store, must-revalidate'
                );

                res.setHeader(
                    'Pragma',
                    'no-cache'
                );

                res.setHeader(
                    'Access-Control-Allow-Origin',
                    '*'
                );

                return res.send(manifest);

            } catch (error: any) {
                console.error(
                    '[IPTV] Play error:',
                    {
                        id,
                        message:
                            error?.message ||
                            String(error)
                    }
                );

                return res
                    .status(502)
                    .send(
                        'Unable to resolve IPTV channel'
                    );
            }
        }
    );

    /*
     * Simple IPTV diagnostic endpoint.
     */
    router.get(
        '/health',
        (_req: Request, res: Response) => {
            res.json({
                ok: true,
                service: 'tvvoo-iptv',
                endpoints: [
                    '/iptv/playlist.m3u',
                    '/iptv/country.m3u',
                    '/iptv/play/:channelId'
                ]
            });
        }
    );

    return router;
}

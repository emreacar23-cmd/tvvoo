import crypto from 'crypto';
import express, { Request } from 'express';
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

    return {
        id: channelId(country.id, item),
        name: cleanName(item.name),
        countryId: country.id,
        countryName: country.name,
        group: country.name,
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
     * GET /iptv/playlist.m3u
     *
     * All supported countries.
     *
     * Optional:
     * /iptv/playlist.m3u?country=tr
     */
    router.get(
        '/playlist.m3u',
        async (req, res) => {
            try {
                const baseUrl =
                    getRequestBaseUrl(req);

                if (!baseUrl) {
                    return res
                        .status(400)
                        .send(
                            'Cannot determine server base URL'
                        );
                }

                const countryFilter =
                    typeof req.query.country === 'string'
                        ? req.query.country
                            .trim()
                            .toLowerCase()
                        : undefined;

                const countries =
                    countryFilter
                        ? options.countries.filter(
                            c =>
                                c.id.toLowerCase() ===
                                countryFilter
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
                    const items =
                        await options.getCountryCatalog(
                            country.id
                        );

                    for (const item of items) {
                        const channel =
                            toIPTVChannel(
                                country,
                                item
                            );

                        if (channel) {
                            channels.push(channel);
                        }
                    }
                }

                const playlist =
                    buildM3UPlaylist(
                        channels,
                        {
                            baseUrl:
                                `${baseUrl}/iptv`,
                            countryId:
                                countryFilter
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
                    .send(
                        'Failed to build IPTV playlist'
                    );
            }
        }
    );

    /*
     * GET /iptv/tr.m3u
     * GET /iptv/de.m3u
     * etc.
     */
    router.get(
        '/:country.m3u',
        async (req, res) => {
            const country =
                String(
                    req.params.country || ''
                ).trim();

            const fakeQuery =
                country
                    ? `?country=${encodeURIComponent(country)}`
                    : '';

            req.url =
                `/playlist.m3u${fakeQuery}`;

            return router.handle(
                req,
                res,
                () => undefined
            );
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
        async (req, res) => {
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
        (_req, res) => {
            res.json({
                ok: true,
                service: 'tvvoo-iptv',
                endpoints: [
                    '/iptv/playlist.m3u',
                    '/iptv/tr.m3u',
                    '/iptv/play/:channelId'
                ]
            });
        }
    );

    return router;
}

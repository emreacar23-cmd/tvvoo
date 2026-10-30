import { IPTVChannel, IPTVPlaylistOptions } from './types';

/**
 * M3U özel karakterlerini güvenli hale getirir.
 */
function escapeM3U(value: string): string {
    return String(value ?? '')
        .replace(/"/g, "'")
        .replace(/\r/g, ' ')
        .replace(/\n/g, ' ')
        .trim();
}

/**
 * URL içinde kullanılacak kanal kimliğini kodlar.
 */
function encodeChannelId(id: string): string {
    return encodeURIComponent(id);
}

/**
 * TvVoo kanal listesinden standart M3U playlist oluşturur.
 *
 * Önemli:
 * Burada gerçek Vavoo stream URL'si kullanılmaz.
 * TiviMate/VLC her kanal için TvVoo'nun kendi
 * /iptv/play/:channelId adresine gider.
 */
export function buildM3UPlaylist(
    channels: IPTVChannel[],
    options: IPTVPlaylistOptions
): string {

    const baseUrl = options.baseUrl.replace(/\/+$/, '');

    const filteredChannels = options.countryId
        ? channels.filter(
            channel =>
                channel.countryId.toLowerCase() ===
                options.countryId!.toLowerCase()
        )
        : channels;

    const lines: string[] = ['#EXTM3U'];

    for (const channel of filteredChannels) {
        const id = escapeM3U(channel.id);
        const name = escapeM3U(channel.name);
        const group = escapeM3U(
            channel.group || channel.countryName || 'TvVoo'
        );

        const logo = channel.logo
            ? escapeM3U(channel.logo)
            : '';

        lines.push(
            `#EXTINF:-1 tvg-id="${id}" tvg-name="${name}"` +
            `${logo ? ` tvg-logo="${logo}"` : ''}` +
            ` group-title="${group}",${name}`
        );

        lines.push(
            `${baseUrl}/iptv/play/${encodeChannelId(channel.id)}`
        );
    }

    return lines.join('\n') + '\n';
}

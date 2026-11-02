
import { IPTVChannel, IPTVPlaylistOptions } from './types';
import * as fs from 'fs';
import * as path from 'path';
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
 * Kanal adını sıralama için standartlaştırır.
 */
function normalizeSortKey(name: string): string {
    return name
        .toLocaleUpperCase('tr-TR')
        .replace(/İ/g, 'I')
        .replace(/Ü/g, 'U')
        .replace(/Ğ/g, 'G')
        .replace(/Ş/g, 'S')
        .replace(/Ç/g, 'C')
        .replace(/Ö/g, 'O')
        .replace(/^4K\s*TR\s*:\s*/, '')
        .replace(/^4K\s*/, '')
        .replace(/[^A-Z0-9]/g, '');
}

/**
 * Kanalın yayın kalitesi önceliği.
 */
function getQualityPriority(name: string): number {
    const value = name.toUpperCase();

    if (/\b(4K|UHD)\b/.test(value) || /^4K\s/.test(value)) return 0;
    if (/\bFHD\b/.test(value)) return 1;
    if (/\bHD\b/.test(value)) return 2;
    if (/\bHEVC\b|\bH265\b/.test(value)) return 3;
    if (/\bSD\b/.test(value)) return 4;
    if (/\bRAW\b/.test(value)) return 5;
    if (/\bFEED\b/.test(value)) return 6;

    return 7;
}

/**
 * Ulusal kanalların öncelik sırası.
 */
const NATIONAL_PRIORITY = [
    'TRT1',
    'ATV',
    'KANALD',
    'SHOWTV',
    'STARTV',
    'NOW',
    'FOX',
    'TV8',
    'KANAL7',
    'BEYAZTV',
    'A2',
    'TEVE2',
    '360',
    'TV85',
    'TRT2',
    'TRTTURK',
    'TRTAVAZ',
    'TRTKURDI',
    'EUROD',
    'EUROSTAR',
    'SHOWTURK',
    'KANAL7AVRUPA',
    'KANAL7EUROPA'
];

/**
 * Spor kanallarının öncelik sırası.
 */
const SPORTS_PRIORITY = [
    'BEINSPORTS1',
    'BEINSPORTS2',
    'BEINSPORTS3',
    'BEINSPORTS4',
    'BEINSPORTS5',
    'BEINSPORTSHABER',
    'SSPORT',
    'SSPORT2',
    'TRTSPOR',
    'TRTSPORYILDIZ',
    'ASPOR',
    'TIVIBUSPOR1',
    'TIVIBUSPOR2',
    'TIVIBUSPOR3',
    'TIVIBUSPOR4',
    'TIVIBUSPOR5',
    'SPORTSMART',
    'EXXENSPOR',
    'TABIISPOR',
    'EUROSPORT1',
    'EUROSPORT2',
    'NBATV',
    'TJKTV',
    'HTSPOR',
    'SPORTSTV',
    'REDBULLTV'
];

/**
 * Kanalın gruba göre sıralama önceliğini bulur.
 */
function getChannelPriority(
    name: string,
    group: string
): number {
    const key = normalizeSortKey(name);

    const priorityList =
        group === 'Ulusal'
            ? NATIONAL_PRIORITY
            : group === 'Spor'
                ? SPORTS_PRIORITY
                : [];

    for (let i = 0; i < priorityList.length; i++) {
        if (key.startsWith(priorityList[i])) {
            return i;
        }
    }

    return 9999;
}

/**
 * Yalnızca belirtilen grubun kanal sırasını değiştirir.
 * Diğer grupların mevcut konumlarını korur.
 */
function sortChannelsInGroup(
    channels: IPTVChannel[],
    group: string
): IPTVChannel[] {
    const sortedGroup = channels
        .filter(channel => channel.group === group)
        .map((channel, index) => ({
            channel,
            index
        }))
        .sort((a, b) => {
            const priorityA = getChannelPriority(
                a.channel.name,
                group
            );

            const priorityB = getChannelPriority(
                b.channel.name,
                group
            );

            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }

            const qualityA = getQualityPriority(
                a.channel.name
            );

            const qualityB = getQualityPriority(
                b.channel.name
            );

            if (qualityA !== qualityB) {
                return qualityA - qualityB;
            }

            return a.index - b.index;
        })
        .map(item => item.channel);

    let index = 0;

    return channels.map(channel => {
        if (channel.group !== group) {
            return channel;
        }

        return sortedGroup[index++];
    });
}

/**
 * Kullanıcının düzenlediği M3U dosyasından grup ve kanal sırasını okur.
 * Kanal eşleştirmesi yalnızca sabit tvg-id üzerinden yapılır.
 */
function applyManualPlaylistOrder(
    channels: IPTVChannel[]
): IPTVChannel[] {
    const filePath = path.resolve(
        process.cwd(),
        'playlist-order.m3u'
    );

    let content: string;

    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        console.warn(
            '[IPTV] playlist-order.m3u okunamadı; varsayılan sıralama kullanılacak.'
        );

        let result = [...channels];
        result = sortChannelsInGroup(result, 'Ulusal');
        result = sortChannelsInGroup(result, 'Spor');
        return result;
    }

    type OrderEntry = {
        rank: number;
        group: string;
        groupRank: number;
    };

    const entriesById = new Map<string, OrderEntry[]>();
    const groupRanks = new Map<string, number>();
    const groupEndRanks = new Map<string, number>();

    let rank = 0;

    for (const line of content.split(/\r?\n/)) {
        if (!line.startsWith('#EXTINF')) continue;

        const id = line.match(/\btvg-id="([^"]+)"/)?.[1];
        const group = line.match(/\bgroup-title="([^"]+)"/)?.[1];

        if (!id || !group) continue;

        if (!groupRanks.has(group)) {
            groupRanks.set(group, groupRanks.size);
        }

        const entry: OrderEntry = {
            rank,
            group,
            groupRank: groupRanks.get(group)!
        };

        const existing = entriesById.get(id) || [];
        existing.push(entry);
        entriesById.set(id, existing);

        groupEndRanks.set(group, rank);
        rank++;
    }

    if (entriesById.size === 0) {
        console.warn(
            '[IPTV] M3U sıralama dosyasında geçerli kayıt bulunamadı.'
        );

        let result = [...channels];
        result = sortChannelsInGroup(result, 'Ulusal');
        result = sortChannelsInGroup(result, 'Spor');
        return result;
    }

    const occurrences = new Map<string, number>();
    const knownGroups = new Map(groupRanks);

    let nextGroupRank = knownGroups.size;
    let matchedCount = 0;

    const prepared = channels.map((channel, index) => {
        const idEntries = entriesById.get(channel.id) || [];
        const occurrence = occurrences.get(channel.id) || 0;

        occurrences.set(channel.id, occurrence + 1);

        const entry = idEntries[occurrence];

        let group = entry?.group;

        if (entry) {
            matchedCount++;
        } else {
            const originalGroup =
                channel.group || channel.countryName || 'TvVoo';

            const turkishGroup =
                channel.countryId.toLowerCase() === 'tr'
                    ? `TR ${originalGroup}`
                    : originalGroup;

            if (knownGroups.has(originalGroup)) {
                group = originalGroup;
            } else if (knownGroups.has(turkishGroup)) {
                group = turkishGroup;
            } else {
                group = originalGroup;
            }
        }

        if (!knownGroups.has(group!)) {
            knownGroups.set(group!, nextGroupRank++);
        }

        const groupRank = knownGroups.get(group!)!;

        const channelRank = entry
            ? entry.rank
            : (groupEndRanks.get(group!) ?? -1) + index + 1;

        return {
            channel: {
                ...channel,
                group: group!
            },
            groupRank,
            rank: channelRank,
            index
        };
    });

    if (matchedCount === 0) {
        console.warn(
            '[IPTV] M3U kanal kimlikleri eşleşmedi; varsayılan sıralama kullanılacak.'
        );

        let result = [...channels];
        result = sortChannelsInGroup(result, 'Ulusal');
        result = sortChannelsInGroup(result, 'Spor');
        return result;
    }

    prepared.sort((a, b) =>
        a.groupRank - b.groupRank ||
        a.rank - b.rank ||
        a.index - b.index
    );

    console.log(
        `[IPTV] Manuel sıralama uygulandı: ${matchedCount}/${channels.length} kanal eşleşti.`
    );

    return prepared.map(item => item.channel);
}

/**
 * TvVoo kanal listesinden standart M3U playlist oluşturur.
 *
 * Gerçek Vavoo stream URL'si kullanılmaz.
 * Oynatıcılar TvVoo'nun /iptv/play/:channelId
 * adresini kullanır.
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

    
   // Kullanıcının M3U dosyasındaki grup ve kanal sırasını uygula.
const orderedChannels = applyManualPlaylistOrder(filteredChannels);

    const lines: string[] = ['#EXTM3U'];

    for (const channel of orderedChannels) {
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

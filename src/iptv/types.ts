/**
 * TvVoo IPTV compatibility layer
 *
 * Common types used by the M3U playlist and IPTV stream endpoints.
 */

export interface IPTVChannel {
    id: string;
    name: string;
    countryId: string;
    countryName: string;
    group: string;
    logo?: string;
}

export interface IPTVPlaylistOptions {
    baseUrl: string;
    countryId?: string;
}

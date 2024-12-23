import { promises, unlink } from 'fs-extra'
import SpotifyApi, { IAuth, UserObjectPublic } from './lib/API'
import Artist from './lib/details/Atrist'
import Playlist from './lib/details/Playlist'
import SongDetails from './lib/details/Track'
import { downloadYT, downloadYTAndSave } from './lib/download'
import SpotifyDlError from './lib/Error'
import getYtlink from './lib/getYtlink'
import metadata from './lib/metadata'
import path from 'path'

export default class SpotifyFetcher extends SpotifyApi {
    constructor(auth: IAuth) {
        super(auth)
    }

    /**
     * Get the track details of the given track URL
     * @param url
     * @returns {SongDetails} Track
     */
    getTrack = async (url: string): Promise<SongDetails> => {
        await this.verifyCredentials()
        return await this.extractTrack(this.getID(url))
    }

    /**
     * Gets the info the given album URL
     * @param url
     * @returns {Playlist} Album
     */
    getAlbum = async (url: string): Promise<Playlist> => {
        await this.verifyCredentials()
        return await this.extractAlbum(this.getID(url))
    }

    /**
     * Gets the info of the given Artist URL
     * @param url
     * @returns {Artist} Artist
     */
    getArtist = async (url: string): Promise<Artist> => {
        await this.verifyCredentials()
        return await this.extractArtist(this.getID(url))
    }

    /**
     * Gets the list of albums from the given Artists URL
     * @param url
     * @returns {Playlist[]} Albums
     */
    getArtistAlbums = async (
        url: string
    ): Promise<{
        albums: Playlist[]
        artist: Artist
    }> => {
        await this.verifyCredentials()
        const artistResult = await this.getArtist(url)
        const albumsResult = await this.extractArtistAlbums(artistResult.id)
        const albumIds = albumsResult.map((album) => album.id)
        const albumInfos = []
        for (let x = 0; x < albumIds.length; x++) {
            albumInfos.push(await this.extractAlbum(albumIds[x]))
        }
        return {
            albums: albumInfos,
            artist: artistResult
        }
    }

    /**
     * Gets the playlist info from URL
     * @param url URL of the playlist
     * @returns
     */
    getPlaylist = async (url: string): Promise<Playlist> => {
        await this.verifyCredentials()
        return await this.extractPlaylist(this.getID(url))
    }

    getID = (url: string): string => {
        const splits = url.split('/')
        return splits[splits.length - 1]
    }

    /**
     * Downloads the given spotify track
     * @param url Url to download
     * @param filename file to save to
     * @returns `buffer` if no filename is provided and `string` if it is
     */
    downloadTrack = async <T extends undefined | string>(
        url: string,
        destinationDir: string,
        data1: any
    ): Promise<T extends undefined ? Buffer : string> => {
        await this.verifyCredentials()

        // Fetch track information
        const info = await this.getTrack(url)

        // Get YouTube link based on track name and first artist
        const artistNames = info.artists.length > 1 ? info.artists.join(', ') : info.artists[0]
        const link = await getYtlink(`${artistNames} - ${info.name}`)

        if (!link) {
            throw new SpotifyDlError(`Couldn't get a download URL for the track: ${artistNames} - ${info.name}`)
        }

        // Retry mechanism for downloadYTAndSave
        const maxRetries = 3
        let attempt = 0
        let data: string | null = null

        while (attempt < maxRetries) {
            try {
                data = await downloadYTAndSave(link, destinationDir, data1) // Attempt to download
                if (data) break // Exit loop if download is successful
            } catch (error) {
                console.log(error)
                attempt++
                if (attempt >= maxRetries) {
                    throw new SpotifyDlError(
                        `Failed to download and save the track: ${artistNames} - ${info.name} after ${maxRetries} attempts.`
                    )
                }
                console.warn(`Retrying download (${attempt}/${maxRetries}) for ${artistNames} - ${info.name}...`)
            }
        }

        // Add metadata only after the file is downloaded
        if (!data) {
            throw new SpotifyDlError(`Download returned an invalid path for the track: ${artistNames} - ${info.name}`)
        }
        await metadata(info, data)

        // Handle buffer response when `destinationDir` is not provided
        if (!destinationDir) {
            const buffer = await promises.readFile(data)
            await unlink(data) // Remove the temporary file after reading
            return buffer as any
        }

        // Return the file path for saved data
        return {
            path: destinationDir,
            artists: Array.isArray(info.artists) ? info.artists : [info.artists], // Ensure artists is an array
            name: info.name
        } as any
    }

    /**
     * Gets the Buffer of track from the info
     * @param info info of the track got from `spotify.getTrack()`
     * @returns
     */
    downloadTrackFromInfo = async (info: SongDetails, destinationDir: string, data: any): Promise<Buffer> => {
        const link = await getYtlink(`${info.name} ${info.artists[0]}`)
        if (!link) throw new SpotifyDlError(`Couldn't get a download URL for the track: ${info.name}`)
        return await downloadYT(link, destinationDir, data)
    }

    private downloadBatch = async (
        url: string,
        type: 'album' | 'playlist',
        destinationDir: string,
        data1: any
    ): Promise<(string | Buffer)[]> => {
        await this.verifyCredentials()
        const playlist = await this[type === 'album' ? 'getAlbum' : 'getPlaylist'](url)
        return Promise.all(
            playlist.tracks.map(async (track) => {
                try {
                    // Fetch track information
                    const info = await this.getTrack(`https://open.spotify.com/track/${track}`)

                    // Get YouTube link based on track name and first artist
                    const artistNames = info.artists.length > 1 ? info.artists.join(', ') : info.artists[0]
                    const trackPath = path.join(destinationDir, `${artistNames} - ${info.name}.mp3`)
                    return await this.downloadTrack(`https://open.spotify.com/track/${track}`, trackPath, data1)
                } catch (err) {
                    return ''
                }
            })
        )
    }

    /**
     * Downloads the tracks of a playlist
     * @param url URL of the playlist
     * @returns `Promise<(string|Buffer)[]>`
     */
    downloadPlaylist = async (url: string, destinationDir: string, data1: any): Promise<(string | Buffer)[]> =>
        await this.downloadBatch(url, 'playlist', destinationDir, data1)

    /**
     * Downloads the tracks of a Album
     * @param url URL of the Album
     * @returns `Promise<(string|Buffer)[]>`
     */
    downloadAlbum = async (url: string, destinationDir: string, data1: any): Promise<(string | Buffer)[]> =>
        await this.downloadBatch(url, 'album', destinationDir, data1)

    /**
     * Gets the info of tracks from playlist URL
     * @param url URL of the playlist
     */
    getTracksFromPlaylist = async (
        url: string
    ): Promise<{ name: string; total_tracks: number; tracks: SongDetails[] }> => {
        await this.verifyCredentials()
        const playlist = await this.getPlaylist(url)
        const tracks = await Promise.all(playlist.tracks.map((track) => this.getTrack(track)))
        return {
            name: playlist.name,
            total_tracks: playlist.total_tracks,
            tracks
        }
    }

    /**
     * Gets the info of tracks from Album URL
     * @param url URL of the playlist
     */
    getTracksFromAlbum = async (
        url: string
    ): Promise<{ name: string; total_tracks: number; tracks: SongDetails[] }> => {
        await this.verifyCredentials()
        const playlist = await this.getAlbum(url)
        const tracks = await Promise.all(playlist.tracks.map((track) => this.getTrack(track)))
        return {
            name: playlist.name,
            total_tracks: playlist.total_tracks,
            tracks
        }
    }

    getSpotifyUser = async (id: string): Promise<UserObjectPublic> => await this.getUser(id)
}

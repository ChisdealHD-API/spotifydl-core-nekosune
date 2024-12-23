import SpotifyAPI from 'spotify-web-api-node'
import Artist from './details/Atrist'
import Playlist from './details/Playlist'
import TrackDetails from './details/Track'

const MAX_LIMIT_DEFAULT = 50
const REFRESH_ACCESS_TOKEN_SECONDS = 55 * 60

export default class SpotifyApi {
    private spotifyAPI: SpotifyAPI

    nextTokenRefreshTime!: Date

    constructor(private auth: IAuth) {
        this.spotifyAPI = new SpotifyAPI(this.auth)
    }

    verifyCredentials = async (): Promise<void> => {
        if (!this.nextTokenRefreshTime || this.nextTokenRefreshTime < new Date()) {
            this.nextTokenRefreshTime = new Date()
            this.nextTokenRefreshTime.setSeconds(this.nextTokenRefreshTime.getSeconds() + REFRESH_ACCESS_TOKEN_SECONDS)
            await this.checkCredentials()
        }
    }

    checkCredentials = async (): Promise<void> => {
        if (!(await this.spotifyAPI.getRefreshToken())) return void (await this.requestTokens())
        await this.refreshToken()
    }

    requestTokens = async (): Promise<void> => {
        const data = (await this.spotifyAPI.clientCredentialsGrant()).body
        this.spotifyAPI.setAccessToken(data['access_token'])
        this.spotifyAPI.setRefreshToken((data as ClientCredentialsGrantResponseEX)['refresh_token'])
    }

    refreshToken = async (): Promise<void> => {
        const data = (await this.spotifyAPI.refreshAccessToken()).body
        this.spotifyAPI.setAccessToken(data['access_token'])
    }

    extractTrack = async (trackId: string): Promise<TrackDetails> => {
        const data = (await this.spotifyAPI.getTrack(trackId)).body
        const details = new TrackDetails()
        details.name = data.name
        data.artists.forEach((artist) => {
            details.artists.push(artist.name)
        })
        details.album_name = data.album.name
        details.release_date = data.album.release_date
        details.cover_url = data.album.images[0].url
        return details
    }

    extractPlaylist = async (playlistId: string): Promise<Playlist> => {
        console.log(`Starting playlist extraction for ID: ${playlistId}`)

        let data
        try {
            data = (await this.spotifyAPI.getPlaylist(playlistId)).body
            console.log(`Fetched playlist details: ${data.name}`)
        } catch (error) {
            console.error(`Failed to fetch playlist details:`, error)
            throw new Error('Unable to fetch playlist. Verify the playlist ID and permissions.')
        }

        const details = new Playlist(
            '',
            [],
            0,
            data.tracks.items.map((item) => {
                console.log(`Processing track ID: ${item.track?.id}`)
                return item.track!.id
            })
        )

        details.name = `${data.name} - ${data.owner.display_name}`
        details.total_tracks = data.tracks.total
        details.artists = data.owner.display_name ? [data.owner.display_name] : []

        console.log(`Playlist name: ${details.name}`)
        console.log(`Total tracks: ${details.total_tracks}`)
        console.log(`Initial tracks fetched: ${details.tracks.length}`)

        if (data.tracks.next) {
            const pages = Math.ceil(details.total_tracks / MAX_LIMIT_DEFAULT)
            let offset = 0

            console.log(
                `Starting pagination. Total tracks: ${details.total_tracks}, Initial offset: ${offset}, Total pages: ${pages}`
            )

            while (offset < details.total_tracks) {
                try {
                    console.log(
                        `Fetching additional tracks. Page: ${Math.floor(offset / MAX_LIMIT_DEFAULT) + 1}, Offset: ${offset}, Limit: ${MAX_LIMIT_DEFAULT}`
                    )
                    const playlistTracksData = (
                        await this.spotifyAPI.getPlaylistTracks(playlistId, {
                            limit: MAX_LIMIT_DEFAULT,
                            offset: offset
                        })
                    ).body

                    // If there are no tracks returned, break out of the loop
                    if (playlistTracksData.items.length === 0) {
                        console.log('No more tracks to fetch.')
                        break
                    }

                    // Add the fetched track IDs to the details
                    details.tracks = details.tracks.concat(
                        playlistTracksData.items.map((item) => {
                            console.log(`Processing additional track ID: ${item.track?.id}`)
                            return item.track!.id
                        })
                    )

                    console.log(
                        `Fetched ${playlistTracksData.items.length} additional tracks. Total: ${details.tracks.length}`
                    )

                    // Increment the offset by the number of items fetched (limit)
                    offset += MAX_LIMIT_DEFAULT

                    // If `next` exists, it means more pages are available, so continue fetching.
                    if (!playlistTracksData.next) {
                        console.log('All tracks fetched.')
                        break
                    }

                    // Delay to avoid hitting API rate limits
                    await new Promise((resolve) => setTimeout(resolve, 500))
                } catch (error) {
                    console.error(`Failed to fetch additional tracks at offset ${offset}:`, error)
                    throw new Error('Error while fetching additional tracks.')
                }
            }
        }

        console.log(`Playlist extraction complete. Total tracks: ${details.tracks.length}`)
        return details
    }

    extractAlbum = async (albumId: string): Promise<Playlist> => {
        const data = (await this.spotifyAPI.getAlbum(albumId)).body
        const details = new Playlist(
            '',
            [],
            0,
            data.tracks.items.map((item) => item.id)
        )
        details.name = data.name + ' - ' + data.label + ' - ' + data.artists[0].name
        details.total_tracks = data.tracks.total
        data.artists.forEach((artist) => {
            details.artists.push(artist.name)
        })
        if (data.tracks.next) {
            let offset = details.tracks.length
            while (details.tracks.length < data.tracks.total) {
                const albumTracks = (
                    await this.spotifyAPI.getAlbumTracks(albumId, { limit: MAX_LIMIT_DEFAULT, offset: offset })
                ).body
                details.tracks = details.tracks.concat(albumTracks.items.map((item) => item.id))
                offset += MAX_LIMIT_DEFAULT
            }
        }
        return details
    }

    extractArtist = async (artistId: string): Promise<Artist> => {
        const data = (await this.spotifyAPI.getArtist(artistId)).body
        return new Artist(data.id, data.name, data.href)
    }

    extractArtistAlbums = async (artistId: string): Promise<SpotifyApi.AlbumObjectSimplified[]> => {
        const artistAlbums = (await this.spotifyAPI.getArtistAlbums(artistId, { limit: MAX_LIMIT_DEFAULT })).body
        let albums = artistAlbums.items
        if (artistAlbums.next) {
            let offset = albums.length
            while (albums.length < artistAlbums.total) {
                const additionalArtistAlbums = (
                    await this.spotifyAPI.getArtistAlbums(artistId, { limit: MAX_LIMIT_DEFAULT, offset: offset })
                ).body

                albums = albums.concat(additionalArtistAlbums.items)
                offset += MAX_LIMIT_DEFAULT
            }
        }
        return albums
    }

    getUser = async (id: string): Promise<UserObjectPublic> => {
        await this.verifyCredentials()
        return (await this.spotifyAPI.getUser(id)) as UserObjectPublic
    }
}

export interface IAuth {
    clientId: string
    clientSecret: string
}

interface ClientCredentialsGrantResponseEX {
    access_token: string
    expires_in: number
    token_type: string
    refresh_token: string
}

export interface UserObjectPublic {
    display_name?: string
    external_urls?: {
        spotify: string
    }
    followers?: {
        href?: null
        total: string
    }
    href?: string
    id?: string
    images?: ImageObject[]
    type?: 'user'
    uri?: string
}

export interface ImageObject {
    height?: number
    url: string
    width?: number
}

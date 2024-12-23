import os from 'os'
import { execSync } from 'child_process'

let ytdlPath

// Function to check if yt-dlp is installed
const checkYTDLPInstalled = () => {
    try {
        // Execute the command to check yt-dlp version
        const output = execSync('yt-dlp --version', { stdio: 'ignore' })
        return true
    } catch (error) {
        return false
    }
}

// Function to get the correct path based on the OS
const getYTDLPPath = () => {
    if (os.platform() === 'win32') {
        // Windows specific path
        return './yt-dlp.exe' // Adjust this if necessary
    } else if (os.platform() === 'darwin') {
        // macOS specific path
        return '/usr/local/bin/yt-dlp' // Adjust this if necessary
    } else if (os.platform() === 'linux') {
        // Linux specific path
        return '/usr/local/bin/yt-dlp' // Adjust this if necessary
    } else {
        throw new SpotifyDlError('Unsupported operating system', 'SpotifyDlError')
    }
}

// Initialize ytdlPath
try {
    if (checkYTDLPInstalled()) {
        ytdlPath = getYTDLPPath()
        console.log(`Using yt-dlp at: ${ytdlPath}`)
    } else {
        throw new SpotifyDlError('yt-dlp is not installed', 'SpotifyDlError')
    }
} catch (error) {
    if (error instanceof SpotifyDlError) {
        console.error(`SpotifyDlError: ${error.message}`)
    } else {
        console.error(`Unexpected Error`)
    }
}

// Create yt-dlp instance
import { create as createYoutubeDl } from 'yt-dlp-exec'
const ytdl = createYoutubeDl(ytdlPath)

import SpotifyDlError from './Error'
import { readFile, unlink, writeFile, move, createReadStream } from 'fs-extra'
import axios from 'axios'
import { Buffer } from 'buffer' // Ensure Buffer is imported
import Ffmpeg from 'fluent-ffmpeg'

interface IYTDLData {
    cookiesFromBrowser?: string;
}

/**
 * Function to download the give `YTURL`
 * @param {string} url The youtube URL to download
 * @returns `Buffer`
 * @throws Error if the URL is invalid
 */
export const downloadYT = async (url: string, destinationDir: string, data: IYTDLData): Promise<Buffer> => {
    const outputPathTemp = `${os.tmpdir()}/${Math.random().toString(36).slice(-5)}.mp3`
    const outputPath = `${destinationDir}`

    const cookiesFromBrowser1 = data.cookiesFromBrowser || ''
    
    return new Promise(async (resolve, reject) => {
        // Bypass TypeScript type checking for the unknown 'cookiesFromBrowser' property
        const options = {
            extractAudio: true,
            audioFormat: 'mp3',
            cookiesFromBrowser: cookiesFromBrowser1,
            audioQuality: 0,
            output: `${outputPathTemp}`,
            referer: `${url}`,
        }
        
        // Get the stream from yt-dlp
        ytdl(url, options).then(async () => {
            Ffmpeg()
                .input(outputPathTemp)
                .audioBitrate(128)
                .save(outputPath) // Save the processed file
                .on('end', async () => {
                    const buffer = await readFile(`${outputPath}`)
                    unlink(outputPathTemp)
                    resolve(buffer)
                })
                .on('error', (err) => reject(err))
        })
    })
}

/**
 * Function to download and save audio from youtube
 * @param url URL to download
 * @param filename the file to save to
 * @returns filename
 */
export const downloadYTAndSave = async (url: string, destinationDir: string, data: any): Promise<string> => {
    const audio = await downloadYT(url, destinationDir, data)
    try {
        await writeFile(`${destinationDir}`, audio)
        // Move the file to the specified destination
        return `${destinationDir}`
    } catch (err) {
        throw new SpotifyDlError(`Error While writing to File: ${destinationDir}`)
    }
}

/**
 * Function to get buffer of files with their URLs
 * @param url URL to get Buffer of
 * @returns Buffer
 */
export const getBufferFromUrl = async (url: string): Promise<Buffer> =>
    (await axios.get(url, { responseType: 'arraybuffer' })).data

<h1 align="center">
  <br>
  <img src=".github/assets/video-stream.png" alt="Live" width="200">
  <br>
   VideoStream lib for <a href="https://discord.com/">Discord</a>
  <br>
</h1>

<p align="center">
  <strong>An open-source Discord lib to stream videos on voice channels.</strong>
</p>

<p align="center">
  <img src="https://wakatime.com/badge/user/e61842d0-c588-4586-96a3-f0448a434be4/project/018e873e-020a-463f-b474-43dded13bc1d.svg" alt="waka" />
  <img src="https://img.shields.io/github/license/gabrielmaialva33/discord-video-stream?color=00b8d3?style=flat&logo=appveyor" alt="License" />
  <img src="https://img.shields.io/github/languages/top/gabrielmaialva33/discord-video-stream?style=flat&logo=appveyor" alt="GitHub top language" >
  <img src="https://img.shields.io/github/languages/count/gabrielmaialva33/discord-video-stream?style=flat&logo=appveyor" alt="GitHub language count" >
  <img src="https://img.shields.io/github/repo-size/gabrielmaialva33/discord-video-stream?style=flat&logo=appveyor" alt="Repository size" >
  <a href="https://github.com/gabrielmaialva33/discord-video-stream/commits/master">
    <img src="https://img.shields.io/github/last-commit/gabrielmaialva33/discord-video-stream?style=flat&logo=appveyor" alt="GitHub last commit" >
    <img src="https://img.shields.io/badge/made%20by-Maia-15c3d6?style=flat&logo=appveyor" alt="Maia" >  
  </a>
</p>

<br>

<p align="center">
  <a href="#bookmark-about">About</a>&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;
  <a href="#rocket-features">Features</a>&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;
  <a href="#construction-implementation">Implementation</a>&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;
  <a href="#computer-requirements">Requirements</a>&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;
  <a href="#package-usage">Usage</a>&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;
  <a href="#arrow_down-faqs">FAQS</a>&nbsp;&nbsp;&nbsp;
</p>

<br>

> [!CAUTION]
> Using any kind of automation programs on your account can result in your account getting permanently banned by
> Discord. Use at your own risk

## :bookmark: About

This project implements the custom Discord UDP protocol for sending media. Since Discord is likely change their custom
protocol, this library is subject to break at any point. An effort will be made to keep this library up to date with the
latest Discord protocol, but it is not guranteed.

For better stability it is recommended to use WebRTC protocol instead since Discord is forced to adhere to spec, which
means that the non-signaling code is guaranteed to work.

<br>

## :rocket: **Features**

- Playing vp8 or h264 video in a voice channel (`go live`, or webcam video)
- Playing opus audio in a voice channel

<br>

## :construction: **Implementation**

What I implemented and what I did not.

#### Video codecs

- [x] VP8
- [ ] VP9
- [x] H.264
- [x] H.265

#### Packet types

- [x] RTP (sending of realtime data)
- [ ] RTX (retransmission)

#### Connection types

- [x] Regular Voice Connection
- [x] Go live

#### Extras

- [x] Figure out rtp header extensions (discord specific) (discord seems to use one-byte RTP header
      extension https://www.rfc-editor.org/rfc/rfc8285.html#section-4.2)

Extensions supported by Discord (taken from the webrtc sdp exchange):

```
a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level
a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01
a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid
a=extmap:5 http://www.webrtc.org/experiments/rtp-hdrext/playout-delay
a=extmap:6 http://www.webrtc.org/experiments/rtp-hdrext/video-content-type
a=extmap:7 http://www.webrtc.org/experiments/rtp-hdrext/video-timing
a=extmap:8 http://www.webrtc.org/experiments/rtp-hdrext/color-space
a=extmap:10 urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id
a=extmap:11 urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id
a=extmap:13 urn:3gpp:video-orientation
a=extmap:14 urn:ietf:params:rtp-hdrext:toffset
```

<br>

## :computer: Requirements

- **[FFmpeg](https://ffmpeg.org/download.html)** is required for the usage of this package. If you are on linux you can
  easily install ffmpeg from your
  distribution's package manager.

  ```sh
    # For Ubuntu
    $ sudo apt-get install ffmpeg
    # For MacOS
    $ brew install ffmpeg
  ```

- **[discord.js-selfbot-v13](https://www.npmjs.com/package/discord.js-selfbot-v13)** is required for the usage of this
  package. If you are on linux you can easily install discord.js-selfbot-v13 from your

  ```sh
    $ pnpm add discord.js-selfbot-v13
  ```

<br>

## :package: Usage

Create a new client, and patch its events to listen for voice gateway events:

```typescript
import { Client } from 'discord.js-selfbot-v13'
import { Streamer } from '@gabrielmaialva33/discord-video-stream'

const streamer = new Streamer(new Client())
await streamer.client.login('TOKEN HERE')
```

Make client join a voice channel:

```typescript
await streamer.joinVoice('GUILD ID HERE', 'CHANNEL ID HERE')
```

### Using the new API

The new API provides two main functions: `prepareStream` and `playStream` that make it easier to stream media.

#### Option 1: Stream directly from a URL or file

```typescript
import { prepareStream, playStream } from '@gabrielmaialva33/discord-video-stream'

// Prepare the stream (transcodes video using FFmpeg)
const { output } = prepareStream('VIDEO_URL_OR_FILE_PATH', {
  videoCodec: 'H264',     // Supports: 'H264', 'H265', 'VP8', 'VP9', 'AV1'
  width: 1280,            // Video width (default: -2, maintains aspect ratio)
  height: 720,            // Video height (default: -2, maintains aspect ratio)
  bitrateVideo: 5000,     // Video bitrate in kbps
  includeAudio: true,     // Include audio track
})

// Play the stream to Discord
await playStream(output, streamer, {
  type: 'go-live',        // Stream type: 'go-live' or 'camera'
  streamPreview: true,    // Enable stream preview thumbnail
})
```

#### Option 2: Stream from an existing Readable stream

```typescript
import { playStream } from '@gabrielmaialva33/discord-video-stream'

// If you already have a properly encoded video stream
// (e.g., from FFmpeg or another source)
const videoStream = getVideoStreamFromSomewhere()

await playStream(videoStream, streamer, {
  type: 'go-live'         // 'go-live' for screen sharing or 'camera' for webcam
})
```

#### Available Configuration Options

##### `prepareStream` Options

```typescript
// Advanced stream preparation options
const { output } = prepareStream(inputStream, {
  // Disable video transcoding. If true, all video-related settings below
  // have no effect, and the input stream is used as-is.
  // Only use this if your video is already Discord-friendly!
  noTranscoding: false,           
  
  // Video dimensions
  width: 1280,                    // Output width (use -2 to maintain aspect ratio)
  height: 720,                    // Output height (use -2 to maintain aspect ratio)
  frameRate: 30,                  // Target frame rate
  
  // Bitrate settings
  bitrateVideo: 5000,             // Video average bitrate in kbps
  bitrateVideoMax: 7000,          // Video maximum bitrate in kbps
  bitrateAudio: 128,              // Audio bitrate in kbps
  
  // Video codec (one of: 'H264', 'H265', 'VP8', 'VP9', 'AV1')
  videoCodec: 'H264',             
  
  // Performance options
  includeAudio: true,             // Enable audio output
  hardwareAcceleratedDecoding: true, // Use hardware acceleration for decoding
  minimizeLatency: true,          // Optimize for low latency
  
  // H264/H265 encoding preset (faster = lower quality)
  // ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow, placebo
  h26xPreset: 'ultrafast',

  // HTTP request customization
  customHeaders: {                // Custom headers for HTTP requests
    'User-Agent': '...',
    'Connection': 'keep-alive'
  },
  
  // Advanced options
  customFfmpegFlags: [],          // Additional FFmpeg command line flags
})
```

##### `playStream` Options

```typescript
// Streaming options
await playStream(videoStream, streamer, {
  // Stream type: 'go-live' (screen sharing) or 'camera' (webcam video)
  type: 'go-live',
  
  // These parameters override the video properties sent to Discord
  // DO NOT SPECIFY UNLESS YOU KNOW WHAT YOU'RE DOING!
  width: 1280,                    // Override video width 
  height: 720,                    // Override video height
  frameRate: 30,                  // Override frame rate
  
  // Initial burst settings (reduces initial buffering)
  // Same as ffmpeg's readrate_initial_burst flag
  // See: https://ffmpeg.org/ffmpeg.html#:~:text=%2Dreadrate_initial_burst
  readrateInitialBurst: 5,        // Seconds of video to buffer initially
  
  // Enable stream preview thumbnail in Discord
  streamPreview: true,            // Show preview of the stream in Discord UI
})
```

##### `Streamer` Options

```typescript
// These control internal operations of the library and can be configured 
// through the opts property on the Streamer class
const streamer = new Streamer(client, {
  // Enables sending RTCP sender reports to help the receiver synchronize 
  // audio/video frames. Can be disabled in certain edge cases.
  rtcpSenderReportEnabled: true,
  
  // Encryption options - ChaCha20-Poly1305 is faster than AES-256-GCM,
  // except when using hardware-accelerated AES-NI
  forceChacha20Encryption: false
})
```

<br>

### :arrow_down: FAQS

- Can I stream on existing voice connection (CAM) and in a go-live connection simultaneously?

Yes, just send the media packets over both udp connections. The voice gateway expects you to signal when a user turns on
their camera, so make sure you signal using `client.signalVideo(guildId, channelId, true)` before you start sending cam
media packets.

- Does this library work with bot tokens?

No, Discord blocks video from bots which is why this library uses a selfbot library as peer dependency. You must use a
user token

<br>

## :memo: License

This project is under the **MIT** license. [MIT](./LICENSE) ❤️

<br>

## :rocket: **Contributors**

| [![Maia](https://avatars.githubusercontent.com/u/26732067?size=100)](https://github.com/gabrielmaialva33) |
|-----------------------------------------------------------------------------------------------------------|
| [Maia](https://github.com/gabrielmaialva33)                                                               |

### Special Thanks

A huge thank you to [mrjvs](https://github.com/mrjvs) for their inspiring work
on [Discord-video-experiment](https://github.com/mrjvs/Discord-video-experiment). Their contributions have been
invaluable!

## :star:

Liked? Leave a little star to help the project ⭐

<br/>
<br/>

<p align="center"><img src="https://raw.githubusercontent.com/gabrielmaialva33/gabrielmaialva33/master/assets/gray0_ctp_on_line.svg?sanitize=true" /></p>
<p align="center">&copy; 2017-present <a href="https://github.com/gabrielmaialva33/" target="_blank">Maia</a>

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

Extensions supported by Discord (taken from the webrtc sdp exchange)

<br>

## :computer: Requirements

- **[FFmpeg](https://ffmpeg.org/download.html)** is required for the usage of this package. If you are on linux you can
  easily install ffmpeg from your
  distribution's package manager.

  ```sh
    $ sudo apt-get install ffmpeg
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

Make client join a voice channel and create a stream:

```typescript
await streamer.joinVoice('GUILD ID HERE', 'CHANNEL ID HERE')
const udp = await streamer.createStream()
```

Start sending media over the udp connection:

```typescript
udp.mediaConnection.setSpeaking(true)
udp.mediaConnection.setVideoStatus(true)
try {
  const res = await streamLivestreamVideo('DIRECT VIDEO URL OR READABLE STREAM HERE', udp)

  console.log('Finished playing video ' + res)
} catch (e) {
  console.log(e)
} finally {
  udp.mediaConnection.setSpeaking(false)
  udp.mediaConnection.setVideoStatus(false)
}
```

<br>

### :arrow_down: \*\*FAQS

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
| --------------------------------------------------------------------------------------------------------- |
| [Maia](https://github.com/gabrielmaialva33)                                                               |

Made with ❤️ by Maia 👋🏽 [Get in touch!](https://t.me/mrootx)

## :star:

Liked? Leave a little star to help the project ⭐

<br/>
<br/>

<p align="center"><img src="https://raw.githubusercontent.com/gabrielmaialva33/gabrielmaialva33/master/assets/gray0_ctp_on_line.svg?sanitize=true" /></p>
<p align="center">&copy; 2017-present <a href="https://github.com/gabrielmaialva33/" target="_blank">Maia</a>

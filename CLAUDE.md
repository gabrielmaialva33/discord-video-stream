# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
# Install dependencies
pnpm install

# Build the project
pnpm build

# Lint the code
pnpm lint

# Format the code
pnpm format

# Publishing (for maintainers)
pnpm publish
```

## Project Architecture

This library provides functionality to stream video and audio to Discord voice channels using a user token (not a bot token). It implements Discord's custom UDP protocol for sending media.

### Core Components

1. **Streamer (`src/client/streamer.ts`)**
   - Main entry point for using the library
   - Handles connection to voice channels and stream creation
   - Manages lifecycle of voice and stream connections
   - Key methods: `joinVoice()`, `createStream()`, `stopStream()`, `leaveVoice()`

2. **Media Connections**
   - `VoiceConnection`: Manages regular voice channel connection
   - `StreamConnection`: Handles Go Live streaming connection
   - `MediaUdp`: Manages UDP socket communication

3. **Media Packetizers**
   - Convert media frames to RTP packets
   - Codec-specific implementations:
     - `VideoPacketizerAnnexB`: For H.264/H.265
     - `VideoPacketizerVP8`: For VP8
     - `AudioPacketizer`: For Opus audio

4. **Media Streams**
   - `VideoStream`: Handles video frame timing and delivery
   - `AudioStream`: Manages audio frame delivery
   - Uses LibAV for demuxing and decoding

5. **Encryption**
   - Implements encryption for media packets
   - Supports AES256 and ChaCha20

### Data Flow

1. Client joins a voice channel via `Streamer.joinVoice()`
2. Stream is created with `Streamer.createStream()`
3. Media is processed and packetized according to codec
4. Packets are encrypted and sent over UDP
5. Discord receives and plays the media in the voice channel

## Working with the Code

- The codebase uses TypeScript with ES modules
- FFmpeg is required for media transcoding
- The library depends on `discord.js-selfbot-v13` for Discord API interaction
- Node.js v22.13.1+ is required

### Implementation Details

- The library handles the signaling process for both regular voice channels and Go Live streams
- Gateway events are processed through a custom event emitter
- Encryption is configurable (AES256 is default, ChaCha20 is optional)
- RTP packetization follows WebRTC standards with Discord-specific extensions

### Development Workflow

1. Make changes to the TypeScript source files
2. Run `pnpm format` to ensure code style consistency
3. Run `pnpm lint` to check for code issues
4. Run `pnpm build` to compile TypeScript to JavaScript
5. Test changes with a sample implementation

## Important Considerations

- This library implements Discord's custom protocol which may change at any time
- Using self-bot functionality is against Discord's Terms of Service and may result in account termination
- The library supports VP8, H.264, and H.265 video codecs
- RTP packetization follows WebRTC standards with Discord-specific modifications
- Stream preview functionality is available via `setStreamPreview()` method
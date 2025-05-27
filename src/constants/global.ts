import { WebRtcTransportOptions, RtpCodecCapability } from 'mediasoup/types'

export const PORT = 4000
export const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:3000'
export const CLIENT_SPECIFIER_SECRET = process.env.CLIENT_SPECIFIER_SECRET
export const RECORDER_SPECIFIER_SECRET = process.env.RECORDER_SPECIFIER_SECRET

export const MEDIASOUP_TRANSPORT_OPTIONS: WebRtcTransportOptions = {
  listenInfos: [
    {
      protocol: 'udp',
      ip: '127.0.0.1'
    }
  ],
  enableUdp: true
}

export const MEDIASOUP_ROUTER_CODECS: RtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1
    }
  }
]

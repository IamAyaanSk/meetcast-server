import { TCreateWebRtcTransport, TProduceMedia } from '@/types/common'
import { DtlsParameters, MediaKind, RtpCapabilities, RtpParameters } from 'mediasoup/types'

interface ServerToClientEvents {
  producers: (params: { producerSocketId: string; paused: boolean }[]) => void
  participantConnected: (socketId: string) => void
  participantDisconnected: (socketId: string) => void

  producerPaused: (params: { producerSocketId: string; kind: MediaKind }) => void
  producerResumed: (params: { producerSocketId: string; kind: MediaKind }) => void
}

interface ClientToServerEvents {
  getRouterRtpCapabilities: (callback: (props: { routerRtpCapabilities: RtpCapabilities }) => void) => void
  createWebRtcTransport: (
    props: { isSender: TCreateWebRtcTransport['isSender'] },
    callback: TCreateWebRtcTransport['callback']
  ) => void
  connectWebRtcTransport: (params: { dtlsParameters: DtlsParameters; isSender: boolean }) => void
  produceMedia: (
    params: { kind: TProduceMedia['kind']; rtpParameters: TProduceMedia['rtpParameters'] },
    callback: TProduceMedia['callback']
  ) => void

  consumeMedia: (
    params: { producerSocketId: string; rtpCapabilities: RtpCapabilities },
    callback: (params: { id: string; kind: MediaKind; producerId: string; rtpParameters: RtpParameters }[]) => void
  ) => void

  resumeConsumer: (params: { consumerId: string }) => void

  getProducers: () => void

  pauseProducer: (params: { producerId: string }, callback: () => void) => void

  resumeProducer: (params: { producerId: string }, callback: () => void) => void
}

export { ServerToClientEvents, ClientToServerEvents }

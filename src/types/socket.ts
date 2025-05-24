import { TCreateWebRtcTransport, TProduceMedia } from '@/types/common'
import { DtlsParameters, MediaKind, RtpCapabilities, RtpParameters } from 'mediasoup/types'
import { ExtendedError, Socket } from 'socket.io'

interface ServerToClientEvents {
  producers: (params: { producerSocketId: string; paused: boolean }[]) => void
  participantConnected: (socketId: string) => void
  participantDisconnected: (socketId: string) => void
  recorderStatus: (status: { isRecording: boolean }) => void

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

  getRecorderStatus: () => void

  resumeConsumer: (params: { consumerId: string }) => void

  getProducers: () => void

  pauseProducer: (params: { producerId: string }, callback: () => void) => void

  resumeProducer: (params: { producerId: string }, callback: () => void) => void
}

interface InterServerEvents {
  ping: () => void
}

interface SocketData {
  clientType: 'client' | 'server'
}

interface ServerToRecorderEvents {
  startRecording: (params: { meetUrl: string }) => void
  stopRecording: () => void

  getRecorderStatus: () => void
}

interface RecorderToServerEvents {
  recorderStatus: (status: { isRecording: boolean }) => void
}

type SocketMiddleware = (
  socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  next: (err?: ExtendedError) => void
) => void

export {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  SocketMiddleware,
  ServerToRecorderEvents,
  RecorderToServerEvents
}

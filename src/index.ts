import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import { createServer } from 'http'
import { Server, Socket } from 'socket.io'
import cors from 'cors'
import { CLIENT_URL, MEDIASOUP_ROUTER_CODECS, PORT } from '@/constants/global'
import {
  ClientToServerEvents,
  InterServerEvents,
  RecorderToServerEvents,
  ServerToClientEvents,
  ServerToRecorderEvents,
  SocketData
} from '@/types/socket'
import { types as mediasoupTypes } from 'mediasoup'
import * as mediasoup from 'mediasoup'
import { createWebRtcTransport } from '@/utils/mediasoup'
import { authenticateClient } from '@/middlewares/authenticateClient'

// This shoild be in some redis store or persistent storage when the server is scaled
// But for this app I am keeping it in memory

// Counting it based on producer transports number would be accurate
let connectedClientCount = 0
let remoteSocket: Socket<RecorderToServerEvents, ServerToRecorderEvents, InterServerEvents, SocketData> | null = null

const app = express()

app.use(
  cors({
    origin: /^http:\/\/localhost(:[0-9]+)?$/,
    credentials: true
  })
)

const httpServer = createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
  cors: {
    origin: /^http:\/\/localhost(:[0-9]+)?$/,
    credentials: true
  }
})

io.use(authenticateClient)

const producerTransports = new Map<string, mediasoupTypes.WebRtcTransport>()
const producers = new Map<string, mediasoupTypes.Producer[]>()

const consumerTransports = new Map<string, mediasoupTypes.WebRtcTransport>()
const consumers = new Map<string, mediasoupTypes.Consumer[]>()

const startServer = async () => {
  try {
    const worker = await mediasoup.createWorker({
      logLevel: 'warn'
    })
    console.log('mediasoup worker created')

    const router = await worker.createRouter({ mediaCodecs: MEDIASOUP_ROUTER_CODECS })
    console.log('mediasoup router created')

    worker.on('died', () => {
      console.error('mediasoup worker died')
      process.exit(1)
    })

    io.on('connection', (socket) => {
      if (socket.data.clientType === 'server') {
        remoteSocket = socket

        remoteSocket.on('recorderStatus', ({ isRecording }) => {
          console.log('Recorder status:', isRecording)
          socket.broadcast.emit('recorderStatus', { isRecording })
        })
      }

      // rtpcapabilities of router
      socket.on('getRouterRtpCapabilities', (callback) => {
        const routerRtpCapabilities = router.rtpCapabilities

        callback({
          routerRtpCapabilities: routerRtpCapabilities
        })
      })

      // create WebRTC transport
      socket.on('createWebRtcTransport', async ({ isSender }, callback) => {
        console.log('Creating WebRTC transport', socket.id)
        try {
          const createdWebRtcTransport = await createWebRtcTransport({
            router
          })

          if (!createdWebRtcTransport) {
            console.error('Failed to create WebRTC transport')
            return
          }

          const transports = isSender ? producerTransports : consumerTransports

          transports.set(socket.id, createdWebRtcTransport.transport)

          // If a sender transport request came this mean a new client is connected
          if (isSender) {
            connectedClientCount = producerTransports.size

            if (connectedClientCount === 1) {
              console.log('First client connected')
              if (!remoteSocket || remoteSocket.disconnected) {
                console.log('No remote socket connected, stopping recording')
              } else {
                console.log('Starting recording')
                remoteSocket.emit('startRecording', { meetUrl: `${CLIENT_URL}/stream?mode=recorder` })
              }
            }
            console.log('Connected clients:', connectedClientCount)
          }

          callback(createdWebRtcTransport.transportData)
        } catch (error) {
          console.error('Error creating WebRTC transport:', error)
        }
      })

      socket.on('connectWebRtcTransport', async ({ dtlsParameters, isSender }) => {
        try {
          const transport = isSender ? producerTransports.get(socket.id) : consumerTransports.get(socket.id)

          if (!transport) {
            console.error(`${isSender ? 'Producer' : 'Consumer'} transport not found`)
            return
          }

          await transport.connect({ dtlsParameters })
          console.log(`${isSender ? 'Producer' : 'Consumer'} transport connected`)
        } catch (error) {
          console.error('Error connecting transport:', error)
        }
      })

      // Produce media
      socket.on('produceMedia', async ({ kind, rtpParameters }, callback) => {
        const transport = producerTransports.get(socket.id)
        if (!transport) {
          console.error('Producer transport not found')
          return
        }

        try {
          const producer = await transport.produce({ kind, rtpParameters })
          const existingProducers = producers.get(socket.id) || []
          producers.set(socket.id, [...existingProducers, producer])

          callback({ id: producer.id })

          producer?.on('transportclose', () => {
            console.log('Producer closed')
            producer?.close()
          })

          // Notify other clients about the new consumable producer if both audio and video are produced
          // This seems valid as I am by default creating producers for both audio and video on initialization
          // There could be a more better way to do this
          if (producers.get(socket.id)?.length === 2) {
            socket.broadcast.emit('participantConnected', socket.id)
          }
        } catch (error) {
          console.error('Error producing media:', error)
        }
      })

      // devices consume media
      socket.on('consumeMedia', async ({ producerSocketId, rtpCapabilities }, callback) => {
        const transport = consumerTransports.get(socket.id)
        if (!transport) {
          console.error('Consumer transport not found')
          return
        }

        try {
          const availableProducers = producers.get(producerSocketId)
          console.log('Available producers:', availableProducers?.length)
          if (!availableProducers) {
            console.error('No producers to consume')
            return
          }

          const existingConsumers = consumers.get(socket.id) ?? []
          const newConsumers = []
          const responsePayload = []

          for (const producer of availableProducers) {
            if (!router.canConsume({ producerId: producer.id, rtpCapabilities })) {
              console.error('Cannot consume media from producer')
              continue
            }

            const alreadyConsumed = existingConsumers.some((c) => c.producerId === producer.id)
            if (alreadyConsumed) {
              console.log('Consumer already exists for this producer')
              continue
            }

            const consumer = await transport.consume({
              producerId: producer.id,
              rtpCapabilities,
              paused: true
            })

            consumer.on('transportclose', () => {
              console.log('Consumer transport closed')
              consumer.close()
            })

            consumer.on('producerclose', () => {
              console.log('Producer closed')
              consumer.close()
            })

            consumer.on('producerpause', async () => {
              await consumer.pause()
              console.log('Consumer paused')
            })

            consumer.on('producerresume', async () => {
              await consumer.resume()
              console.log('Consumer resumed')
            })

            newConsumers.push(consumer)

            responsePayload.push({
              id: consumer.id,
              kind: consumer.kind,
              producerId: producer.id,
              rtpParameters: consumer.rtpParameters,
              paused: producer.paused
            })
          }

          consumers.set(socket.id, [...existingConsumers, ...newConsumers])

          // consumers.get(socket.id)?.forEach((consumer) => {
          //   console.log('Created Consumers:', consumer.id, consumer.kind, socket.id)
          // })

          // console.log('\n\n')

          // existingConsumers.forEach((consumer) => {
          //   console.log('Existing Consumers:', consumer.id, consumer.kind, socket.id)
          // })

          // console.log('\n\n')

          // newConsumers.forEach((consumer) => {
          //   console.log('New Consumers:', consumer.id, consumer.kind, socket.id)
          // })
          // console.log('\n\n')

          callback(responsePayload)
        } catch (error) {
          console.error('Error consuming media:', error)
        }
      })

      // Recorder status
      socket.on('getRecorderStatus', () => {
        if (!remoteSocket || remoteSocket.disconnected) {
          console.log('No remote socket connected')
          socket.emit('recorderStatus', { isRecording: false })
        } else {
          remoteSocket.emit('getRecorderStatus')
        }
      })

      // Resume consumer
      socket.on('resumeConsumer', async ({ consumerId }) => {
        const consumer = consumers.get(socket.id)?.find((consumer) => consumer.id === consumerId)
        // consumers.get(socket.id)?.forEach((consumer) => {
        //   console.log('Available Consumers:', consumer.id, consumer.kind, socket.id)
        // })
        // console.log('\n\n')

        if (!consumer) {
          console.error('Consumer not found', socket.id, consumerId, '\n\n')
          return
        }
        try {
          await consumer.resume()
          console.log('Consumer resumed', socket.id, consumer.kind, consumer.id, '\n\n')
        } catch (error) {
          console.error('Error resuming consumer:', error)
        }
      })

      // get producer socket ids
      socket.on('getProducers', () => {
        // Also tell whether the producer is paused or not to resolve existing paused producer blank screen bug
        const remoteProducers = Array.from(producers.keys())
          .map((id) => {
            if (id === socket.id) return null
            return { producerSocketId: id }
          })
          .filter((item) => item !== null)

        socket.emit('producers', remoteProducers)
      })

      // Pause producer
      socket.on('pauseProducer', async ({ producerId }, callback) => {
        const producer = producers.get(socket.id)?.find((p) => p.id === producerId)
        if (!producer) {
          console.error('Producer not found for pause:', producerId)
          return
        }

        try {
          await producer.pause()
          console.log('Producer paused:', producerId)
          callback()

          // Notify other clients about the producer pause so that we can pause the consumer
          socket.broadcast.emit('producerPaused', { producerSocketId: socket.id, kind: producer.kind })
        } catch (error) {
          console.error('Error pausing producer:', error)
        }
      })

      // Resume producer
      socket.on('resumeProducer', async ({ producerId }, callback) => {
        const producer = producers.get(socket.id)?.find((p) => p.id === producerId)
        if (!producer) {
          console.error('Producer not found for resume:', producerId)
          return
        }

        try {
          await producer.resume()
          console.log('Producer resumed:', producerId)
          callback()

          // Notify other clients about the producer resume so that we can resume the consumer
          socket.broadcast.emit('producerResumed', { producerSocketId: socket.id, kind: producer.kind })
        } catch (error) {
          console.error('Error resuming producer:', error)
        }
      })

      // disconnect client cleanup
      socket.on('disconnect', () => {
        console.log('Client disconnected', socket.id)

        if (socket.data.clientType === 'server') {
          remoteSocket = null
          console.log('Remote socket disconnected', socket.id)
        }

        // Close all producers and consumers for the disiconnected client
        if (producers.has(socket.id)) {
          try {
            producers.get(socket.id)?.forEach((producer) => {
              producer.close()
              console.log(`Closed ${producer.kind} producer for ${socket.id}`)
            })
          } catch (error) {
            console.error('Error closing producer:', error)
          }
          producers.delete(socket.id)
        }

        if (consumers.has(socket.id)) {
          try {
            consumers.get(socket.id)?.forEach((consumer) => {
              consumer.close()
              console.log(`Closed consumer for ${socket.id}`)
            })
          } catch (error) {
            console.error('Error closing consumer:', error)
          }
          consumers.delete(socket.id)
        }

        // Now close transports

        const consumerTransport = consumerTransports.get(socket.id)
        if (consumerTransport) {
          try {
            consumerTransport.close()
            console.log(`Closed consumer transport for ${socket.id}`)
          } catch (error) {
            console.error('Error closing consumer transport:', error)
          }
          consumerTransports.delete(socket.id)
        }

        const producerTransport = producerTransports.get(socket.id)
        if (producerTransport) {
          try {
            producerTransport.close()
            console.log(`Closed producer transport for ${socket.id}`)
          } catch (error) {
            console.error('Error closing producer transport:', error)
          }
          producerTransports.delete(socket.id)
          // Once the producer transport is disconnected we can say that client is disconnected
          if (socket.data.clientType === 'client') {
            // Notify other clients about the producer disconnection
            socket.broadcast.emit('participantDisconnected', socket.id)

            connectedClientCount = producerTransports.size

            // Notify recorder to stop recording
            if (connectedClientCount === 0) {
              console.log('Last client disconnected')
              socket.broadcast.emit('recorderStatus', { isRecording: false })
              if (!remoteSocket || remoteSocket.disconnected) {
                console.log('No remote socket connected, stopping recording')
              } else {
                console.log('Stopping recording')
                remoteSocket.emit('stopRecording')
              }
            }
          }
        }

        console.log('Connected clients:', connectedClientCount)
      })
    })

    httpServer.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`)
    })
  } catch (err) {
    console.error('Failed to start mediasoup server:', err)
  }
}

startServer().catch((error) => {
  console.error('Failed to start server:', error)
})

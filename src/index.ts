import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { PORT } from '@/constants/global'
import { ClientToServerEvents, ServerToClientEvents } from '@/types/socket'
import { types as mediasoupTypes } from 'mediasoup'
import * as mediasoup from 'mediasoup'
import { createWebRtcTransport } from '@/utils/mediasoup'

const app = express()

app.use(
  cors({
    origin: '*',
    credentials: true
  })
)

const httpServer = createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*',
    credentials: true
  }
})

const producerTransports = new Map<string, mediasoupTypes.WebRtcTransport>()
const producers = new Map<string, mediasoupTypes.Producer[]>()

const consumerTransports = new Map<string, mediasoupTypes.WebRtcTransport>()
const consumers = new Map<string, mediasoupTypes.Consumer[]>()

const mediaCodecs: mediasoupTypes.RtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1
    }
  }
]

const startServer = async () => {
  try {
    const worker = await mediasoup.createWorker({
      logLevel: 'warn'
    })
    console.log('mediasoup worker created')

    const router = await worker.createRouter({ mediaCodecs })
    console.log('mediasoup router created')

    worker.on('died', () => {
      console.error('mediasoup worker died')
      process.exit(1)
    })

    io.on('connection', (socket) => {
      console.log('Client connected', socket.id)

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
          // TODO: There could be a more efficient way to do this
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
              rtpParameters: consumer.rtpParameters
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
        const producersWithStatus = Array.from(producers.keys())
          .map((id) => {
            if (id === socket.id) return null
            const producer = producers.get(id)?.find((p) => p.kind === 'video')
            return { producerSocketId: id, paused: !!producer?.paused }
          })
          .filter((item) => item !== null)

        socket.emit('producers', producersWithStatus)
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

        // Notify other clients about the producer disconnection
        socket.broadcast.emit('participantDisconnected', socket.id)

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
        const producerTransport = producerTransports.get(socket.id)
        if (producerTransport) {
          try {
            producerTransport.close()
            console.log(`Closed producer transport for ${socket.id}`)
          } catch (error) {
            console.error('Error closing producer transport:', error)
          }
          producerTransports.delete(socket.id)
        }

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

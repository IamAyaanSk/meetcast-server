import { Router } from 'mediasoup/types'

type TCreateWebRtcTransportProps = {
  router: Router
}

export async function createWebRtcTransport({ router }: TCreateWebRtcTransportProps) {
  try {
    const webRtcTransportOptions = {
      listenIps: [
        {
          ip: '127.0.0.1'
        }
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    }

    const transport = await router.createWebRtcTransport(webRtcTransportOptions)

    console.log(`Transport created: ${transport.id}`)

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        console.log('Transport closed')
        transport.close()
      }
    })

    transport.on('@close', () => {
      console.log('Transport closed')
    })

    return {
      transport,
      transportData: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      }
    }
  } catch (error) {
    console.log(error)
  }
}

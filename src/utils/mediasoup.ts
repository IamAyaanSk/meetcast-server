import { MEDIASOUP_TRANSPORT_OPTIONS } from '@/constants/global'
import { Router } from 'mediasoup/types'

type TCreateWebRtcTransportProps = {
  router: Router
}

export async function createWebRtcTransport({ router }: TCreateWebRtcTransportProps) {
  try {
    const transport = await router.createWebRtcTransport(MEDIASOUP_TRANSPORT_OPTIONS)

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

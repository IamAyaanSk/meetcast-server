import { CLIENT_SPECIFIER_SECRET, RECORDER_SPECIFIER_SECRET } from '@/constants/global'
import { SocketMiddleware } from '@/types/socket'

// NOTE:
// Basic auth to protect the server
// Well for this example infra structure there is no proper auth but for minimal security and classification I have done the following
// The frontend have a special specifier token that will be compared to the server env variable, this would determine client is frontend
// For our recorder which is a node js app, we have different token hence enabling that not anyone can join us
// Since frontend is specifier at the client side but CORS will block the request if it come from some other source
export const authenticateClient: SocketMiddleware = (socket, next) => {
  const authorizationHeader = socket.handshake.headers.authorization ?? ''
  const [_, token] = authorizationHeader.split(' ')

  if (!token || token.startsWith('Bearer')) {
    return next(new Error('Unauthorized client'))
  }

  if (!CLIENT_SPECIFIER_SECRET || !RECORDER_SPECIFIER_SECRET) {
    return next(new Error('Some environment variables are missing'))
  }

  if (token === CLIENT_SPECIFIER_SECRET) {
    socket.data.clientType = 'client'
    console.log('Client authenticated')
    return next()
  } else if (token === RECORDER_SPECIFIER_SECRET) {
    socket.data.clientType = 'server'
    console.log('Server authenticated')
    return next()
  } else {
    return next(new Error('Unauthorized client'))
  }
}

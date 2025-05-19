import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { PORT } from '@/constants/global'

const app = express()

app.use(
  cors({
    origin: '*',
    credentials: true
  })
)

const httpServer = createServer(app)
const io = new Server(httpServer, {})

io.on('connection', (socket) => {
  console.log('User connected:')
})

httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})

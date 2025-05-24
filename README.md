## MeetCast server 

MeetCast server is the main SFU ( Mediasoup based server ) that helps in establishing connections with the participants that joins the call. The client and this server manages the whole 
pipeline all the way from getting RTP capabilities, creating transports connecting them, creating producer and consumers on both client and server and also pause and resume them. It also 
performs robust cleanup and closes transports, producers, consumers when a client disconnects. It also controls the recorder server using Socket.io to start and stop recordings. It also 
helps the client getting the recorder status knowing whether a live stream is available or not.

### Features 
- manages the whole call pipeline and helps establishing WebRtc connections using Socket.io.
- Manages connected clients and start and stop recordings accordingly.
- Manages participants joining, leaving, resuming and stopping produce streams.
- Ensures efficient data transfer by implementing the SFU architecture using Mediasoup.

### Tech stack 
- Nodejs
- Typescript
- Socket.io
- Mediasoup

### Installation 

1. Clone this repository.
2. Install dependencies
   ```bash
   pnpm install
   ```
3. Set env variables
   Refer the `.env.example` file for setup.
4. Configure the client and SFU server too ( check readme for specific repositories for more information )
5. To start the serrver in dev env
   ```bash
   pnpm dev
   ```
6. To start in prod env
    ```bash
   pnpm build && pnpm start
    ```

## Author 
### Ayaan Shaikh

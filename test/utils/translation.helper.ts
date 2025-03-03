import { io, Socket } from 'socket.io-client';

export function getSocket(
  subscriptionType: string,
  accessToken: string,
  PORT = process.env.API_PORT,
): Socket {
  const clientSocket = io(`http://localhost:${PORT}`, {
    transportOptions: {
      polling: {
        extraHeaders: {
          Authorization: `Bearer ${accessToken}`,
          Subscription: subscriptionType,
        },
      },
    },
  });
  return clientSocket;
}

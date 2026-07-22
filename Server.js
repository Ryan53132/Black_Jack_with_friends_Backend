import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {
  console.log("🟢 Novo cliente conectado:", socket.id);

  // Escuta o evento 'enviar_mensagem' enviado pelo Dashboard.tsx
  socket.on("enviar_mensagem", (dados) => {
    console.log(`📩 Mensagem de ${dados.autor}:`, dados.texto);

    // Reenvia a mensagem (objeto com autor e texto) para TODOS os clientes conectados
    // através do evento 'receber_mensagem' que o Dashboard.tsx está escutando.
    io.emit("receber_mensagem", dados);
  });

  socket.on("disconnect", () => {
    console.log("🔴 Cliente desconectado:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
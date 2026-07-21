import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);

// A pegadinha do CORS: O Vite roda na porta 5173, e o servidor na 3000.
// Precisamos permitir que o frontend converse com o backend.
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173", // URL padrão do Vite
    methods: ["GET", "POST"]
  }
});

// Quando um cliente se conectar...
io.on("connection", (socket) => {
  console.log("Novo cliente conectado com o ID:", socket.id);

  // Escutando um evento personalizado chamado 'mensagem_do_cliente'
  socket.on("mensagem_do_cliente", (dados) => {
    console.log("Recebido do Vite:", dados);
    
    // Devolvendo uma resposta para TODOS os clientes conectados
    io.emit("mensagem_do_servidor", "Olá! Recebi sua mensagem.");
  });

  socket.on("disconnect", () => {
    console.log("Cliente desconectado:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
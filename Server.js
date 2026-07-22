const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);

  // Evento para ENTRAR em uma sala
  socket.on('entrar_na_sala', (dados) => {
    const { usuario, sala } = dados;

    // Coloca a conexão dentro da sala informada
    socket.join(sala);

    console.log(`${usuario} entrou na sala: ${sala}`);

    // Avisa APENAS quem está dentro daquela sala (exceto quem acabou de entrar)
    socket.to(sala).emit('notificacao', `${usuario} entrou no chat.`);

    // Guarda informações úteis no próprio objeto do socket para reuso
    socket.data.usuario = usuario;
    socket.data.sala = sala;
  });

  // Evento para ENVIAR mensagem na sala
  socket.on('mensagem_sala', (texto) => {
    const sala = socket.data.sala;
    const usuario = socket.data.usuario;

    if (!sala) return;

    // Dispara a mensagem para TODOS na sala, incluindo quem enviou
    io.to(sala).emit('nova_mensagem', {
      autor: usuario,
      texto: texto,
      horario: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  // Evento para SAIR da sala voluntariamente
  socket.on('sair_da_sala', () => {
    const { sala, usuario } = socket.data;
    if (sala) {
      socket.leave(sala);
      socket.to(sala).emit('notificacao', `${usuario} saiu da sala.`);
      socket.data.sala = null;
    }
  });

  // Tratamento quando o usuário fecha a página
  socket.on('disconnect', () => {
    const { sala, usuario } = socket.data;
    if (sala) {
      socket.to(sala).emit('notificacao', `${usuario} se desconectou.`);
    }
  });
});

server.listen(3000, () => console.log('Servidor de salas rodando na porta 3000'));
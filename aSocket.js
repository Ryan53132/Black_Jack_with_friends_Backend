// socket/blackjack.js
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

// env laod
dotenv.config();

// 5 Minutos de Delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// auxiliar para desconectar jogador
function removerJogadorDaSala(socketId, salaId, io) {
  const sala = salas[salaId];
  if (!sala) return;

  // Remove o jogador da lista
  sala.jogadores = sala.jogadores.filter((j) => j.id !== socketId);

  // Se a sala ficou vazia, pode deletar a sala da memória
  if (sala.jogadores.length === 0) {
    delete salas[salaId];
    return;
  }

  // Notifica os jogadores restantes sobre a atualização da mesa
  io.to(salaId).emit("atualizar_estado", sala);
}

// Simula o corte imperfeito do maço pelo croupier
function dividirBaralho(baralho) {
  // Ponto de corte próximo da metade com variação natural (+- 5 cartas)
  const meio = Math.floor(baralho.length / 2);
  const variacao = Math.floor(Math.random() * 11) - 5;
  const pontoCorte = Math.max(1, Math.min(baralho.length - 1, meio + variacao));

  const esquerda = baralho.slice(0, pontoCorte);
  const direita = baralho.slice(pontoCorte);
  return [esquerda, direita];
}

// Simula a intercalação física das cartas (Riffle Shuffle / Modelo de Cassino)
function intercalarRiffle(esquerda, direita) {
  const resultado = [];

  while (esquerda.length > 0 || direita.length > 0) {
    // A probabilidade de soltar carta do monte é proporcional à quantidade restante
    const probEsquerda = esquerda.length / (esquerda.length + direita.length);

    // O croupier solta de 1 a 3 cartas de um monte por vez
    const monteEscolhido = Math.random() < probEsquerda ? esquerda : direita;
    const quantidade = Math.min(monteEscolhido.length, Math.floor(Math.random() * 3) + 1);

    for (let k = 0; k < quantidade; k++) {
      resultado.push(monteEscolhido.shift());
    }
  }

  return resultado;
}

// Auxiliar para criar e embaralhar 2 baralhos (104 cartas) simulando um croupier real
function criarDoisBaralhos() {
  const naipes = ["♠", "♥", "♦", "♣"];
  const valores = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  let baralho = [];

  for (let i = 0; i < 2; i++) {
    for (let naipe of naipes) {
      for (let valor of valores) {
        let peso = parseInt(valor);
        if (["J", "Q", "K"].includes(valor)) peso = 10;
        if (valor === "A") peso = 11;

        baralho.push({ valor, naipe, peso });
      }
    }
  }

  // 🎴 Simulação de Croupier Real (7 passagens consecutivas de Riffle Shuffle + Corte)
  for (let passagem = 0; passagem < 7; passagem++) {
    const [esquerda, direita] = dividirBaralho(baralho);
    baralho = intercalarRiffle(esquerda, direita);
  }

  return baralho;
}

// Calcula a pontuação da mão
function calcularPontuacao(mao) {
  let soma = 0;
  let ases = 0;

  for (let carta of mao) {
    soma += carta.peso;
    if (carta.valor === "A") ases++;
  }

  while (soma > 21 && ases > 0) {
    soma -= 10;
    ases--;
  }

  return soma;
}

const salas = {};

export function setupSocket(server, db) {
  const io = new Server(server, {
    cors: {
      origin: "*",
      credentials: true
    }
  });

  // 🔒 MIDDLEWARE GLOBAL DE AUTENTICAÇÃO DO SOCKET.IO (Fica na raiz de setupSocket)
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(" ")[1];

    if (!token) {
      return next(new Error("Autenticação necessária: Token ausente."));
    }

    try {
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "chave_secreta_fallback"
      );

      // Anexa os dados do usuário autenticado no objeto socket
      socket.user = {
        id: decoded.id,
        username: decoded.username
      };
      
      next();
    } catch (err) {
      return next(new Error("Autenticação falhou: Token inválido ou expirado."));
    }
  });

  // Função interna para checar prontos e iniciar
  async function checarEIniciarPartida(salaId) {
    const sala = salas[salaId];
    if (!sala || sala.jogadores.length === 0) return;

    const todosProntos = sala.jogadores.every((j) => j.pronto === true);

    if (todosProntos && sala.jogadores.length >= 1) {
      // Validação e desconto de Gold
      for (const j of sala.jogadores) {
        const user = await db.get("SELECT gold FROM users WHERE id = ?", [j.userId]);
        if (!user || user.gold < j.aposta) {
          j.pronto = false;
          io.to(salaId).emit("erro", `O jogador ${j.nome} não tem Gold suficiente!`);
          io.to(salaId).emit("atualizar_estado", sala);
          return;
        }
      }

      for (const j of sala.jogadores) {
        await db.run("UPDATE users SET gold = gold - ? WHERE id = ?", [j.aposta, j.userId]);
        j.gold -= j.aposta;
      }

      // Prepara o estado inicial (mãos vazias)
      sala.status = "jogando";
      sala.baralho = criarDoisBaralhos();
      sala.turnoAtualIndex = 0;
      sala.dealer.mao = [];
      sala.jogadores.forEach((j) => {
        j.mao = [];
        j.status = "jogando";
      });

      io.to(salaId).emit("atualizar_estado", sala);
      await delay(300);

      // 🎴 rodada 1 de distribuição (1ª carta para cada jogador + dealer)
      for (const j of sala.jogadores) {
        j.mao.push(sala.baralho.pop());
        io.to(salaId).emit("atualizar_estado", sala);
        await delay(300); // 300ms entre cada carta
      }
      sala.dealer.mao.push(sala.baralho.pop());
      io.to(salaId).emit("atualizar_estado", sala);
      await delay(300);

      // 🎴 RODADA 2 de distribuição (2ª carta para cada jogador + dealer)
      for (const j of sala.jogadores) {
        j.mao.push(sala.baralho.pop());
        io.to(salaId).emit("atualizar_estado", sala);
        await delay(300);
      }
      sala.dealer.mao.push(sala.baralho.pop());
      io.to(salaId).emit("atualizar_estado", sala);
    }
  }

  // Função interna do Dealer + Finalização do Round
  async function finalizarPartida(salaId) {
    const sala = salas[salaId];
    if (!sala) return;

    // 1. IA do Dealer: compra cartas até atingir pelo menos 17 pontos
    while (calcularPontuacao(sala.dealer.mao) < 17) {
      sala.dealer.mao.push(sala.baralho.pop());
      io.to(salaId).emit("atualizar_estado", sala);
      await delay(1000);
    }

    const pontosDealer = calcularPontuacao(sala.dealer.mao);
    const dealerEstourou = pontosDealer > 21;

    sala.status = "finalizado";

    // 2. Apuração de Vencedores
    for (const j of sala.jogadores) {
      const pontosJogador = calcularPontuacao(j.mao);
      let multiplicador = 0;
      let resultado = "";

      if (j.status === "estourou") {
        resultado = "Estourou! Perdeu.";
        multiplicador = 0;
      } else if (dealerEstourou || pontosJogador > pontosDealer) {
        if (j.mao.length === 2 && pontosJogador === 21) {
          resultado = "BLACKJACK! Ganhou 2.5x!";
          multiplicador = 2.5;
        } else {
          resultado = "Venceu! Ganhou 2x.";
          multiplicador = 2;
        }
      } else if (pontosJogador === pontosDealer) {
        resultado = "Empate! Aposta devolvida.";
        multiplicador = 1;
      } else {
        resultado = "Perdeu para o Dealer.";
        multiplicador = 0;
      }

      if (multiplicador > 0) {
        const valorPremio = Math.floor(j.aposta * multiplicador);
        await db.run("UPDATE users SET gold = gold + ? WHERE id = ?", [valorPremio, j.userId]);
      }

      j.resultadoRodada = { resultado, multiplicador };
    }

    io.to(salaId).emit("atualizar_estado", sala);
    await delay(5000);

    // 3. Reposição de Gold e Reset da Mesa
    for (const j of sala.jogadores) {
      const user = await db.get("SELECT gold FROM users WHERE id = ?", [j.userId]);
      let goldAtual = user ? user.gold : 0;

      if (goldAtual < 1000) {
        goldAtual = 1000;
        await db.run("UPDATE users SET gold = 1000 WHERE id = ?", [j.userId]);
      }

      j.gold = goldAtual;
      j.pronto = false;
      j.status = "aguardando";
      j.mao = [];
      j.resultadoRodada = null;
    }

    sala.status = "aguardando";
    sala.dealer.mao = [];

    io.to(salaId).emit("atualizar_estado", sala);
  }

  // Avança o turno
  async function proximoTurno(salaId) {
    const sala = salas[salaId];
    if (!sala) return;

    sala.turnoAtualIndex++;

    while (
      sala.turnoAtualIndex < sala.jogadores.length &&
      sala.jogadores[sala.turnoAtualIndex].status === "espectador"
    ) {
      sala.turnoAtualIndex++;
    }

    if (sala.turnoAtualIndex >= sala.jogadores.length) {
      await finalizarPartida(salaId);
    } else {
      io.to(salaId).emit("atualizar_estado", sala);
    }
  }

  io.on("connection", (socket) => {
    console.log(`Jogador conectado: ${socket.user.username} (${socket.id})`);

    // 1. ENTRAR NA SALA
    socket.on("entrar_sala", async ({ salaId }) => {
      // 🔒 Dados extraídos do token autenticado
      const userId = socket.user.id;
      const nomeJogador = socket.user.username;

      if (!salas[salaId]) {
        salas[salaId] = {
          id: salaId,
          status: "aguardando",
          baralho: criarDoisBaralhos(),
          jogadores: [],
          dealer: { mao: [] },
          turnoAtualIndex: 0,
          limiteJogadores: 7
        };
      }

      const sala = salas[salaId];

      if (sala.jogadores.length >= 7) {
        return socket.emit("erro", "Sala cheia! Máximo 7 pessoas.");
      }

      const user = await db.get("SELECT gold FROM users WHERE id = ?", [userId]);
      let goldDoBanco = user ? user.gold : 0;

      if (goldDoBanco < 1000) {
        goldDoBanco = 1000;
        await db.run("UPDATE users SET gold = 1000 WHERE id = ?", [userId]);
      }

      const statusInicial = sala.status === "jogando" ? "espectador" : "aguardando";

      const novoJogador = {
        id: socket.id,
        nome: nomeJogador,
        userId: userId,
        gold: goldDoBanco,
        pronto: false,
        mao: [],
        maoSplit: null,
        aposta: 100,
        dobrou: false,
        status: statusInicial
      };

      sala.jogadores.push(novoJogador);
      socket.join(salaId);

      io.to(salaId).emit("atualizar_estado", sala);
    });

    // 2. INICIAR JOGO
    socket.on("iniciar_jogo", async ({ salaId, apostaInicial }) => {
      const sala = salas[salaId];
      if (!sala) return;

      const aposta = Number(apostaInicial) || 50;

      for (const j of sala.jogadores) {
        const user = await db.get("SELECT gold FROM users WHERE id = ?", [j.userId]);

        if (!user || user.gold < aposta) {
          return io.to(salaId).emit("erro", `O jogador ${j.nome} não tem Gold suficiente para esta aposta!`);
        }
      }

      for (const j of sala.jogadores) {
        await db.run("UPDATE users SET gold = gold - ? WHERE id = ?", [aposta, j.userId]);
        j.aposta = aposta;
        j.gold = j.gold - aposta;
      }

      sala.status = "jogando";
      sala.baralho = criarDoisBaralhos();
      sala.turnoAtualIndex = 0;
      sala.dealer.mao = [sala.baralho.pop(), sala.baralho.pop()];

      sala.jogadores.forEach((j) => {
        j.mao = [sala.baralho.pop(), sala.baralho.pop()];
        j.status = "jogando";
      });

      io.to(salaId).emit("atualizar_estado", sala);
    });

    // 3. AÇÃO: HIT
    socket.on("acao_hit", async ({ salaId }) => {
      const sala = salas[salaId];
      if (!sala) return;

      const jogadorAtual = sala.jogadores[sala.turnoAtualIndex];
      if (!jogadorAtual || jogadorAtual.id !== socket.id) {
        return socket.emit("erro", "Não é a sua vez!");
      }

      jogadorAtual.mao.push(sala.baralho.pop());

      if (calcularPontuacao(jogadorAtual.mao) > 21) {
        jogadorAtual.status = "estourou";
        await proximoTurno(salaId);
      } else {
        io.to(salaId).emit("atualizar_estado", sala);
      }
    });

    // 4. AÇÃO: STAND
    socket.on("acao_stand", async ({ salaId }) => {
      const sala = salas[salaId];
      if (!sala) return;

      const jogadorAtual = sala.jogadores[sala.turnoAtualIndex];
      if (!jogadorAtual || jogadorAtual.id !== socket.id) return;

      jogadorAtual.status = "parou";
      await proximoTurno(salaId);
    });

    // 5. AÇÃO: DOUBLE
    socket.on("acao_double", async ({ salaId }) => {
      const sala = salas[salaId];
      if (!sala) return;

      const j = sala.jogadores[sala.turnoAtualIndex];
      if (!j || j.id !== socket.id) return;

      const user = await db.get("SELECT gold FROM users WHERE id = ?", [j.userId]);

      if (user.gold < j.aposta) {
        return socket.emit("erro", "Saldo insuficiente para dobrar a aposta!");
      }

      await db.run("UPDATE users SET gold = gold - ? WHERE id = ?", [j.aposta, j.userId]);
      j.gold -= j.aposta;
      j.aposta *= 2;

      j.mao.push(sala.baralho.pop());

      if (calcularPontuacao(j.mao) > 21) {
        j.status = "estourou";
      } else {
        j.status = "parou";
      }

      await proximoTurno(salaId);
    });

    // 6. AÇÃO: SPLIT
    socket.on("acao_split", ({ salaId }) => {
      const sala = salas[salaId];
      if (!sala) return;

      const jogadorAtual = sala.jogadores[sala.turnoAtualIndex];
      if (!jogadorAtual || jogadorAtual.id !== socket.id) return;

      const [c1, c2] = jogadorAtual.mao;
      if (jogadorAtual.mao.length !== 2 || c1.valor !== c2.valor) {
        return socket.emit("erro", "Só pode dividir se tiver duas cartas iguais.");
      }

      jogadorAtual.maoSplit = [c2, sala.baralho.pop()];
      jogadorAtual.mao = [c1, sala.baralho.pop()];

      io.to(salaId).emit("atualizar_estado", sala);
    });

    // 7. SISTEMA DE PRONTO
    socket.on("alternar_pronto", async ({ salaId, aposta }) => {
      const sala = salas[salaId];
      if (!sala || sala.status === "jogando") return;

      const jogador = sala.jogadores.find((j) => j.id === socket.id);
      if (!jogador) return;

      if (aposta && aposta > 0) {
        jogador.aposta = Number(aposta);
      }

      jogador.pronto = !jogador.pronto;

      io.to(salaId).emit("atualizar_estado", sala);

      await checarEIniciarPartida(salaId);
    });

    socket.on("sair_sala", ({ salaId }) => {
      socket.leave(salaId);
      removerJogadorDaSala(socket.id, salaId, io);
    });

    // Desconexão
    socket.on("disconnect", () => {
      for (const salaId in salas) {
        const sala = salas[salaId];
        if (sala.jogadores.some((j) => j.id === socket.id)) {
          removerJogadorDaSala(socket.id, salaId, io);
          break;
        }
      }
    });
  });
}
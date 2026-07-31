// main.js
import express from "express";
import http from "http";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

import { setupSocket } from "./aSocket.js";
import createRouter from "./aRoutes.js";
import setupDatabase from "./db.js";

dotenv.config();

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  const frontendUrl = process.env.VITE_FRONTEND_URL;
  //const frontendUrl = "http://localhost:5173";
  // 🛡️ Limitador de Requisições (Rate Limit) para autenticação
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // Janela de 15 minutos
    max: 10, // Máximo de 10 tentativas por IP a cada 15 minutos
    message: {
      error: "Muitas tentativas a partir deste IP. Tente novamente após 15 minutos.",
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
  
  // 1. Middlewares de Segurança e Parsing
  app.use(
    cors({
      origin: frontendUrl,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "ngrok-skip-browser-warning"],
    })
  );

  app.use(express.json());
  app.use(cookieParser());

  // 2. Inicializa o Banco de Dados (SQLite)
  const db = await setupDatabase();

  // 3. Registra as Rotas da API no Express
  const apiRoutes = createRouter(db);

  // 4. Aplica Helmet para segurança HTTP
  app.use(helmet());

  // 5. Configura o Express para confiar no proxy (necessário para cookies seguros em produção)
  app.set("trust proxy", 1);

  // 🛡️ Aplica o limiter especificamente nas rotas de Login e Cadastro
  app.use("/api/login", authLimiter);
  app.use("/api/register", authLimiter);

  app.use("/api", apiRoutes); // Aplica o prefixo /api para todas as rotas

  // 6. Inicializa WebSockets
  const io = setupSocket(server, db);
  
  // 7. Inicia o Servidor HTTP
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`🔗 Liberado para o Front-end: ${frontendUrl}`);
  });
}

// Executa a inicialização do servidor
startServer();
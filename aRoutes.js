// aRoutes.js
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import authenticateToken from "./authMiddleware.js";
import { registerSchema, loginSchema } from "./aSchemas.js";

export default function createRouter(db) {
  const router = express.Router();

  // 🟢 1. Registro de Usuário
  router.post("/register", async (req, res) => {

    // 🔍 Valida o body com Zod
    const validation = registerSchema.safeParse(req.body);

    if (!validation.success) {
      // Retorna a primeira mensagem de erro formatada do Zod
      const issue = validation.error.issues[0];
      return res.status(400).json({ error: issue.message });
    }

    const username = validation.data.username;
    const password = validation.data.password;

    if (!username || !password) {
      return res.status(400).json({ error: "Preencha todos os campos.", ress: false });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.run("INSERT INTO users (username, password) VALUES (?, ?)", [
        username,
        hashedPassword,
      ]);

      return res.status(201).json({ message: "Usuário cadastrado com sucesso!", ress: true });
    } catch (err) {
      return res
        .status(400)
        .json({ error: err.message, ress: false });
    }
  });

  // 🟡 2. Login e Geração do JWT
  router.post("/login", async (req, res) => {
    const validation = loginSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0].message });
    }

    const { username, password } = validation.data;

    const user = await db.get("SELECT * FROM users WHERE username = ?", [username]);
    if (!user) {
      return res.status(400).json({ error: "Credenciais inválidas.", ress: false });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: "Credenciais inválidas.", ress: false });
    }

    // Gerar o JWT (expira em 15 minutos) e o Refresh Token
    const accessToken = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET || "chave_secreta_fallback",
      { expiresIn: "15m" }
    );

    const refreshToken = crypto.randomBytes(40).toString("hex");

    // Salva o Refresh Token no SQLite
    await db.run("INSERT INTO refresh_tokens (user_id, token) VALUES (?, ?)", [
      user.id,
      refreshToken,
    ]);

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
    });

    res.json({ accessToken });
  });

  // 🔒 3. Rota Protegida por JWT
  // aRoutes.ts

// 🔒 Rota Protegida por JWT
  router.get("/perfil", authenticateToken, async (req, res) => {
    try {
      // 1. Busca os dados atualizados do usuário no SQLite usando o ID do JWT
      const user = await db.get(
        "SELECT id, username, gold FROM users WHERE id = ?",
        [req.user.id]
      );

      if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado.", ress: false });
      }

      // 2. Retorna os dados completos do usuário (incluindo o gold!)
      res.json({
        message: "Acesso autorizado!",
        user: {
          id: user.id,
          username: user.username,
          gold: user.gold, // 💰 Agora o gold vai na resposta!
        },
        ress: true,
      });
    } catch (error) {
      res.status(500).json({ error: "Erro ao buscar dados do perfil." });
    }
  });

  // 🔄 4. Refresh Token Endpoint (Rotação de Token)
  router.post("/refresh", async (req, res) => {
    const refreshToken = req.cookies.refreshToken; // 👈 Pega o token do Cookie

    if (!refreshToken) {
      return res.status(401).json({ error: "Refresh token é obrigatório." });
    }

    // 1. Busca o token no banco SQLite
    const savedToken = await db.get("SELECT * FROM refresh_tokens WHERE token = ?", [
      refreshToken,
    ]);

    if (!savedToken) {
      res.clearCookie("refreshToken");
      return res.status(403).json({ error: "Sessão inválida ou reusada." });
    }

    // 2. DELETA o token antigo do banco (Corrigido: refreshToken em vez de oldRefreshToken)
    await db.run("DELETE FROM refresh_tokens WHERE token = ?", [refreshToken]);

    // 3. GERA UM NOVO Refresh Token + NOVO Access Token
    const newAccessToken = jwt.sign(
      { id: savedToken.user_id },
      process.env.JWT_SECRET || "chave_secreta_fallback",
      { expiresIn: "15m" }
    );
    const newRefreshToken = crypto.randomBytes(40).toString("hex");

    // 4. Salva o NOVO Refresh Token no SQLite
    await db.run("INSERT INTO refresh_tokens (user_id, token) VALUES (?, ?)", [
      savedToken.user_id,
      newRefreshToken,
    ]);

    // 5. Atualiza o Cookie no navegador (+7 dias)
    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ accessToken: newAccessToken });
  });

  // 🚪 5. Logout
  router.post("/logout", async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (refreshToken) {
    await db.run("DELETE FROM refresh_tokens WHERE token = ?", [refreshToken]);
  }

  // 🚨 OBRIGATÓRIO: Passar as mesmas opções do cookie original para o navegador aceitar apagar!
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  });

  return res.json({ message: "Deslogado com sucesso!" });
});

  return router;
}
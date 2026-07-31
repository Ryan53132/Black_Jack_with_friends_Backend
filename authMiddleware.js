// authMiddleware.js
import jwt from "jsonwebtoken";

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  // Espera o formato: "Bearer TOKEN"
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Acesso negado. Token não fornecido.", ress: false });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Token inválido ou expirado.", ress: false });
    }
    
    req.user = user; // Injeta o usuário autenticado na requisição
    next();
  });
}

export default authenticateToken;
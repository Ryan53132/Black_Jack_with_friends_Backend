// schemas.ts
import { z } from "zod";

export const registerSchema = z.object({
  username: z
    .string()
    .min(3, { message: "O nome de usuário deve ter pelo menos 3 caracteres." })
    .max(20, { message: "O nome de usuário deve ter no máximo 20 caracteres." })
    .regex(/^[a-zA-Z0-9_]+$/, {
      message: "O nome de usuário só pode conter letras, números e underline (_).",
    }),
  password: z
    .string()
    .min(6, { message: "A senha deve ter pelo menos 6 caracteres." })
    .max(50, { message: "A senha deve ter no máximo 50 caracteres." }),
});

export const loginSchema = z.object({
  username: z.string().min(1, { message: "Informe o nome de usuário." }),
  password: z.string().min(1, { message: "Informe a senha." }),
});
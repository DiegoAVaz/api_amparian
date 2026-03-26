import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export type AccessPayload = { sub: number; type: "access" };

export function signAccessToken(userId: number): string {
  const payload: AccessPayload = { sub: userId, type: "access" };
  const opts: SignOptions = {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions["expiresIn"],
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, opts);
}

export function verifyAccessToken(token: string): AccessPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as unknown;
  const payload = decoded as AccessPayload;
  if (payload.type !== "access") throw new Error("Invalid token type");
  return payload;
}

import jwt, { type SignOptions, type VerifyOptions } from "jsonwebtoken";
import { getEnv } from "../config/env";

export type AccessPayload = { sub: number; type: "access" };

const ACCESS_JWT_ALGORITHMS: VerifyOptions["algorithms"] = ["HS256"];

export function signAccessToken(userId: number): string {
  const payload: AccessPayload = { sub: userId, type: "access" };
  const opts: SignOptions = {
    algorithm: "HS256",
    expiresIn: getEnv().JWT_ACCESS_EXPIRES_IN as SignOptions["expiresIn"],
  };
  return jwt.sign(payload, getEnv().JWT_ACCESS_SECRET, opts);
}

export function verifyAccessToken(token: string): AccessPayload {
  const verifyOptions: VerifyOptions = {
    algorithms: ACCESS_JWT_ALGORITHMS,
  };

  const decoded = jwt.verify(token, getEnv().JWT_ACCESS_SECRET, verifyOptions) as unknown;
  const payload = decoded as AccessPayload;
  if (!payload || typeof payload !== "object" || payload.type !== "access" || typeof payload.sub !== "number") {
    throw new Error("Invalid token payload");
  }
  return payload;
}

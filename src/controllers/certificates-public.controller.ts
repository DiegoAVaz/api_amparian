import type { Request, Response } from "express";
import { certificateVerifyParamsSchema } from "../contracts/certificates.contract";
import { getContainer } from "../di/container";
import { wrapAsync } from "../middlewares/wrap";
import { parseParams } from "../utils/request-validation";

export const certificatesPublicController = {
  verify: wrapAsync(async (req: Request, res: Response) => {
    const { code } = parseParams(certificateVerifyParamsSchema, req.params);
    const result = await getContainer().verifyCertificate.execute(code);
    // Resposta sobre uma pessoa: nenhum cache intermediário guarda o nome dela.
    res.set("Cache-Control", "no-store").json(result);
  }),
};

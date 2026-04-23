import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import { registerAuthBoundaryContract } from "../contracts/auth.contract";
import { registerEventsBoundaryContract } from "../contracts/events.contract";
import { registerMeBoundaryContract } from "../contracts/me.contract";
import { registerSharedBoundaryComponents } from "../contracts/shared.contract";

export function generateOpenApiDocument() {
  const registry = new OpenAPIRegistry();
  const shared = registerSharedBoundaryComponents(registry);

  registerAuthBoundaryContract(registry, shared);
  registerEventsBoundaryContract(registry, shared);
  registerMeBoundaryContract(registry, shared);

  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: "3.0.4",
    info: {
      title: "Amparian API",
      version: "0.1.0",
      description:
        "Documentacao oficial da API Amparian. Os contratos abaixo representam a camada HTTP externa da aplicacao.",
    },
    servers: [
      {
        url: "/api/v1",
        description: "Base da API v1",
      },
    ],
    tags: [
      {
        name: "health",
        description: "Estado da API e verificacao basica de disponibilidade.",
      },
      {
        name: "auth",
        description:
          "Autenticacao baseada em cookies HTTP-only. Login, registro e refresh definem os cookies de sessao no navegador.",
      },
      {
        name: "lookups",
        description: "Listas auxiliares para formularios e filtros da aplicacao.",
      },
      {
        name: "events",
        description: "Consulta publica de eventos e inscricao autenticada.",
      },
      {
        name: "me",
        description: "Area autenticada do usuario, perfil, agenda, inscricoes e eventos do organizador.",
      },
    ],
  });
}

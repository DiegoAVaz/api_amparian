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
        "Documentação oficial da API Amparian. Os contratos abaixo representam a camada HTTP externa da aplicação.",
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
        description: "Estado da API e verificação básica de disponibilidade.",
      },
      {
        name: "auth",
        description:
          "Autenticação baseada em cookies HTTP-only. Login, registro e refresh definem os cookies de sessão no navegador.",
      },
      {
        name: "lookups",
        description: "Listas auxiliares para formulários e filtros da aplicação.",
      },
      {
        name: "events",
        description: "Consulta pública de eventos e inscrição autenticada.",
      },
      {
        name: "me",
        description: "Área autenticada do usuário, perfil, agenda, inscrições e eventos do organizador.",
      },
    ],
  });
}

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DeleteEventCoverUseCase,
  DeleteEventUseCase,
  UploadEventCoverUseCase,
} from "../../src/use-cases/events/organizer-event.use-cases";
import {
  DeleteAvatarUseCase,
  UploadAvatarUseCase,
} from "../../src/use-cases/user/profile.use-cases";
import type { Storage, StoredObject } from "../../src/services/storage";
import { assertHttpError, fakePublicUrl, futureIso } from "../helpers";

const MAX = 4_000_000;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Storage falso que registra o que foi gravado e o que foi apagado. */
function fakeStorage() {
  const written: string[] = [];
  const deleted: string[] = [];
  const storage: Storage = {
    put: async (key, image): Promise<StoredObject> => {
      written.push(key);
      return { key, contentType: image.contentType, size: image.buffer.length };
    },
    delete: async (key) => {
      deleted.push(key);
    },
    publicUrl: (key) => `https://cdn.teste/${key}`,
  };
  return { storage, written, deleted };
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    email: "a@b.c",
    name: "Fulano",
    phone: null,
    city: null,
    state: null,
    bio: null,
    plan: "basic" as const,
    public_organization_name: null,
    avatar_url: null,
    ...overrides,
  };
}

// ------------------------------------------------------------------ avatar

test("avatar upload stores the key and deletes the previous blob", async () => {
  const { storage, written, deleted } = fakeStorage();
  const writes: Record<string, unknown>[] = [];
  let current = userRow({ avatar_url: "users/9/avatar-antigo.png" });

  const users = {
    findById: async () => current,
    setAvatar: async (_id: number, value: string | null) => {
      writes.push({ avatar_url: value });
      current = userRow({ avatar_url: value });
      return 1;
    },
  };

  const profile = await new UploadAvatarUseCase(
    users as never,
    storage,
    fakePublicUrl,
    MAX,
  ).execute(9, PNG);

  assert.match(written[0], /^users\/9\/avatar-[0-9a-f-]{36}\.png$/);
  assert.deepEqual(writes, [{ avatar_url: written[0] }]);
  assert.deepEqual(deleted, ["users/9/avatar-antigo.png"]);
  assert.equal(profile.avatarUrl, `https://cdn.teste/${written[0]}`);
});

// A coluna reaproveitada também guarda URL externa antiga. Tentar apagá-la
// seria uma chamada inútil ao Azure com um caminho que não é chave nossa.
test("avatar upload never tries to delete a legacy external URL", async () => {
  const { storage, deleted } = fakeStorage();
  const users = {
    findById: async () => userRow({ avatar_url: "https://exemplo.com/foto.png" }),
    setAvatar: async () => 1,
  };

  await new UploadAvatarUseCase(users as never, storage, fakePublicUrl, MAX).execute(
    9,
    PNG,
  );

  assert.deepEqual(deleted, []);
});

test("avatar upload rejects a non-image before touching storage", async () => {
  const { storage, written } = fakeStorage();
  const users = { findById: async () => userRow(), setAvatar: async () => 1 };

  await assertHttpError(
    async () =>
      new UploadAvatarUseCase(users as never, storage, fakePublicUrl, MAX).execute(
        9,
        Buffer.from("<?php system($_GET['c']); ?>"),
      ),
    { status: 415, code: "UNSUPPORTED_MEDIA_TYPE" },
  );

  assert.deepEqual(written, [], "nada podia ter sido gravado");
});

test("deleting the avatar clears the column and removes the blob", async () => {
  const { storage, deleted } = fakeStorage();
  const writes: Record<string, unknown>[] = [];
  let current = userRow({ avatar_url: "users/9/avatar-abc.png" });

  const users = {
    findById: async () => current,
    setAvatar: async (_id: number, value: string | null) => {
      writes.push({ avatar_url: value });
      current = userRow({ avatar_url: value });
      return 1;
    },
  };

  const profile = await new DeleteAvatarUseCase(
    users as never,
    storage,
    fakePublicUrl,
  ).execute(9);

  assert.deepEqual(writes, [{ avatar_url: null }]);
  assert.deepEqual(deleted, ["users/9/avatar-abc.png"]);
  assert.equal(profile.avatarUrl, null);
});

// ------------------------------------------------------------ capa de evento

function eventRepo(overrides: Record<string, unknown> = {}) {
  return {
    findByOrganizerAndId: async () => ({
      id: 12,
      title: "Mutirao",
      summary: "Resumo",
      starts_at: futureIso(2),
      ends_at: null,
      status: "published",
      cover_image_url: null,
    }),
    setCoverImage: async () => 1,
    findTypesForEvent: async () => [],
    findRequirementsForEvent: async () => [],
    ...overrides,
  };
}

test("cover upload stores the key under the event id", async () => {
  const { storage, written } = fakeStorage();
  const coverWrites: (string | null)[] = [];
  const events = eventRepo({
    setCoverImage: async (_o: number, _e: number, value: string | null) => {
      coverWrites.push(value);
      return 1;
    },
  });

  await new UploadEventCoverUseCase(
    events as never,
    storage,
    fakePublicUrl,
    MAX,
  ).execute(7, 12, PNG);

  assert.match(written[0], /^events\/12\/cover-[0-9a-f-]{36}\.png$/);
  assert.deepEqual(coverWrites, [written[0]]);
});

// A rota vive sob /me, mas o id do evento vem da URL. Sem esta checagem,
// qualquer usuário autenticado trocaria a capa do evento de qualquer outro.
test("cover upload on someone else's event answers 404", async () => {
  const { storage, written } = fakeStorage();
  const events = eventRepo({ findByOrganizerAndId: async () => undefined });

  await assertHttpError(
    async () =>
      new UploadEventCoverUseCase(
        events as never,
        storage,
        fakePublicUrl,
        MAX,
      ).execute(7, 12, PNG),
    { status: 404, code: "EVENT_NOT_FOUND" },
  );

  assert.deepEqual(written, [], "não podia ter subido blob de evento alheio");
});

// Corrida: o evento some entre a leitura e a escrita. O blob recém-criado ficou
// sem dono, então tem que sumir junto em vez de virar órfão permanente.
test("an event vanishing between read and write takes the new blob with it", async () => {
  const { storage, written, deleted } = fakeStorage();
  const events = eventRepo({ setCoverImage: async () => 0 });

  await assertHttpError(
    async () =>
      new UploadEventCoverUseCase(
        events as never,
        storage,
        fakePublicUrl,
        MAX,
      ).execute(7, 12, PNG),
    { status: 404, code: "EVENT_NOT_FOUND" },
  );

  assert.deepEqual(deleted, written, "o blob órfão precisa ter sido apagado");
});

test("cover upload deletes the previous cover when it is a key of ours", async () => {
  const { storage, deleted } = fakeStorage();
  const events = eventRepo({
    findByOrganizerAndId: async () => ({
      id: 12,
      title: "Mutirao",
      summary: "Resumo",
      starts_at: futureIso(2),
      ends_at: null,
      status: "published",
      cover_image_url: "events/12/cover-antiga.png",
    }),
  });

  await new UploadEventCoverUseCase(
    events as never,
    storage,
    fakePublicUrl,
    MAX,
  ).execute(7, 12, PNG);

  assert.deepEqual(deleted, ["events/12/cover-antiga.png"]);
});

test("deleting the cover clears the column, and 404s on someone else's event", async () => {
  const { storage, deleted } = fakeStorage();
  const coverWrites: (string | null)[] = [];
  const events = eventRepo({
    findByOrganizerAndId: async () => ({
      id: 12,
      title: "Mutirao",
      summary: "Resumo",
      starts_at: futureIso(2),
      ends_at: null,
      status: "published",
      cover_image_url: "events/12/cover-abc.png",
    }),
    setCoverImage: async (_o: number, _e: number, value: string | null) => {
      coverWrites.push(value);
      return 1;
    },
  });

  await new DeleteEventCoverUseCase(
    events as never,
    storage,
    fakePublicUrl,
  ).execute(7, 12);

  assert.deepEqual(coverWrites, [null]);
  assert.deepEqual(deleted, ["events/12/cover-abc.png"]);

  const otherOwner = eventRepo({ findByOrganizerAndId: async () => undefined });
  await assertHttpError(
    async () =>
      new DeleteEventCoverUseCase(
        otherOwner as never,
        storage,
        fakePublicUrl,
      ).execute(7, 12),
    { status: 404, code: "EVENT_NOT_FOUND" },
  );
});

// Regressão do W2. Antes, o hard delete apagava a linha e a chave do blob ia
// junto — a capa ficava no container para sempre, sem ninguém capaz de nomeá-la.
// Só vale para o hard delete: cancelar preserva a linha e portanto a chave.
test("hard delete of an event also removes its cover blob", async () => {
  const { storage, deleted } = fakeStorage();
  const events = {
    findByOrganizerAndId: async () => ({
      id: 12,
      status: "draft",
      starts_at: futureIso(3),
      ends_at: null,
      cover_image_url: "events/12/cover-abc.png",
    }),
    deleteByOrganizer: async () => 1,
    setStatus: async () => 1,
  };
  const registrations = { countByEvent: async () => 0 };

  await new DeleteEventUseCase(
    events as never,
    registrations as never,
    storage,
  ).execute(7, 12);

  assert.deepEqual(deleted, ["events/12/cover-abc.png"]);
});

test("cancelling an event keeps the cover blob, because the row survives", async () => {
  const { storage, deleted } = fakeStorage();
  const events = {
    findByOrganizerAndId: async () => ({
      id: 12,
      status: "published",
      starts_at: futureIso(3),
      ends_at: null,
      cover_image_url: "events/12/cover-abc.png",
    }),
    deleteByOrganizer: async () => 1,
    setStatus: async () => 1,
  };
  const registrations = { countByEvent: async () => 0 };

  await new DeleteEventUseCase(
    events as never,
    registrations as never,
    storage,
  ).execute(7, 12);

  assert.deepEqual(deleted, [], "cancelar não pode apagar a capa");
});

// A garantia "nunca apaga URL externa" vale para todo caminho que usa
// `deleteBlobIfOurs`, não só para o avatar. Aqui ela é fixada no hard delete.
test("hard delete never tries to remove a legacy external cover URL", async () => {
  const { storage, deleted } = fakeStorage();
  const events = {
    findByOrganizerAndId: async () => ({
      id: 12,
      status: "draft",
      starts_at: futureIso(3),
      ends_at: null,
      cover_image_url: "https://exemplo.com/capa.png",
    }),
    deleteByOrganizer: async () => 1,
    setStatus: async () => 1,
  };
  const registrations = { countByEvent: async () => 0 };

  await new DeleteEventUseCase(
    events as never,
    registrations as never,
    storage,
  ).execute(7, 12);

  assert.deepEqual(deleted, [], "URL de terceiro não é nossa para apagar");
});

// --------------------------------------------- falhas de escrita no banco

test("avatar upload removes the new blob when the row write matches nothing", async () => {
  const { storage, written, deleted } = fakeStorage();
  const users = {
    findById: async () => userRow(),
    // Usuário apagado entre o findById e a escrita: o UPDATE casa zero linhas
    // e NÃO lança, então o try/catch sozinho não pegaria este caso.
    setAvatar: async () => 0,
  };

  await assertHttpError(
    async () =>
      new UploadAvatarUseCase(users as never, storage, fakePublicUrl, MAX).execute(
        9,
        PNG,
      ),
    { status: 404, code: "USER_NOT_FOUND" },
  );

  assert.deepEqual(deleted, written, "o blob novo precisa ter sido apagado");
});

// Espelho do caso da capa: aqui o UPDATE commitou e só depois a conexão caiu.
test("avatar upload keeps the blob when the write actually committed before the drop", async () => {
  const { storage, written, deleted } = fakeStorage();
  let stored: string | null = null;
  const users = {
    findById: async () =>
      stored === null ? userRow() : { ...userRow(), avatar_url: stored },
    setAvatar: async (_id: number, value: string | null) => {
      stored = value; // commitou...
      throw new Error("PROTOCOL_CONNECTION_LOST"); // ...e a conexão caiu depois
    },
  };

  await assert.rejects(() =>
    new UploadAvatarUseCase(users as never, storage, fakePublicUrl, MAX).execute(
      9,
      PNG,
    ),
  );

  assert.equal(written.length, 1);
  assert.deepEqual(deleted, [], "apagar aqui quebraria a foto do perfil");
});

test("avatar upload removes the blob when the re-read proves the write did not apply", async () => {
  const { storage, written, deleted } = fakeStorage();
  const users = {
    findById: async () => userRow(),
    setAvatar: async () => {
      throw new Error("PROTOCOL_CONNECTION_LOST");
    },
  };

  await assert.rejects(
    () =>
      new UploadAvatarUseCase(users as never, storage, fakePublicUrl, MAX).execute(
        9,
        PNG,
      ),
    /PROTOCOL_CONNECTION_LOST/,
    "o erro original precisa chegar ao chamador",
  );

  assert.deepEqual(deleted, written);
});

// Rejeição não prova que o UPDATE não aplicou. Se a releitura mostrar a chave
// nova gravada, apagar o blob deixaria a linha apontando para o nada.
test("cover upload keeps the blob when the write actually committed before the drop", async () => {
  const { storage, written, deleted } = fakeStorage();
  let stored: string | null = null;
  const events = eventRepo({
    findByOrganizerAndId: async () =>
      stored === null
        ? {
            id: 12,
            starts_at: futureIso(2),
            ends_at: null,
            status: "published",
            cover_image_url: null,
          }
        : { id: 12, cover_image_url: stored },
    setCoverImage: async (_o: number, _e: number, value: string | null) => {
      stored = value; // commitou...
      throw new Error("PROTOCOL_CONNECTION_LOST"); // ...e a conexão caiu depois
    },
  });

  await assert.rejects(() =>
    new UploadEventCoverUseCase(
      events as never,
      storage,
      fakePublicUrl,
      MAX,
    ).execute(7, 12, PNG),
  );

  assert.equal(written.length, 1);
  assert.deepEqual(deleted, [], "apagar aqui quebraria a imagem do evento");
});

test("cover upload removes the blob when the re-read proves the write did not apply", async () => {
  const { storage, written, deleted } = fakeStorage();
  const events = eventRepo({
    setCoverImage: async () => {
      throw new Error("PROTOCOL_CONNECTION_LOST");
    },
  });

  await assert.rejects(() =>
    new UploadEventCoverUseCase(
      events as never,
      storage,
      fakePublicUrl,
      MAX,
    ).execute(7, 12, PNG),
  );

  assert.deepEqual(deleted, written);
});

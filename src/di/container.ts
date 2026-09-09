import { getEnv } from "../config/env";
import { db } from "../db/knex";
import { EventRepository } from "../repositories/event.repository";
import { LookupRepository } from "../repositories/lookup.repository";
import { PasswordResetRepository } from "../repositories/password-reset.repository";
import { RefreshTokenRepository } from "../repositories/refresh-token.repository";
import { RegistrationRepository } from "../repositories/registration.repository";
import { UserRepository } from "../repositories/user.repository";
import { createMailer } from "../services/mail";
import { createPublicUrlResolver, createStorage } from "../services/storage";
import { ListLookupsUseCase } from "../use-cases/lookup/lookup.use-cases";
import {
  ForgotPasswordUseCase,
  LoginUserUseCase,
  LogoutUserUseCase,
  RefreshSessionUseCase,
  RegisterUserUseCase,
  ResetPasswordUseCase,
} from "../use-cases/auth/auth.use-cases";
import {
  accessExpiresInSeconds,
  AuthTokensHelper,
  passwordResetTtlMs,
  refreshTtlMs,
} from "../use-cases/auth/auth-tokens.helper";
import { signAccessToken } from "../utils/jwt";
import {
  CreateEventUseCase,
  DeleteEventCoverUseCase,
  DeleteEventUseCase,
  GetOrganizerEventUseCase,
  ListMyEventsUseCase,
  ListOrganizerRegistrationsUseCase,
  PublishEventUseCase,
  UpdateEventUseCase,
  UpdateRegistrationStatusUseCase,
  UploadEventCoverUseCase,
} from "../use-cases/events/organizer-event.use-cases";
import {
  CancelRegistrationUseCase,
  GetMyAgendaUseCase,
  ListMyRegistrationsUseCase,
} from "../use-cases/events/participant-event.use-cases";
import {
  GetPublicEventUseCase,
  ListPublicEventsUseCase,
  RegisterForEventUseCase,
} from "../use-cases/events/public-event.use-cases";
import {
  DeleteAvatarUseCase,
  GetProfileStatsUseCase,
  GetProfileUseCase,
  UpdateProfileUseCase,
  UploadAvatarUseCase,
} from "../use-cases/user/profile.use-cases";

function buildContainer() {
  const userRepo = new UserRepository(db);
  const refreshTokenRepo = new RefreshTokenRepository(db);
  const passwordResetRepo = new PasswordResetRepository(db);
  const lookupRepo = new LookupRepository(db);
  const eventRepo = new EventRepository(db);
  const registrationRepo = new RegistrationRepository(db);

  const authTokens = new AuthTokensHelper(refreshTokenRepo, signAccessToken, {
    refreshTtlMs: refreshTtlMs(),
    accessTtlSeconds: accessExpiresInSeconds(),
  });
  const mailer = createMailer();

  const storage = createStorage();
  const resolvePublicUrl = createPublicUrlResolver(storage);
  const uploadMaxBytes = getEnv().UPLOAD_MAX_BYTES;

  return {
    registerUser: new RegisterUserUseCase(
      userRepo,
      authTokens,
      resolvePublicUrl,
    ),
    loginUser: new LoginUserUseCase(userRepo, authTokens, resolvePublicUrl),
    refreshSession: new RefreshSessionUseCase(refreshTokenRepo, authTokens),
    logoutUser: new LogoutUserUseCase(refreshTokenRepo),
    forgotPassword: new ForgotPasswordUseCase(
      userRepo,
      passwordResetRepo,
      mailer,
      {
        webUrl: getEnv().APP_WEB_URL,
        tokenTtlMs: passwordResetTtlMs(),
      },
    ),
    resetPassword: new ResetPasswordUseCase(passwordResetRepo, db),

    listLookups: new ListLookupsUseCase(lookupRepo),

    getProfile: new GetProfileUseCase(userRepo, resolvePublicUrl),
    updateProfile: new UpdateProfileUseCase(userRepo, resolvePublicUrl),
    uploadAvatar: new UploadAvatarUseCase(
      userRepo,
      storage,
      resolvePublicUrl,
      uploadMaxBytes,
    ),
    deleteAvatar: new DeleteAvatarUseCase(userRepo, storage, resolvePublicUrl),
    getProfileStats: new GetProfileStatsUseCase(
      userRepo,
      eventRepo,
      registrationRepo,
    ),

    listPublicEvents: new ListPublicEventsUseCase(eventRepo, resolvePublicUrl),
    getPublicEvent: new GetPublicEventUseCase(eventRepo, resolvePublicUrl),
    registerForEvent: new RegisterForEventUseCase(eventRepo, registrationRepo),

    listMyEvents: new ListMyEventsUseCase(eventRepo, resolvePublicUrl),
    getOrganizerEvent: new GetOrganizerEventUseCase(
      eventRepo,
      resolvePublicUrl,
    ),
    createEvent: new CreateEventUseCase(
      eventRepo,
      lookupRepo,
      resolvePublicUrl,
    ),
    updateEvent: new UpdateEventUseCase(eventRepo, resolvePublicUrl),
    deleteEvent: new DeleteEventUseCase(eventRepo, registrationRepo, storage),
    publishEvent: new PublishEventUseCase(eventRepo, resolvePublicUrl),
    uploadEventCover: new UploadEventCoverUseCase(
      eventRepo,
      storage,
      resolvePublicUrl,
      uploadMaxBytes,
    ),
    deleteEventCover: new DeleteEventCoverUseCase(
      eventRepo,
      storage,
      resolvePublicUrl,
    ),
    listOrganizerRegistrations: new ListOrganizerRegistrationsUseCase(
      eventRepo,
      registrationRepo,
    ),
    updateRegistrationStatus: new UpdateRegistrationStatusUseCase(
      eventRepo,
      registrationRepo,
    ),

    listMyRegistrations: new ListMyRegistrationsUseCase(registrationRepo),
    cancelRegistration: new CancelRegistrationUseCase(registrationRepo),
    getMyAgenda: new GetMyAgendaUseCase(registrationRepo),
  };
}

export type AppContainer = ReturnType<typeof buildContainer>;

let cached: AppContainer | null = null;

export function getContainer(): AppContainer {
  if (!cached) cached = buildContainer();
  return cached;
}

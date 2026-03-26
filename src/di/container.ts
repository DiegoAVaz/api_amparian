import { db } from "../db/knex";
import { EventRepository } from "../repositories/event.repository";
import { LookupRepository } from "../repositories/lookup.repository";
import { PasswordResetRepository } from "../repositories/password-reset.repository";
import { RefreshTokenRepository } from "../repositories/refresh-token.repository";
import { RegistrationRepository } from "../repositories/registration.repository";
import { UserRepository } from "../repositories/user.repository";
import { ListLookupsUseCase } from "../use-cases/lookup/lookup.use-cases";
import {
  ForgotPasswordUseCase,
  LoginUserUseCase,
  LogoutUserUseCase,
  RefreshSessionUseCase,
  RegisterUserUseCase,
  ResetPasswordUseCase,
} from "../use-cases/auth/auth.use-cases";
import { AuthTokensHelper } from "../use-cases/auth/auth-tokens.helper";
import {
  CreateEventUseCase,
  DeleteEventUseCase,
  GetOrganizerEventUseCase,
  ListMyEventsUseCase,
  ListOrganizerRegistrationsUseCase,
  PublishEventUseCase,
  UpdateEventUseCase,
  UpdateRegistrationStatusUseCase,
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
import { GetProfileStatsUseCase, GetProfileUseCase, UpdateProfileUseCase } from "../use-cases/user/profile.use-cases";

function buildContainer() {
  const userRepo = new UserRepository(db);
  const refreshTokenRepo = new RefreshTokenRepository(db);
  const passwordResetRepo = new PasswordResetRepository(db);
  const lookupRepo = new LookupRepository(db);
  const eventRepo = new EventRepository(db);
  const registrationRepo = new RegistrationRepository(db);

  const authTokens = new AuthTokensHelper(refreshTokenRepo);

  return {
    registerUser: new RegisterUserUseCase(userRepo, authTokens),
    loginUser: new LoginUserUseCase(userRepo, authTokens),
    refreshSession: new RefreshSessionUseCase(refreshTokenRepo),
    logoutUser: new LogoutUserUseCase(refreshTokenRepo),
    forgotPassword: new ForgotPasswordUseCase(userRepo, passwordResetRepo),
    resetPassword: new ResetPasswordUseCase(passwordResetRepo, db),

    listLookups: new ListLookupsUseCase(lookupRepo),

    getProfile: new GetProfileUseCase(userRepo),
    updateProfile: new UpdateProfileUseCase(userRepo),
    getProfileStats: new GetProfileStatsUseCase(userRepo, eventRepo, registrationRepo),

    listPublicEvents: new ListPublicEventsUseCase(eventRepo),
    getPublicEvent: new GetPublicEventUseCase(eventRepo),
    registerForEvent: new RegisterForEventUseCase(eventRepo, registrationRepo),

    listMyEvents: new ListMyEventsUseCase(eventRepo),
    getOrganizerEvent: new GetOrganizerEventUseCase(eventRepo),
    createEvent: new CreateEventUseCase(eventRepo, lookupRepo),
    updateEvent: new UpdateEventUseCase(eventRepo),
    deleteEvent: new DeleteEventUseCase(eventRepo),
    publishEvent: new PublishEventUseCase(eventRepo),
    listOrganizerRegistrations: new ListOrganizerRegistrationsUseCase(eventRepo, registrationRepo),
    updateRegistrationStatus: new UpdateRegistrationStatusUseCase(eventRepo, registrationRepo),

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

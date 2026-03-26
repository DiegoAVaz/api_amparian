export type RegistrationStatus = "pending" | "confirmed" | "cancelled";

export type EventRegistrationRecord = {
  id: number;
  event_id: number;
  user_id: number;
  status: RegistrationStatus;
  participant_role: string | null;
  agreed_responsibility_at: string | Date | null;
  created_at: string | Date;
};

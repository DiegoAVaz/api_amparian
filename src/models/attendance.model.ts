// Presença registrada pelo organizador para uma inscrição confirmada.
export type AttendanceStatus = "present" | "absent";

export type EventAttendanceRecord = {
  id: number;
  registration_id: number;
  status: AttendanceStatus;
  recorded_by: number;
  recorded_at: string | Date;
  created_at?: string | Date;
  updated_at?: string | Date;
};

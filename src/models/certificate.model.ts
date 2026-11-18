// Certificado de participação, com o snapshot do que vai impresso (RC-06).
// `event_workload_hours` chega como string porque o mysql2 devolve DECIMAL
// assim; quem lê converte com `parseWorkloadHours`.
export type CertificateRecord = {
  id: number;
  registration_id: number;
  verification_code: string;
  participant_name: string;
  event_title: string;
  organizer_name: string;
  organizer_person_name: string;
  event_starts_at: string | Date;
  event_ends_at: string | Date | null;
  event_location_name: string | null;
  event_is_remote: boolean | number;
  event_workload_hours: string | null;
  blob_key: string | null;
  issued_at: string | Date;
  created_at?: string | Date;
  updated_at?: string | Date;
};

export type EventStatus = "draft" | "published" | "cancelled";

export type EventRecord = {
  id: number;
  organizer_id: number;
  title: string;
  summary: string;
  description: string | null;
  rules_terms: string | null;
  starts_at: string | Date;
  ends_at: string | Date | null;
  location_name: string | null;
  is_remote: boolean | number;
  capacity: number | null;
  cover_image_url: string | null;
  highlight_skill: string | null;
  status: EventStatus;
  created_at?: string | Date;
  updated_at?: string | Date;
};

export type LookupRow = { id: number; code: string; label: string };

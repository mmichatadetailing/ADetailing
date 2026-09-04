export interface GooglePlanningEvent {
  id: string;
  googleEventId: string;
  connectionId: string;
  calendarId: string;
  calendarName: string;
  accountEmail: string;
  memberId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  busy: boolean;
  color: string;
  location?: string;
  htmlLink?: string;
}

export interface GooglePlanningEventsResponse {
  connected: boolean;
  events: GooglePlanningEvent[];
  errors: string[];
  syncedAt: string;
}

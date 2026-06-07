export interface TranscriptMessage {
  id: number; // sequenceNumber from server
  speaker: "interviewer" | "user";
  message: string;
  text: string;
  timestamp: string;
  is_final: boolean;
  sequenceNumber: number;
  createdAt?: number;
}

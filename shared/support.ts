export type FeedbackKind = 'feedback' | 'report';
export type FeedbackStatus = 'pending' | 'processing' | 'resolved';
export type Feedback = {
  id: string; user_id: string; kind: FeedbackKind; description: string;
  reference: string; status: FeedbackStatus; revision: number; created_at: string; updated_at: string;
};
export type FeedbackReply = {
  id: string; feedback_id: string; actor_id: string; body: string; created_at: string;
};
export type FeedbackDetail = { item: Feedback; replies: FeedbackReply[] };
export type InboxNotification = {
  id: string; feedback_id: string; reply_id: string; body: string; created_at: string; read_at: string | null;
};
export type Page<T> = { items: T[]; total: number };
export type InboxPage = Page<InboxNotification> & { unread: number; asOf: string };

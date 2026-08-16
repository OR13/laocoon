/**
 * A thread as the page lists it.
 *
 * Plain data with no renderer behind it. This lived in the WebGL map component
 * and was still being imported after that component was deleted, which dragged
 * sigma into the server prerender and broke the build with
 * "WebGL2RenderingContext is not defined".
 */
export interface ListedThread {
  id: string;
  subject: string;
  list_name: string;
  topic_id: string | null;
  topic_label: string | null;
  messages: number;
  participants: number;
  with_standing: number;
  uptake: number | null;
  last_message_at: string | null;
  href: string;
}

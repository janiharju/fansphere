export interface Team {
  id: string;
  name: string;
  short_name: string;
  logo: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  points: number;
  form: string[];
}

export interface MatchEvent {
  min: number;
  team: string;
  player: string;
  type: string;
}

export interface Match {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  minute: number;
  status: string;
  events: MatchEvent[];
}

export interface Post {
  id: number;
  title: string;
  content: string;
  author: string;
  author_realm: string;
  tag: string;
  upvotes: number;
  downvotes: number;
  comment_count?: number;
  image_url: string;
  created_at: string;
  last_activity_at?: string;
}

export interface Comment {
  id: number;
  post_id: number;
  parent_id: number | null;
  author: string;
  author_realm: string;
  content: string;
  upvotes: number;
  image_url?: string;
  created_at: string;
}

export interface ChatMessage {
  id: number;
  room: string;
  author: string;
  author_realm: string;
  badge_color: string;
  content: string;
  created_at: string;
  reactions?: Record<string, string[]>;
  realm?: string;
  mentions?: string[];
}

export interface Notification {
  id: string;
  userId: string;
  messageId: number;
  type: 'chat' | 'post' | 'comment';
  read: boolean;
  created_at: string;
}

export interface Session {
  id: string;
  nickname: string;
  email: string;
  realm: string;
  created_at: string;
  last_active_at: string;
  expires_at: string;
}

export interface UserReadState {
  last_read_at: string;
  comment_count: number;
}

export interface ClubRealm {
  id: string;
  name: string;
  short_name?: string;
  badge_color: string;
  icon: string;
  image_icon?: string;
  description?: string;
  is_default?: boolean;
  created_at: string;
}

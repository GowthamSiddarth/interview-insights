const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface Candidate {
  id: string;
  verificationStatus: string;
  verifiedAt: string | null;
  createdAt: string;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  sizeBucket: 'startup' | 'mid' | 'large' | 'enterprise';
  logoUrl: string | null;
  createdAt: string;
}

export interface InterviewProcess {
  id: string;
  companyId: string;
  candidateId: string;
  roleTitle: string;
  level: string | null;
  department: string | null;
  applicationDate: string | null;
  outcome: 'offer' | 'rejected' | 'withdrawn' | 'ghosted' | 'in_progress';
  createdAt: string;
  rounds?: Round[];
}

export interface Round {
  id: string;
  processId: string;
  sequenceNumber: number;
  title: string;
  description: string | null;
  roundType:
    | 'coding'
    | 'system_design'
    | 'behavioral'
    | 'leadership'
    | 'case_study'
    | 'assessment'
    | 'take_home'
    | 'other';
  scheduledDurationMinutes: number | null;
  createdAt: string;
}

export interface RoundRating {
  id: string;
  roundId: string;
  candidateId: string;
  difficulty: number;
  fairness: number;
  communicationFluency: number;
  attentiveness: number;
  biasSignal: number;
  technicalDepth: number | null;
  freeText: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'flagged';
  createdAt: string;
}

export interface RecruiterInteraction {
  id: string;
  processId: string;
  recruiterId: string;
  createdAt: string;
}

export interface RecruiterRating {
  id: string;
  recruiterInteractionId: string;
  candidateId: string;
  approachability: number;
  responseTime: number;
  timeliness: number;
  communicationQuality: number;
  freeText: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'flagged';
  createdAt: string;
}

export interface OverallReview {
  id: string;
  processId: string;
  candidateId: string;
  overallExperience: number;
  wouldRecommend: boolean;
  reviewText: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'flagged';
  createdAt: string;
}

// The `entity` payload GET /moderation/queue attaches to each entry —
// shape varies by entityType; only the fields the moderation page needs.
export interface ModerationQueueEntity {
  companyName: string;
  roleTitle: string;
  freeText?: string | null;
  // round_rating
  roundTitle?: string;
  roundType?: Round['roundType'];
  difficulty?: number;
  fairness?: number;
  communicationFluency?: number;
  attentiveness?: number;
  biasSignal?: number;
  technicalDepth?: number | null;
  // recruiter_rating — recruiterLabel is the generated label, never a
  // real name (CLAUDE.md hard constraint #1)
  recruiterLabel?: string;
  approachability?: number;
  responseTime?: number;
  timeliness?: number;
  communicationQuality?: number;
  // overall_review
  overallExperience?: number;
  wouldRecommend?: boolean;
  reviewText?: string | null;
}

export type ModerationEntityType = 'round_rating' | 'recruiter_rating' | 'overall_review';
export type ModerationFlagReason = 'spam_pattern' | 'rate_limit' | 'duplicate' | 'manual_report';

export interface ModerationQueueEntry {
  id: string;
  entityType: ModerationEntityType;
  entityId: string;
  flagReason: ModerationFlagReason | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  entity: ModerationQueueEntity | null;
}

export interface RoundTypeAnalytics {
  roundType: Round['roundType'];
  sampleSize: number;
  scores: {
    difficulty: number | null;
    fairness: number | null;
    communicationFluency: number | null;
    attentiveness: number | null;
    biasSignal: number | null;
  };
}

export interface RecruiterAnalytics {
  sampleSize: number;
  scores: {
    approachability: number | null;
    responseTime: number | null;
    timeliness: number | null;
    communicationQuality: number | null;
  };
}

export interface OverallAnalytics {
  sampleSize: number;
  scores: {
    overallExperience: number | null;
    wouldRecommendPct: number | null;
  };
}

export interface CompanyAnalytics {
  companyId: string;
  roundTypes: RoundTypeAnalytics[];
  recruiter: RecruiterAnalytics | null;
  overall: OverallAnalytics | null;
}

export interface CompanySearchResult {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  sizeBucket: Company['sizeBucket'];
}

export interface ReviewSearchResult {
  id: string;
  companyId: string;
  roleTitle: string;
  roundType: Round['roundType'];
  freeText: string | null;
  createdAt: string;
  difficulty: number;
  fairness: number;
  communicationFluency: number;
  attentiveness: number;
  biasSignal: number;
}

export interface ReviewSearchFilters {
  q?: string;
  companyId?: string;
  roleTitle?: string;
  roundType?: Round['roundType'];
  dateFrom?: string;
  dateTo?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new ApiError(res.status, message ?? `Request to ${path} failed with ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  createCandidate: (email: string) =>
    request<Candidate>('/candidates', { method: 'POST', body: JSON.stringify({ email }) }),

  listCompanies: () => request<Company[]>('/companies'),

  createCompany: (input: { name: string; slug: string; sizeBucket: Company['sizeBucket'] }) =>
    request<Company>('/companies', { method: 'POST', body: JSON.stringify(input) }),

  listProcessesForCompany: (companyId: string) =>
    request<InterviewProcess[]>(`/companies/${companyId}/processes`),

  createProcess: (
    companyId: string,
    input: { candidateId: string; roleTitle: string; outcome: InterviewProcess['outcome'] },
  ) =>
    request<InterviewProcess>(`/companies/${companyId}/processes`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getProcess: (processId: string) => request<InterviewProcess>(`/processes/${processId}`),

  createRound: (
    processId: string,
    input: { sequenceNumber: number; title: string; roundType: Round['roundType'] },
  ) =>
    request<Round>(`/processes/${processId}/rounds`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  createRoundRating: (
    roundId: string,
    input: {
      candidateId: string;
      difficulty: number;
      fairness: number;
      communicationFluency: number;
      attentiveness: number;
      biasSignal: number;
    },
  ) =>
    request<RoundRating>(`/rounds/${roundId}/ratings`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  listApprovedRatingsForRound: (roundId: string) =>
    request<RoundRating[]>(`/rounds/${roundId}/ratings`),

  createRecruiterInteraction: (processId: string, input: { recruiterIdentifier: string }) =>
    request<RecruiterInteraction>(`/processes/${processId}/recruiter-interactions`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  createRecruiterRating: (
    recruiterInteractionId: string,
    input: {
      candidateId: string;
      approachability: number;
      responseTime: number;
      timeliness: number;
      communicationQuality: number;
      freeText?: string;
    },
  ) =>
    request<RecruiterRating>(`/recruiter-interactions/${recruiterInteractionId}/ratings`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  createOverallReview: (
    processId: string,
    input: {
      candidateId: string;
      overallExperience: number;
      wouldRecommend: boolean;
      reviewText?: string;
    },
  ) =>
    request<OverallReview>(`/processes/${processId}/overall-review`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  listModerationQueue: () => request<ModerationQueueEntry[]>('/moderation/queue'),

  approveModerationEntry: (id: string, reviewedBy?: string) =>
    request<ModerationQueueEntry>(`/moderation/queue/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(reviewedBy ? { reviewedBy } : {}),
    }),

  rejectModerationEntry: (id: string, reviewedBy?: string) =>
    request<ModerationQueueEntry>(`/moderation/queue/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify(reviewedBy ? { reviewedBy } : {}),
    }),

  flagModerationEntry: (id: string, flagReason: ModerationFlagReason, reviewedBy?: string) =>
    request<ModerationQueueEntry>(`/moderation/queue/${id}/flag`, {
      method: 'POST',
      body: JSON.stringify({ flagReason, ...(reviewedBy ? { reviewedBy } : {}) }),
    }),

  getCompanyAnalytics: (companyId: string) =>
    request<CompanyAnalytics>(`/companies/${companyId}/analytics`),

  searchCompanies: (q: string) =>
    request<CompanySearchResult[]>(`/search/companies?q=${encodeURIComponent(q)}`),

  searchReviews: (filters: ReviewSearchFilters) => {
    const query = new URLSearchParams();
    if (filters.q) query.set('q', filters.q);
    if (filters.companyId) query.set('companyId', filters.companyId);
    if (filters.roleTitle) query.set('roleTitle', filters.roleTitle);
    if (filters.roundType) query.set('roundType', filters.roundType);
    if (filters.dateFrom) query.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) query.set('dateTo', filters.dateTo);
    return request<ReviewSearchResult[]>(`/search/reviews?${query.toString()}`);
  },
};

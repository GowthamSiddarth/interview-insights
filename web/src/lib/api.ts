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
  title: string | null;
  description: string | null;
  roundType:
    | 'coding'
    | 'system_design'
    | 'behavioral'
    | 'leadership'
    | 'case_study'
    | 'assessment'
    | 'take_home'
    | 'tech_screening'
    | 'other';
  scheduledDurationMinutes: number | null;
  createdAt: string;
}

export interface RoundRating {
  id: string;
  roundId: string;
  candidateId: string;
  difficulty: number;
  fluency: number;
  clarity: number;
  focus: number;
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
  reachability: number;
  responsiveness: number;
  guidelinesShared: number;
  rejectionMessageAuthenticity: number | null;
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
  processId: string;
  companyName: string;
  roleTitle: string;
  freeText?: string | null;
  // round_rating — full submitted content (GitHub issue #315), not just
  // the highlighted score fields.
  roundTitle?: string | null;
  roundType?: Round['roundType'];
  roundDescription?: string | null;
  roundTypeMetadata?: Record<string, unknown> | null;
  roundScheduledDurationMinutes?: number | null;
  difficulty?: number;
  fluency?: number;
  clarity?: number;
  focus?: number;
  technicalDepth?: number | null;
  // recruiter_rating — recruiterLabel is the generated label, never a
  // real name (CLAUDE.md hard constraint #1)
  recruiterLabel?: string;
  reachability?: number;
  responsiveness?: number;
  guidelinesShared?: number;
  rejectionMessageAuthenticity?: number | null;
  // overall_review
  overallExperience?: number;
  wouldRecommend?: boolean;
  reviewText?: string | null;
  // company (GitHub issue #369, Phase 35) — a create-company request has
  // no InterviewProcess/roleTitle of its own; companyName holds the
  // *requested* name instead.
  requestedCompanySlug?: string;
  requestedCompanySizeBucket?: string;
  requestedCompanyIndustry?: string | null;
  // GitHub issue #163 (Phase 19), now computed async by review-analyzer
  // (GitHub issue #340, D81) — advisory-only second opinion from an LLM
  // triage pass, one of the three moderated content types only (never
  // `company`). Null means either the feature is disabled or the verdict
  // simply hasn't arrived yet — the moderation page renders this as a
  // distinct "analysis pending" state (AiModerationVerdict), never
  // conflated with "no concerns found".
  moderationVerdict?: { concerning: boolean; reasons: string[]; summary: string } | null;
}

export type ModerationEntityType =
  | 'round_rating'
  | 'recruiter_rating'
  | 'overall_review'
  | 'company';
export type ModerationFlagReason = 'spam_pattern' | 'rate_limit' | 'duplicate' | 'manual_report';
// GitHub issue #370/#371 (Phase 35) — the moderator search box's two
// buckets: every interview-review entity type collapses into one value,
// a create-company request is the other. Derived client-side from
// entityType (round_rating/recruiter_rating/overall_review -> 'interview-review',
// company -> 'create-company') — the wire response never carries this
// as its own field.
export type ModerationQueueCategory = 'interview-review' | 'create-company';

// GitHub issue #522 (Phase 41) — GET /moderation/queue's own filters (see
// api/src/moderation/dto/moderation-queue-query.dto.ts for the backend
// side these mirror). Distinct from ModerationQueueCategory above, which
// is a client-derived concept for the separate /moderation/search route.
export type ModerationQueueClaimState = 'mine' | 'unclaimed' | 'all';
export type ModerationQueueStatus = 'pending' | 'flagged';

export interface ModerationQueueFilters {
  entityType?: ModerationEntityType;
  companyId?: string;
  claimState?: ModerationQueueClaimState;
  status?: ModerationQueueStatus[];
}

// GitHub issue #487 (Phase 36) — who currently has this entry claimed, if
// anyone; the "claimed by" badge/claim-release buttons key off this alone.
export interface ModerationQueueClaimedBy {
  id: string;
  username: string;
}

export interface ModerationQueueEntry {
  id: string;
  entityType: ModerationEntityType;
  entityId: string;
  flagReason: ModerationFlagReason | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  slaDeadline: string;
  claimedBy: ModerationQueueClaimedBy | null;
  claimedAt: string | null;
  entity: ModerationQueueEntity | null;
}

// GitHub issue #315: the queue groups every pending entity by its
// InterviewProcess ("submission") rather than returning a flat list — one
// collapsed row per submission, full detail revealed on expand.
export interface ModerationQueueGroup {
  processId: string | null;
  companyName: string;
  roleTitle: string;
  entries: ModerationQueueEntry[];
}

export interface RoundTypeAnalytics {
  roundType: Round['roundType'];
  sampleSize: number;
  scores: {
    difficulty: number | null;
    fluency: number | null;
    clarity: number | null;
    focus: number | null;
  };
}

export interface RecruiterAnalytics {
  sampleSize: number;
  scores: {
    reachability: number | null;
    responsiveness: number | null;
    guidelinesShared: number | null;
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

// Public display shape for GET /companies/:id/reviews — no candidateId,
// read from Postgres, not OpenSearch (D16/D17: a profile page is a
// source-of-truth read, not a search). Grouped by submission (GitHub
// issue #347) — the same flat-list problem Phase 29 issue #315 already
// fixed for the moderation queue, on the public-facing surface too.
export interface CompanyReviewItem {
  id: string;
  createdAt: string;
  roundTitle: string | null;
  roundType: Round['roundType'];
  difficulty: number;
  fluency: number;
  clarity: number;
  focus: number;
  technicalDepth: number | null;
  freeText: string | null;
}

export interface CompanyReviewGroup {
  processId: string;
  roleTitle: string;
  entries: CompanyReviewItem[];
}

export interface CompanyReviewsPage {
  total: number;
  page: number;
  pageSize: number;
  items: CompanyReviewGroup[];
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
  fluency: number;
  clarity: number;
  focus: number;
}

export interface ReviewSearchFilters {
  q?: string;
  companyId?: string;
  roleTitle?: string;
  roundType?: Round['roundType'];
  dateFrom?: string;
  dateTo?: string;
}

// GET /round-types/field-options (Phase 24 issue #248) — the round-type
// registry, consumed by the wizard's flashcard step forms (issue #254)
// instead of hardcoding round-type-specific fields. `options` is present
// only for controlled-single/controlled-multi fields, never for text.
export interface RoundTypeFieldDef {
  key: string;
  kind: 'text' | 'controlled-single' | 'controlled-multi';
  options?: string[];
}

export type RoundTypeFieldOptions = Record<Round['roundType'], { fields: RoundTypeFieldDef[] }>;

// Admin CRUD for round_type_field_options (Phase 27 issue #263) — every
// value (active and inactive), unlike the public schema above which only
// ever surfaces active ones.
export interface RoundTypeFieldOptionRow {
  id: string;
  roundType: Round['roundType'];
  fieldKey: string;
  value: string;
  sortOrder: number;
  isActive: boolean;
}

// POST /companies/:companyId/processes/bulk (Phase 25 issue #251, D49) —
// the whole tree in one atomic transaction. Mirrors the backend's
// CreateBulkProcessDto field-for-field; the wizard's draft (issue #253)
// already stores its rounds/recruiterInteractions in exactly this shape,
// so submitting is just stripping the draft's client-only fields
// (clientId, timing), not a real translation step.
export interface CreateBulkRoundRatingInput {
  difficulty: number;
  fluency: number;
  clarity: number;
  focus: number;
  technicalDepth?: number;
  freeText?: string;
}

export interface CreateBulkRoundInput {
  sequenceNumber: number;
  title?: string;
  roundType: Round['roundType'];
  description?: string;
  scheduledDurationMinutes?: number;
  typeMetadata?: Record<string, unknown>;
  rating?: CreateBulkRoundRatingInput;
}

export interface CreateBulkRecruiterRatingInput {
  reachability: number;
  responsiveness: number;
  guidelinesShared: number;
  rejectionMessageAuthenticity?: number;
  freeText?: string;
}

export interface CreateBulkRecruiterInteractionInput {
  recruiterIdentifier: string;
  rating?: CreateBulkRecruiterRatingInput;
}

export interface CreateBulkProcessInput {
  roleTitle: string;
  level?: string;
  department?: string;
  applicationDate?: string;
  outcome: InterviewProcess['outcome'];
  rounds?: CreateBulkRoundInput[];
  recruiterInteractions?: CreateBulkRecruiterInteractionInput[];
  overallReview?: { overallExperience: number; wouldRecommend: boolean; reviewText?: string };
}

// Phase 42 (D99) — admin > moderator > staff. staff is read-only: queue/
// search/round-type-registry, no claim/approve/reject/flag/write.
export type StaffRole = 'admin' | 'moderator' | 'staff';

export interface AdminSession {
  id: string;
  username: string;
  role: StaffRole;
}

// GitHub issue #589 (Phase 42, D99) — one row per staff account
// (admin/moderator/staff), managed via /admin/staff, admin:staff:manage
// only. Never carries a password/passwordHash — see StaffAccountCreated
// below for the one-time-password shape create()/resetPassword() return.
export interface StaffAccount {
  id: string;
  username: string;
  email: string;
  role: StaffRole;
  isActive: boolean;
  createdById: string | null;
  createdAt: string;
}

export interface StaffAccountCreated extends StaffAccount {
  password: string;
}

export interface CandidateSession {
  candidateId: string;
}

// GET /me/submissions (GitHub issue #149) — grouped by InterviewProcess,
// not three flat lists (decided during the Phase 17 kickoff brainstorm):
// a candidate thinks in terms of "my interview at Company X." Every
// status (pending/approved/rejected/flagged) is visible here, unlike
// every public read path — this is the one place a candidate sees their
// own not-yet-public content.
export interface MySubmissionRoundRating {
  id: string;
  roundId: string;
  roundTitle: string | null;
  roundType: Round['roundType'];
  status: RoundRating['status'];
  difficulty: number;
  fluency: number;
  clarity: number;
  focus: number;
  technicalDepth: number | null;
  freeText: string | null;
  createdAt: string;
}

export interface MySubmissionRecruiterRating {
  id: string;
  recruiterInteractionId: string;
  status: RecruiterRating['status'];
  reachability: number;
  responsiveness: number;
  guidelinesShared: number;
  rejectionMessageAuthenticity: number | null;
  freeText: string | null;
  createdAt: string;
}

export interface MySubmissionOverallReview {
  id: string;
  status: OverallReview['status'];
  overallExperience: number;
  wouldRecommend: boolean;
  reviewText: string | null;
  createdAt: string;
}

export interface MyProcessSubmissions {
  processId: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  roleTitle: string;
  outcome: InterviewProcess['outcome'];
  createdAt: string;
  roundRatings: MySubmissionRoundRating[];
  recruiterRatings: MySubmissionRecruiterRating[];
  overallReview: MySubmissionOverallReview | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    // The raw, un-joined validation messages (GitHub issue #281) — kept
    // alongside the joined `message` (unchanged, still used by every
    // existing display site) so a caller that wants to humanize each
    // message individually (rather than parse a comma-joined string back
    // apart) can do so.
    public messages: string[] = [message],
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    // Required for the admin_session cookie (GitHub issue #159/#160) to be
    // sent/received at all — api and web run on different origins, and
    // fetch() drops cookies cross-origin by default without this.
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
    const messages = Array.isArray(body.message)
      ? body.message
      : [body.message ?? `Request to ${path} failed with ${res.status}`];
    throw new ApiError(res.status, messages.join(', '), messages);
  }
  // 204 No Content (the update/delete DELETE routes, GitHub issue #150) has
  // no body to parse — res.json() would throw on the empty string.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listCompanies: () => request<Company[]>('/companies'),

  // GitHub issue #415 — backs the landing page's quick-select grid,
  // capped server-side (5, random for now) rather than listCompanies()
  // above, which returns every approved company and doesn't scale as
  // the list grows.
  topCompanies: () => request<Company[]>('/companies/top'),

  createCompany: (input: { name: string; slug: string; sizeBucket: Company['sizeBucket'] }) =>
    request<Company>('/companies', { method: 'POST', body: JSON.stringify(input) }),

  listProcessesForCompany: (companyId: string) =>
    request<InterviewProcess[]>(`/companies/${companyId}/processes`),

  createProcess: (
    companyId: string,
    input: { roleTitle: string; outcome: InterviewProcess['outcome'] },
  ) =>
    request<InterviewProcess>(`/companies/${companyId}/processes`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getProcess: (processId: string) => request<InterviewProcess>(`/processes/${processId}`),

  // Only ever succeeds for a genuinely empty process — no rating/review
  // in any status. GitHub issue #260, deliberately narrower than issue
  // #150's own "never structural entities" scope decision.
  deleteProcess: (processId: string) =>
    request<void>(`/processes/${processId}`, { method: 'DELETE' }),

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
      difficulty: number;
      fluency: number;
      clarity: number;
      focus: number;
    },
  ) =>
    request<RoundRating>(`/rounds/${roundId}/ratings`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  listApprovedRatingsForRound: (roundId: string) =>
    request<RoundRating[]>(`/rounds/${roundId}/ratings`),

  // GitHub issue #150 — an edit never modifies public content in place; the
  // server resets status to `pending` and re-enqueues for moderation.
  updateRoundRating: (
    roundId: string,
    id: string,
    input: {
      difficulty: number;
      fluency: number;
      clarity: number;
      focus: number;
      technicalDepth?: number;
      freeText?: string;
    },
  ) =>
    request<RoundRating>(`/rounds/${roundId}/ratings/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteRoundRating: (roundId: string, id: string) =>
    request<void>(`/rounds/${roundId}/ratings/${id}`, { method: 'DELETE' }),

  createRecruiterInteraction: (processId: string, input: { recruiterIdentifier: string }) =>
    request<RecruiterInteraction>(`/processes/${processId}/recruiter-interactions`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  createRecruiterRating: (
    recruiterInteractionId: string,
    input: {
      reachability: number;
      responsiveness: number;
      guidelinesShared: number;
      rejectionMessageAuthenticity?: number;
      freeText?: string;
    },
  ) =>
    request<RecruiterRating>(`/recruiter-interactions/${recruiterInteractionId}/ratings`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateRecruiterRating: (
    recruiterInteractionId: string,
    id: string,
    input: {
      reachability: number;
      responsiveness: number;
      guidelinesShared: number;
      rejectionMessageAuthenticity?: number;
      freeText?: string;
    },
  ) =>
    request<RecruiterRating>(`/recruiter-interactions/${recruiterInteractionId}/ratings/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteRecruiterRating: (recruiterInteractionId: string, id: string) =>
    request<void>(`/recruiter-interactions/${recruiterInteractionId}/ratings/${id}`, {
      method: 'DELETE',
    }),

  createOverallReview: (
    processId: string,
    input: {
      overallExperience: number;
      wouldRecommend: boolean;
      reviewText?: string;
    },
  ) =>
    request<OverallReview>(`/processes/${processId}/overall-review`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // Singular resource — no separate id, same as createOverallReview.
  updateOverallReview: (
    processId: string,
    input: { overallExperience: number; wouldRecommend: boolean; reviewText?: string },
  ) =>
    request<OverallReview>(`/processes/${processId}/overall-review`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteOverallReview: (processId: string) =>
    request<void>(`/processes/${processId}/overall-review`, { method: 'DELETE' }),

  requestMagicLink: (email: string) =>
    request<{ status: string }>('/auth/request-link', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  verifyMagicLink: (token: string) =>
    request<{ status: string }>('/auth/verify', { method: 'POST', body: JSON.stringify({ token }) }),

  // GitHub issue #683 (Phase 48, D104) — password auth, now the primary
  // /login flow; the magic link above moved to a secondary page.
  registerCandidate: (email: string, password: string) =>
    request<{ status: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  candidateLogin: (email: string, password: string) =>
    request<{ status: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  requestPasswordReset: (email: string) =>
    request<{ status: string }>('/auth/request-password-reset', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  confirmPasswordReset: (token: string, newPassword: string) =>
    request<{ status: string }>('/auth/confirm-password-reset', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),

  candidateLogout: () => request<{ status: string }>('/auth/logout', { method: 'POST' }),

  getCandidateSession: () => request<CandidateSession>('/auth/me'),

  // A plain (non-httpOnly) cookie the api sets/clears alongside the real
  // session — lets every page (NavBar renders on all of them, for every
  // anonymous visitor too) know "is there a session?" synchronously,
  // without a network round trip that would 401 on the platform's single
  // most common page view and show up as a console error for it.
  hasCandidateSessionHint: () =>
    typeof document !== 'undefined' && document.cookie.includes('candidate_logged_in=1'),

  getMySubmissions: () => request<MyProcessSubmissions[]>('/me/submissions'),

  // GitHub issue #151 (GDPR erasure) — permanently deletes the candidate's
  // account and everything they submitted. The server also clears both
  // session cookies, but a hard navigation (not router.push) is still
  // needed afterward for NavBar to remount and reflect the logged-out
  // state (D32's same reasoning as the post-verify redirect).
  deleteAccount: () => request<void>('/me', { method: 'DELETE' }),

  adminLogin: (username: string, password: string) =>
    request<{ status: string }>('/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  adminLogout: () => request<{ status: string }>('/auth/admin/logout', { method: 'POST' }),

  getAdminSession: () => request<AdminSession>('/auth/admin/me'),

  // GitHub issue #522/#523 (Phase 41) — filters are all optional and
  // combinable (e.g. claimState=unclaimed + status=flagged together);
  // status can carry more than one value, sent as a repeated querystring
  // param the same way the backend's own DTO already parses it. No
  // params at all hits the bare path, same request the queue always made
  // before these filters existed.
  listModerationQueue: (filters: ModerationQueueFilters = {}) => {
    const query = new URLSearchParams();
    if (filters.entityType) query.set('entityType', filters.entityType);
    if (filters.companyId) query.set('companyId', filters.companyId);
    if (filters.claimState) query.set('claimState', filters.claimState);
    for (const status of filters.status ?? []) query.append('status', status);
    const qs = query.toString();
    return request<ModerationQueueGroup[]>(`/moderation/queue${qs ? `?${qs}` : ''}`);
  },

  // GitHub issue #371 (Phase 35) — a flat list (not grouped by
  // submission, unlike listModerationQueue), in the backend's own
  // OpenSearch-relevance order.
  searchModerationQueue: (q: string, category: ModerationQueueCategory | '') => {
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    if (category) query.set('category', category);
    return request<ModerationQueueEntry[]>(`/moderation/search?${query.toString()}`);
  },

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

  claimModerationEntry: (id: string) =>
    request<ModerationQueueEntry>(`/moderation/queue/${id}/claim`, { method: 'POST' }),

  releaseModerationEntry: (id: string) =>
    request<ModerationQueueEntry>(`/moderation/queue/${id}/release`, { method: 'POST' }),

  getCompanyBySlug: (slug: string) =>
    request<Company>(`/companies/by-slug/${encodeURIComponent(slug)}`),

  listCompanyReviews: (companyId: string, page: number, pageSize: number) =>
    request<CompanyReviewsPage>(
      `/companies/${companyId}/reviews?page=${page}&pageSize=${pageSize}`,
    ),

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

  getRoundTypeFieldOptions: () => request<RoundTypeFieldOptions>('/round-types/field-options'),

  listRoundTypeFieldOptionsAdmin: (roundType: Round['roundType']) =>
    request<RoundTypeFieldOptionRow[]>(`/admin/round-types/${roundType}/field-options`),

  createRoundTypeFieldOption: (
    roundType: Round['roundType'],
    input: { fieldKey: string; value: string; sortOrder?: number },
  ) =>
    request<RoundTypeFieldOptionRow>(`/admin/round-types/${roundType}/field-options`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateRoundTypeFieldOption: (
    id: string,
    input: { value?: string; sortOrder?: number; isActive?: boolean },
  ) =>
    request<RoundTypeFieldOptionRow>(`/admin/round-types/field-options/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  createBulkProcess: (companyId: string, input: CreateBulkProcessInput) =>
    request<InterviewProcess>(`/companies/${companyId}/processes/bulk`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // GitHub issue #589 (Phase 42, D99) — self-service password change,
  // available to every role (no permission gate on the backend either:
  // it only ever acts on the caller's own session).
  changeAdminPassword: (currentPassword: string, newPassword: string) =>
    request<{ status: string }>('/auth/admin/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  // Staff account management (GitHub issue #589, Phase 42, D99) —
  // admin:staff:manage only; every call here 403s for a moderator/staff
  // session, same as the backend guard.
  listStaffAccounts: () => request<StaffAccount[]>('/admin/staff'),

  createStaffAccount: (input: { username: string; email: string; role: StaffRole }) =>
    request<StaffAccountCreated>('/admin/staff', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateStaffRole: (id: string, role: StaffRole) =>
    request<StaffAccount>(`/admin/staff/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  deactivateStaffAccount: (id: string) =>
    request<StaffAccount>(`/admin/staff/${id}/deactivate`, { method: 'POST' }),

  reactivateStaffAccount: (id: string) =>
    request<StaffAccount>(`/admin/staff/${id}/reactivate`, { method: 'POST' }),

  resetStaffPassword: (id: string) =>
    request<{ password: string }>(`/admin/staff/${id}/reset-password`, { method: 'POST' }),
};

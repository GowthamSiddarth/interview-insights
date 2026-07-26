import Link from 'next/link';
import { CompanySearchResult } from '@/lib/api';
import { Button } from '@/components/Button';

const linkClass =
  'text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300';

interface CompanyResultRowProps {
  company: CompanySearchResult;
  onBrowseReviews: (company: CompanySearchResult) => void;
}

// The one shape a company is ever listed in — search results and the
// quick-select grid both render this (GitHub issue #357, Phase 34), so
// the two lists can't drift out of sync the way they used to (one was a
// clickable name button, the other a plain name-only button, with only
// the search-result row offering "View profile" at all).
export function CompanyResultRow({ company, onBrowseReviews }: CompanyResultRowProps) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-300 px-3 py-1 text-sm transition-colors dark:border-gray-600">
      <span>
        {company.name} <span className="text-gray-500">({company.sizeBucket})</span>
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <Button type="button" variant="neutral" onClick={() => onBrowseReviews(company)}>
          Browse reviews
        </Button>
        <Link href={`/companies/${company.slug}`} className={linkClass}>
          View profile
        </Link>
        <Link
          href={`/write-review?companyId=${company.id}&companySlug=${company.slug}&companyName=${encodeURIComponent(company.name)}`}
          className={linkClass}
        >
          Write a review
        </Link>
      </span>
    </li>
  );
}

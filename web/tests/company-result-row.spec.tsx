import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CompanyResultRow } from '../src/components/CompanyResultRow';

const company = {
  id: 'company-1',
  name: 'Acme Corp',
  slug: 'acme-corp',
  industry: null,
  sizeBucket: 'mid' as const,
};

// GitHub issue #357 (Phase 34) — the one row shape every company list
// (search results, quick-select) renders, so they can't drift apart.
// GitHub issue #423 (Phase 38) — "Browse reviews" dropped; browsing a
// company's reviews now lives on its profile page.
describe('CompanyResultRow', () => {
  it('shows the company name as plain text, with only View profile / Write a review links', () => {
    render(
      <ul>
        <CompanyResultRow company={company} />
      </ul>,
    );

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Acme Corp/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Browse reviews' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute(
      'href',
      '/companies/acme-corp',
    );
    expect(screen.getByRole('link', { name: 'Write a review' })).toHaveAttribute(
      'href',
      '/write-review?companyId=company-1&companySlug=acme-corp&companyName=Acme%20Corp',
    );
  });
});

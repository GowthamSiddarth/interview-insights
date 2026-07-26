import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
describe('CompanyResultRow', () => {
  it('shows the company name as plain text, with a Browse reviews button and View profile / Write a review links', () => {
    const onBrowseReviews = jest.fn();
    render(
      <ul>
        <CompanyResultRow company={company} onBrowseReviews={onBrowseReviews} />
      </ul>,
    );

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Acme Corp/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute(
      'href',
      '/companies/acme-corp',
    );
    expect(screen.getByRole('link', { name: 'Write a review' })).toHaveAttribute(
      'href',
      '/write-review?companyId=company-1&companySlug=acme-corp&companyName=Acme%20Corp',
    );
  });

  it('calls onBrowseReviews with the company when clicked', async () => {
    const onBrowseReviews = jest.fn();
    const user = userEvent.setup();
    render(
      <ul>
        <CompanyResultRow company={company} onBrowseReviews={onBrowseReviews} />
      </ul>,
    );

    await user.click(screen.getByRole('button', { name: 'Browse reviews' }));

    expect(onBrowseReviews).toHaveBeenCalledWith(company);
  });
});

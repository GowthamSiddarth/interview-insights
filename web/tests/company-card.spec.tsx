import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CompanyCard } from '../src/components/CompanyCard';
import { Company } from '../src/lib/api';

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'company-1',
    name: 'Acme Corp',
    slug: 'acme-corp',
    industry: null,
    sizeBucket: 'mid',
    logoUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('CompanyCard', () => {
  it('links to the company profile with an accessible name of just the company name', () => {
    render(<CompanyCard company={makeCompany()} />);
    const link = screen.getByRole('link', { name: 'Acme Corp' });
    expect(link).toHaveAttribute('href', '/companies/acme-corp');
  });

  it('shows the industry when set', () => {
    render(<CompanyCard company={makeCompany({ industry: 'Fintech' })} />);
    expect(screen.getByText('Fintech')).toBeInTheDocument();
  });

  it('falls back to a capitalized size bucket when industry is null', () => {
    render(<CompanyCard company={makeCompany({ industry: null, sizeBucket: 'enterprise' })} />);
    expect(screen.getByText('Enterprise')).toBeInTheDocument();
  });

  it('shows a colored-initial avatar when there is no logoUrl', () => {
    render(<CompanyCard company={makeCompany({ name: 'Zephyr Labs', logoUrl: null })} />);
    expect(screen.getByText('Z')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders the real logo when logoUrl is set', () => {
    render(<CompanyCard company={makeCompany({ logoUrl: 'https://example.com/logo.png' })} />);
    // alt="" is deliberate (the link's own aria-label already names the
    // destination) — query by src instead of role, since an empty-alt
    // img is excluded from the accessible tree by design.
    const img = document.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://example.com/logo.png');
  });
});

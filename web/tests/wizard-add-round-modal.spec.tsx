import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import HomePage from '../src/app/page';

const fieldOptionsResponse = {
  coding: { fields: [] },
  system_design: { fields: [] },
  behavioral: { fields: [] },
  leadership: { fields: [] },
  case_study: { fields: [] },
  assessment: { fields: [] },
  take_home: { fields: [] },
  other: { fields: [] },
};

function mockFetchByRoute() {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const respond = (body: unknown) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

    if (url.endsWith('/companies')) {
      return respond([{ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp', sizeBucket: 'mid' }]);
    }
    if (url.endsWith('/round-types/field-options')) {
      return respond(fieldOptionsResponse);
    }
    throw new Error(`Unmocked fetch: ${url}`);
  }) as jest.Mock;
}

describe('Next-button add-round modal (GitHub issue #306)', () => {
  beforeEach(() => {
    mockFetchByRoute();
    document.cookie = 'candidate_logged_in=1';
    window.localStorage.clear();
  });

  async function openDraft(user: ReturnType<typeof userEvent.setup>) {
    render(<HomePage />);
    await user.click(await screen.findByRole('button', { name: 'Acme Corp' }));
    await screen.findByRole('heading', { name: 'Acme Corp' });
    await user.type(await screen.findByLabelText('Role title'), 'Backend Engineer');
  }

  it('opens the modal from Process Details when no round exists yet, and "Add round" creates one', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add another round' });

    await user.click(within(dialog).getByRole('button', { name: 'Add round' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Coding round' })).toBeInTheDocument();
  });

  it('"Finish draft & go to review" jumps straight to the review screen', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('dialog', { name: 'Add another round' });
    await user.click(screen.getByRole('button', { name: 'Finish draft & go to review' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('Review your submission')).toBeInTheDocument();
  });

  it('opens again from the last round after adding a second one, independent of the first', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    let dialog = await screen.findByRole('dialog', { name: 'Add another round' });
    await user.click(within(dialog).getByRole('button', { name: 'Add round' }));
    await user.type(await screen.findByLabelText(/Title/), 'Round A');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    dialog = await screen.findByRole('dialog', { name: 'Add another round' });
    await user.click(within(dialog).getByRole('button', { name: 'Add round' }));
    await user.type(await screen.findByLabelText(/Title/), 'Round B');

    // Now on the second (last) round — Next should offer the modal again.
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('dialog', { name: 'Add another round' })).toBeInTheDocument();
  });

  it('blocks Next entirely (no modal, no navigation) while the current round rating is out of range', async () => {
    const user = userEvent.setup();
    await openDraft(user);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add another round' });
    await user.click(within(dialog).getByRole('button', { name: 'Add round' }));

    const difficultyInput = screen.getAllByRole('spinbutton')[0];
    await user.clear(difficultyInput);
    await user.type(difficultyInput, '9');

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      await screen.findByText(/rating fields must all be between 1 and 5/),
    ).toBeInTheDocument();
    // Still on the round form, not navigated anywhere.
    expect(screen.getByRole('heading', { name: 'Coding round' })).toBeInTheDocument();
  });
});

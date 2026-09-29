import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getPreviewReadiness } from '../integration/preview';
import type { HostedProvingState } from '../providers/midnight-providers';
import { ActivityView } from '../views/ActivityView';
import type { Poll, VoteReceipt } from '../views/poll-model';
import { VoteFlow, type VoteFlowProps } from '../views/VoteFlow';

vi.mock('@/views/app-runtime', async (original) => ({
  ...(await original<typeof import('../views/app-runtime')>()),
  CHAIN_RUNTIME_ENABLED: true,
}));
vi.mock('@/components/wallet-widget', () => ({
  WalletWidget: () => <div data-testid="wallet-widget" />,
}));
vi.mock('@/views/ResultsPanel', () => ({
  ResultsPanel: () => <div data-testid="results-panel" />,
}));

const SWISS = 'ch-2026-11-29-ahv';

function poll(overrides: Partial<Poll> = {}): Poll {
  return {
    id: SWISS,
    title: '13th AHV pension: how to pay for it',
    description: 'Open pulse on the federal vote of 29 November 2026.',
    question: 'Should the 13th AHV pension be financed through a higher VAT?',
    deadline: '27 November 2026',
    opened: '5 October 2026',
    opensAt: '2026-10-05T08:00:00.000Z',
    closesAt: '2099-11-27T17:00:00.000Z',
    eligible: 'Any verified adult',
    participation: '',
    whyNow: '',
    legalFrame: '',
    evidence: '',
    evidenceLabel: '',
    argumentsFor: [],
    argumentsAgainst: [],
    uncertainty: '',
    sources: [],
    ...overrides,
  };
}

function hosted(overrides: Partial<HostedProvingState> = {}): HostedProvingState {
  return {
    offered: true,
    accepted: false,
    preparing: false,
    error: null,
    accept: vi.fn(),
    withdraw: vi.fn(),
    ...overrides,
  };
}

function flowProps(overrides: Partial<VoteFlowProps> = {}): VoteFlowProps {
  return {
    poll: poll(),
    stage: 'review',
    choice: 'YES',
    onChoice: vi.fn(),
    onStage: vi.fn(),
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    onViewReceipt: vi.fn(),
    walletStatus: 'disconnected',
    executionMode: 'direct-wallet',
    onExecutionModeChange: vi.fn(),
    sponsoredAvailable: false,
    previewError: null,
    receipt: null,
    locale: 'en',
    ...overrides,
  };
}

describe('sealing an answer without a wallet', () => {
  it('shows what the proving server sees before anything can be confirmed', () => {
    const hostedProving = hosted();
    const props = flowProps({ hostedProving });
    render(<VoteFlow {...props} />);

    expect(screen.getByText('This device cannot build the proof on its own')).toBeTruthy();
    expect(screen.getByText(/can see your answer and your pass secret/u)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm real action' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'I understand, continue' }));
    expect(hostedProving.accept).toHaveBeenCalledOnce();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('keeps confirm disabled until the proving server is connected', () => {
    const props = flowProps({ hostedProving: hosted({ accepted: true, preparing: true }) });
    render(<VoteFlow {...props} />);

    const waiting = screen.getByRole('button', { name: 'Connecting to the proving server…' });
    expect((waiting as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(waiting);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('confirms once accepted and connected, and still names the proving server', () => {
    const hostedProving = hosted({ accepted: true });
    const props = flowProps({
      hostedProving,
      executionMode: 'sponsored-hosted-proving',
      provingParty: 'hosted-server',
    });
    render(<VoteFlow {...props} />);

    expect(
      screen.getByText('our proving server, which sees your answer while it works'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm real action' }));
    expect(props.onConfirm).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Stop using the proving server' }));
    expect(hostedProving.withdraw).toHaveBeenCalledOnce();
  });

  it('says so when the proving server cannot be reached', () => {
    render(
      <VoteFlow
        {...flowProps({ hostedProving: hosted({ accepted: true, error: 'fetch failed' }) })}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain(
      'The proving server is not reachable right now.',
    );
    expect(
      (screen.getByRole('button', { name: 'Confirm real action' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('does not offer the proving server when a wallet is connected', () => {
    render(
      <VoteFlow
        {...flowProps({ hostedProving: hosted({ offered: false }), walletStatus: 'connected' })}
      />,
    );

    expect(screen.queryByText('This device cannot build the proof on its own')).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirm real action' })).toBeTruthy();
    expect(screen.getByText('Lace proves, adds DUST, and submits the transaction.')).toBeTruthy();
  });

  it('labels the third option as undecided, not as an abstention', () => {
    render(<VoteFlow {...flowProps({ stage: 'choose', choice: null })} />);

    expect(screen.getByText('Undecided')).toBeTruthy();
    expect(screen.queryByText('Abstain')).toBeNull();
  });
});

describe('the receipt of a sealed answer', () => {
  const receipt: VoteReceipt = {
    id: `sealed:${SWISS}`,
    pollId: SWISS,
    createdAt: '2026-10-06T10:00:00.000Z',
    status: 'confirmed',
    network: 'preview',
    sealed: { provingParty: 'hosted-server' },
  };

  it('says when to come back and shows no identifier or explorer link', () => {
    const { container } = render(<VoteFlow {...flowProps({ stage: 'receipt', receipt })} />);

    expect(screen.getByRole('heading', { name: 'Your answer is sealed' })).toBeTruthy();
    expect(screen.getByText(/It is counted when you return on this device after/u)).toBeTruthy();
    expect(
      screen.getByText(
        'When it is counted, the answer itself becomes public. Your identity does not.',
      ),
    ).toBeTruthy();
    expect(container.textContent).not.toContain(receipt.id);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('code')).toBeNull();
  });
});

describe('sealed answers in the activity view', () => {
  const closedPoll = poll({
    closesAt: '2026-01-10T17:00:00.000Z',
    opensAt: '2026-01-01T08:00:00Z',
  });

  it('tells the person to return while the consultation is open', () => {
    const onCount = vi.fn();
    render(
      <ActivityView
        polls={[poll()]}
        receipts={[]}
        sealedAnswers={[{ referendumId: SWISS, state: 'sealed' }]}
        onCount={onCount}
        locale="en"
      />,
    );

    expect(screen.getByText('13th AHV pension: how to pay for it')).toBeTruthy();
    expect(
      screen.getByText(/Come back on this device after it closes so your answer is counted\./u),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Count my answer' })).toBeNull();
    expect(screen.queryByText('No activity yet')).toBeNull();
  });

  it('counts a sealed answer once the consultation has closed', () => {
    const onCount = vi.fn();
    render(
      <ActivityView
        polls={[closedPoll]}
        receipts={[]}
        sealedAnswers={[{ referendumId: SWISS, state: 'sealed' }]}
        onCount={onCount}
        locale="en"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Count my answer' }));
    expect(onCount).toHaveBeenCalledExactlyOnceWith(SWISS);
  });

  it('asks before using the proving server to count', () => {
    const onCount = vi.fn();
    const hostedProving = hosted();
    render(
      <ActivityView
        polls={[closedPoll]}
        receipts={[]}
        sealedAnswers={[{ referendumId: SWISS, state: 'sealed' }]}
        onCount={onCount}
        hostedProving={hostedProving}
        locale="en"
      />,
    );

    expect(
      (screen.getByRole('button', { name: 'Count my answer' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'I understand, continue' }));
    expect(hostedProving.accept).toHaveBeenCalledOnce();
    expect(onCount).not.toHaveBeenCalled();
  });

  it('reports progress and the reason a count has to wait', () => {
    const { rerender } = render(
      <ActivityView
        polls={[closedPoll]}
        receipts={[]}
        sealedAnswers={[{ referendumId: SWISS, state: 'sealed' }]}
        countingId={SWISS}
        onCount={vi.fn()}
        locale="en"
      />,
    );
    expect((screen.getByRole('button', { name: 'Counting…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    rerender(
      <ActivityView
        polls={[closedPoll]}
        receipts={[]}
        sealedAnswers={[{ referendumId: SWISS, state: 'sealed' }]}
        countNotices={{ [SWISS]: 'count-not-open' }}
        onCount={vi.fn()}
        locale="en"
      />,
    );
    expect(screen.getByText('The count has not opened yet. Try again later.')).toBeTruthy();
  });

  it('states plainly when an answer was counted or can no longer be', () => {
    render(
      <ActivityView
        polls={[closedPoll, poll({ id: 'fr-2026', title: 'French consultation' })]}
        receipts={[]}
        sealedAnswers={[
          { referendumId: SWISS, state: 'counted' },
          { referendumId: 'fr-2026', state: 'missed', reason: 'opening-lost' },
        ]}
        onCount={vi.fn()}
        locale="en"
      />,
    );

    expect(screen.getByText(/The sealed copy was deleted from this device\./u)).toBeTruthy();
    expect(
      screen.getByText(/This device no longer holds the sealed answer, so it cannot be counted\./u),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Count my answer' })).toBeNull();
  });
});

describe('readiness without a wallet', () => {
  const base = {
    appMode: 'preview' as const,
    contractAddress: 'mn_contract_test',
    walletConnected: false,
    providersReady: false,
    providersError: null,
    credentialVerified: true,
    v2RuntimeConfigured: true,
  };

  it('asks for the disclosure instead of asking for a wallet', () => {
    const readiness = getPreviewReadiness({ ...base, hostedProving: 'needs-consent' });
    expect(readiness.state).toBe('blocked');
    expect(readiness.label).toBe('Preview necesita tu acuerdo');
  });

  it('follows the proving server from connecting to ready', () => {
    expect(
      getPreviewReadiness({ ...base, relayerMode: true, hostedProving: 'preparing' }).state,
    ).toBe('loading');
    expect(getPreviewReadiness({ ...base, hostedProving: 'failed' }).state).toBe('blocked');
    expect(
      getPreviewReadiness({
        ...base,
        providersReady: true,
        relayerMode: true,
        hostedProving: 'ready',
      }).state,
    ).toBe('ready');
  });

  it('still asks for a wallet when no proving server is offered', () => {
    expect(getPreviewReadiness({ ...base, hostedProving: 'not-offered' }).label).toBe(
      'Preview requiere wallet',
    );
  });
});

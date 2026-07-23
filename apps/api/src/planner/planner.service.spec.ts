import { blockCandidateKey } from './planner.service';

describe('blockCandidateKey', () => {
  it('maps a planned block back to the candidate it consumed', () => {
    expect(
      blockCandidateKey({
        sourceKind: 'application_followup',
        sourceRef: { applicationId: 'app-1' },
        carriedFromBlockId: null,
      }),
    ).toBe('application_followup:app-1');

    expect(
      blockCandidateKey({
        sourceKind: 'interview_topic',
        sourceRef: { interviewPlanId: 'plan-1', topicKey: 'event-loop' },
        carriedFromBlockId: null,
      }),
    ).toBe('interview_topic:event-loop');

    expect(
      blockCandidateKey({
        sourceKind: 'vacancy_apply',
        sourceRef: { vacancyId: 'vac-1' },
        carriedFromBlockId: null,
      }),
    ).toBe('vacancy_apply:vac-1');
  });

  it('prefers the debt backlink, so a carried block is not offered again', () => {
    expect(
      blockCandidateKey({
        sourceKind: 'application_followup',
        sourceRef: { applicationId: 'app-1' },
        carriedFromBlockId: 'block-9',
      }),
    ).toBe('debt:block-9');
  });

  it('has no key for a hand-typed block', () => {
    expect(
      blockCandidateKey({ sourceKind: 'manual', sourceRef: null, carriedFromBlockId: null }),
    ).toBeNull();
    // A source kind without the ref it needs is not a match either.
    expect(
      blockCandidateKey({ sourceKind: 'vacancy_apply', sourceRef: {}, carriedFromBlockId: null }),
    ).toBeNull();
  });
});

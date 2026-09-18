export const ANALYSIS_V3_CONTRACTS = Object.freeze({
  analysisPack: 'kentaurai-analysis-pack-v3',
  step1Lock: 'kentaurai-step1-lock-v1',
  marketPack: 'kentaurai-market-pack-v3',
  step2Result: 'kentaurai-step2-result-v1',
  optimizer: 'kentaurai-optimizer-v1',
  systemPolicy: 'kentaurai-system-policy-v1',
  analysisPersistence: 'kentaurai-analysis-v3'
});

export const ANALYSIS_V3_TARGET_POLICY = Object.freeze({
  status: 'active_default',
  supportedGameTypes: Object.freeze(['V85', 'V86']),
  exactSpikeCount: 3,
  defaultMainBudgetSek: Object.freeze({ min: 150, max: 250 }),
  alternativesRequired: false,
  optimizerProbabilityField: 'decision_probability',
  missingOptionalEvidenceIsNeutral: true,
  legacyReadCompatible: true
});

export const ANALYSIS_V3_LEGACY_BOUNDARY = Object.freeze({
  status: 'read_only_after_v3_cutover',
  currentInputContract: 'kentaurai-analysis-input-v2',
  currentSubmissionContract: 'kentaurai-analysis-v2',
  existingTwoSpikeV85MainReadable: true,
  newLegacyCreationEnabled: false,
  rollbackMode: 'legacy_v2',
  rewriteHistoricalSystems: false,
  v3WritersMayCreateTwoSpikeSystems: false
});

export function analysisV3ContractSnapshot() {
  return {
    contracts: { ...ANALYSIS_V3_CONTRACTS },
    targetPolicy: {
      ...ANALYSIS_V3_TARGET_POLICY,
      supportedGameTypes: [...ANALYSIS_V3_TARGET_POLICY.supportedGameTypes],
      defaultMainBudgetSek: { ...ANALYSIS_V3_TARGET_POLICY.defaultMainBudgetSek }
    },
    legacyBoundary: { ...ANALYSIS_V3_LEGACY_BOUNDARY }
  };
}

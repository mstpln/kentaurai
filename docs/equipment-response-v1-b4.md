# B4 Equipment response v1

B4 adds the market-blind deterministic feature family `equipment_response_v1` for analysis v3.

Contracts:
- bundle `kentaurai-equipment-response-v1`
- state `equipment_state_v1`
- change `equipment_change_v1`

The build is additive and on-demand. It adds no migration, scheduler change, replay or backfill.

Current equipment is selected at the B2 effective cutoff. Only verified known dimensions are used. Missing equipment remains unknown and is never treated as a default configuration. The normalized known state gets a deterministic SHA-256 hash used only for comparison.

Current state and current verified change are separate. V1 change dimensions are front balance, rear balance, sulky type and sulky colour where source-backed change flags exist.

Historical outputs remain separate evidence envelopes: same-state win/top-three/gallop rates, optional same-state X-Labs opening/closing pace, same-change-type top-three/gallop rates, horse-baseline association deltas, and trainer same-change-type context as lower-evidence fallback.

All response values are descriptive associations, not causal effects. Small direct samples are strongly shrunk. Change deltas shrink toward no change. A first-seen state has zero direct same-state history and null direct effect rather than a bonus or penalty.

Trainer fallback excludes the target horse. Betting and odds are never queried. Historical events and all selected observations must be at or before the target cutoff. B4 emits no composite score.

Future Step 1 export must keep three things separate: current equipment/change, historical response, and evidence/sample/confidence. The exported feature bundle must not duplicate the same response signal through a second derived field.

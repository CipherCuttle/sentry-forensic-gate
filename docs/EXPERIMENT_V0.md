# EXPERIMENT_V0

## Comparison

Run BASELINE, PROTOCOL_GATE, and FORENSIC_GATE over the identical launch universe and identical execution model.

## Primary measures

- net mean/median executable return
- catastrophic-loss rate
- unsellable-position rate
- tail loss / CVaR proxy
- fat-tail winner capture
- winner capture ratio

## Kill criteria

Kill or simplify the forensic layer if it does not improve executable outcomes beyond the deterministic protocol/exit gate, loses the advantage under realistic latency, disproportionately rejects extreme winners, only works for previously-seen identities, or cannot reproduce from decision-time receipts.

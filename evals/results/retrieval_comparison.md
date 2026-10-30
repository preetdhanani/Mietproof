# Retrieval backend comparison

Collection: `bgb__mE5-base__v1`

| Backend | Hit-rate @ k=5 | Hits | p95 latency (ms) | Meets gate |
|---|---|---|---|---|
| dense | 83% | 5/6 | 39.2 | no |
| hybrid | 83% | 5/6 | 15.2 | no |
| bm25 | 0% | 0/6 | 0.6 | no |

Decision rule: highest hit-rate k=5; within 5pp -> lower p95; tied -> simpler backend
**Shipped default: (none meets the gate - fallback applies)**

# Retrieval backend comparison

Collection: `bgb__mE5-base__v1`

| Backend | Hit-rate @ k=5 | Hits | p95 latency (ms) | Meets gate |
|---|---|---|---|---|
| dense | 97% | 29/30 | 22.1 | yes |
| hybrid | 93% | 28/30 | 15.1 | yes |
| bm25 | 7% | 2/30 | 0.6 | no |

Decision rule: highest hit-rate k=5; within 5pp -> lower p95; tied -> simpler backend
**Shipped default: hybrid**

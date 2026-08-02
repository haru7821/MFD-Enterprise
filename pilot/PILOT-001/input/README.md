# input/ — what the run was pointed at

Written **before** any stage runs, so the run cannot be described afterwards by whatever it
produced. Nothing here changes once extraction begins; if something must change, the run is
abandoned and a new one started.

| File | Contents | Required |
| --- | --- | --- |
| `run-metadata.json` | Identity of the run — a filled copy of `run-metadata.template.json` | **Yes** |
| `context.md` | Facility, the review objective, who asked for the review, operator | **Yes** |
| `drawing-reference.txt` | Path to the source drawing in the dataset, and its `sha256` | **Yes** |

The drawing itself is **not** copied here. It is the hospital's property, it lives outside this
repository, and `sha256` in `run-metadata.json` identifies which file was used.

## Before proceeding

The `sha256` recorded here must match the entry in `knowledge/dataset.json`. If it does not, the run
is against a different file than the one catalogued and the record would be false — **stop**.

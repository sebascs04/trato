# Approved rehearsal sources

This folder holds the five text selections that the rehearsal coach cites, with their IDs, authors, URLs, locators and original hashes. Shipping them as JSON means a new installation can use them without extracting the PDFs again. Each selection keeps its original attribution.

`manifest.json` lists exactly these five files. The coach reads all five in full through its authorized tool, so its feedback always points to a specific passage.

From the repository root, with the API dependencies installed:

```bash
repos/trato-file-processor/.venv/bin/python scripts/configure-rehearsal-sources.py
repos/trato-file-processor/.venv/bin/python scripts/configure-rehearsal-sources.py --configure
```

The first command verifies the hashes and reads the five sources. The second points the API to this folder with the installation's absolute path; restart the API to load it.

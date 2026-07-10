# Ghost Model Weights

Model weights are tracked via Git LFS.

Run `git lfs pull` after cloning to fetch actual weight files — a normal
clone will only give you LFS pointer files, not the real weights.

## Files
- ghost-intent-classifier.onnx — ONNX intent classifier model
- ghost-intent-classifier.onnx.data — external data file for the ONNX model (weights over the single-file size limit)
- ghost-intent-classifier.pt — PyTorch checkpoint
- label_map.json — label mapping for classifier outputs (not LFS-tracked, plain text)

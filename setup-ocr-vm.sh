#!/usr/bin/env bash
# setup-ocr-vm.sh — one-shot bootstrap for running ocr-pipeline.mjs on a fresh
# Ubuntu box (tested target: Oracle Cloud "Always Free" ARM / Ampere, Ubuntu 22.04+).
#
#   curl -fsSL https://raw.githubusercontent.com/hashin/topperscopy/main/setup-ocr-vm.sh | bash
#   # then:
#   cd ~/topperscopy && tmux new -s ocr
#   node ocr-pipeline.mjs plan
#   node ocr-pipeline.mjs freepass          # Phase 0 — free, ~1–2 hrs
#   node ocr-pipeline.mjs status
#   # detach with Ctrl-b d ; reattach later with: tmux attach -t ocr
set -euo pipefail

echo "== apt packages =="
sudo apt-get update -qq
sudo apt-get install -y -qq git tmux poppler-utils ca-certificates curl

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "== node 20 (nodesource) =="
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs
fi
node -v

echo "== repo =="
cd ~
[ -d topperscopy ] || git clone --depth 1 https://github.com/hashin/topperscopy.git
cd topperscopy
git pull --ff-only || true
npm install --omit=dev --silent   # pdfjs-dist only

echo
echo "ready. next:"
echo "  cd ~/topperscopy && tmux new -s ocr"
echo "  node ocr-pipeline.mjs plan"
echo "  node ocr-pipeline.mjs freepass"
echo "  node ocr-pipeline.mjs status"
echo
echo "when freepass finishes, from your laptop:  git -C topperscopy pull  (to get data/ocr-questions.csv)"
echo "or on the VM:  git add data/ocr-questions.csv && git commit -m 'ocr: text-layer free pass' && git push"

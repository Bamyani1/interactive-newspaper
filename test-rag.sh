#!/bin/bash

echo "=== Test 1: Full RAG Pipeline (Phone Fraud) ==="
curl -s -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "What was the phone fraud controversy?"}' | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    if 'error' in d:
        print(f'ERROR: {d[\"error\"]}')
        sys.exit(1)
    print(f'QUESTION: {d[\"question\"]}')
    print(f'ANSWER: {d[\"answer\"]}')
    print(f'CONFIDENCE: {d[\"confidence\"]}')
    print(f'CITATIONS: {len(d[\"citations\"])}')
    for c in d['citations']:
        print(f'  - [{c[\"articleId\"]}] {c[\"headline\"]}')
    print(f'META: {d[\"meta\"]}')
except Exception as e:
    print(f'JSON Parse Error: {e}')
"

echo ""
echo "=== Test 2: Out of scope (Low Confidence) ==="
curl -s -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the capital of France?"}' | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(f'ANSWER: {d[\"answer\"]}')
    print(f'CONFIDENCE: {d[\"confidence\"]}')
except Exception as e:
    print(f'JSON Parse Error: {e}')
"

echo ""
echo "=== Test 3: Sports Question (Contextual) ==="
curl -s -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "Who won the basketball game against Otterbein?"}' | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(f'ANSWER: {d[\"answer\"]}')
    print(f'CONFIDENCE: {d[\"confidence\"]}')
    print(f'CITATIONS: {len(d[\"citations\"])}')
except Exception as e:
    print(f'JSON Parse Error: {e}')
"

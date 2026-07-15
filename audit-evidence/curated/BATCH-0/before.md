# Before re-review

- Ask deep-link coverage could reach the live streaming endpoint.
- First-paint and diagnostics checks were generic or delayed until the end of
  an exhaustive sweep.
- Generated artifacts used ad hoc directories and transition filenames used
  requested rather than measured capture times.
- The development gallery accepted either 200 or 404 without proving the
  production-only 404 contract.

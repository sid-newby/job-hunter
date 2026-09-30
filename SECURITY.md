# Security and personal data

Job Hunter handles resumes, contact details, career history, and API keys. Take care with your working copy, especially
before sharing a fork, an issue, a pull request, or a screenshot.

## Report a vulnerability privately

Use [GitHub's private vulnerability reporting form](https://github.com/sid-newby/job-hunter/security/advisories/new).
Include the affected commit or version, the likely impact, and steps to reproduce with synthetic data. Keep working
credentials, real resumes, and other people's information out of the report.

Please do not disclose vulnerability details in a public issue or pull request before there has been a chance to
investigate. See [GitHub's reporting guidance](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately)
if you need help using the form.

Security fixes focus on the current `main` branch. This is a personal project without a guaranteed response time or
maintenance schedule. Fork owners are responsible for their own copies and reporting channels.

## Know where your data goes

- `workspace/` holds your profile, uploads, extracted text, notes, generated documents, and `.history/` backups. Deleting
  an upload does not remove information already copied into a profile, generated document, or backup.
- `.env` holds API keys and database settings. PostgreSQL holds job records, scores, and usage records separately from
  the workspace. Treat database exports and logs as potentially sensitive too.
- The app runs locally, but AI processing uses external services. Uploaded text, notes, and career facts can be sent to
  your selected model provider. With OpenRouter, that also involves the provider serving the selected model. Claude Code
  uses Anthropic's service; a local login does not mean the model runs offline.
- Tavily receives search queries and URLs to retrieve. Browser dictation may use your browser vendor's speech service.
  Review the services' privacy settings and terms before supplying confidential material.

Only upload documents you are allowed to use. Remove information about clients, coworkers, or employers that you do not
have permission to send to those services.

## Before sharing a fork or submitting changes

1. Keep `.env` and `workspace/` private. They are ignored by Git by default. Renamed copies such as `dotenv`, alternate
   env files, or a custom `JOB_HUNTER_WORKSPACE` or `JOB_HUNTER_ENV_FILE` path may not be ignored. Keep `.env.example` free
   of real keys and personal settings.
2. Check what Git will actually publish with `git status --short --ignored`, `git diff --cached`, and `git ls-files`.
   Inspect every commit you plan to share. Adding a path to `.gitignore` does not untrack it or erase earlier commits.
3. Use made-up data in examples, fixtures, screenshots, and logs. Look for names, email addresses, phone numbers, local
   file paths, private job-search notes, tokens, and database credentials. Git author names and email addresses are
   also part of the history.
4. Check archives, release attachments, and copied folders separately. Git ignore rules do not sanitize a ZIP file or
   stop someone from copying your workspace or database backup into it.
5. If a credential was exposed, revoke or rotate it promptly. Removing the current file is not enough: history, forks,
   clones, and cached copies may still contain it. Remove exposed personal data from the places you control and use
   the relevant hosting service's removal process when needed.

## Keep it local and review the output

The dashboard and API are intended for one person on their own computer. The API has no application login or access
control. Keep the app and database on local interfaces; do not expose them through a public tunnel, port forwarding,
or a shared server without adding appropriate authentication and access controls.

Use a separate database and workspace for testing. Keep backups before upgrades or experiments, update dependencies,
and watch provider usage and billing. Searches, profile builds, connection tests, and resume generation can consume
credits or subscription usage.

Treat job postings and uploaded documents as untrusted input. AI output can contain errors or fabricated claims even
when validation passes. Check your profile and every resume before using them, and verify employers and listings
independently before sharing information or applying.

## Responsibility

I'm sharing this to help people find a job. It is provided as-is, without a promise of accuracy, security, availability,
or employment results. You are responsible for how you use it, the information you share, the documents you submit,
and any costs you incur. The [MIT License](LICENSE) contains the warranty disclaimer and limitation of liability.

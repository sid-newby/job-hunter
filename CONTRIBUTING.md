# Contributing

I built Job Hunter to help people find a job. If something breaks or could work better, an issue is the best way to help.

## Issues first

Please [open an issue](https://github.com/sid-newby/job-hunter/issues) before spending time on a pull request. Bug reports,
confusing setup steps, documentation corrections, and ideas are all welcome. Check existing issues first.

For a bug report, include:

- What you tried, what you expected, and what happened.
- Your operating system, the app commit or version, and relevant tool versions.
- Steps someone else can follow, using made-up data.
- The relevant error text or a screenshot, with personal information and credentials removed.

For a feature request, explain the problem you want to solve. You do not need to propose an implementation.

Report vulnerabilities privately using [SECURITY.md](SECURITY.md), rather than in a public issue or pull request.

## Pull requests

I prefer issues to unsolicited pull requests. I'll look at pull requests that come in, but I can't promise when I'll
review one or whether I'll merge it. Please discuss substantial changes in an issue first.

If you submit a pull request:

- Keep it focused and link the issue, if there is one.
- Explain what changed and how you checked it. Say which checks you could not run.
- Update the README when setup, commands, settings, or behavior change.
- Use synthetic examples. Keep resumes, personal workspace files, credentials, database dumps, and generated job-search
  artifacts out of the diff and commit history. Follow the sharing checklist in [SECURITY.md](SECURITY.md).

Read [CLAUDE.md](CLAUDE.md) for the code layout and verification guidance. Test with a separate workspace and a throwaway
database. Live model and search commands can spend money; do not run `task scout` or `task tailor` as routine smoke tests.

Only contribute material you have the right to share. Contributions you submit for inclusion are offered under the
project's [MIT License](LICENSE).

This is a personal project. Support and review happen as time allows.

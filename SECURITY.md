# Security policy

## Reporting a vulnerability

Please use [GitHub's private vulnerability reporting](https://github.com/maximilianfeix/gha-preview/security/advisories/new) rather than opening a public issue. Include the affected version, impact, and a reproduction when possible.

## Data handling

Workflow files up to 1 MB are parsed locally in the browser and are not uploaded by the application. A copied share link embeds compressed workflow text in its URL fragment; anyone who receives that link can read the workflow. Do not share files or links containing secrets.

The app loads its typefaces from Google Fonts. No workflow content is sent with those font requests.

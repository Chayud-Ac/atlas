# Security policy

## Reporting a vulnerability

Please **don't** open a public issue. Report it privately through GitHub: go to the **Security** tab, choose **Report a vulnerability**, and you'll get a reply within 7 days.

## Supported versions

Only `main` is supported.

## Design notes

Atlas is designed to hold no secrets. GitHub Actions authenticates to Azure with OIDC federated credentials. Apps authenticate to Azure services with managed identities, and users sign in with Microsoft Entra ID. If you find a credential anywhere in this repository or its CI logs, treat it as a vulnerability and report it.

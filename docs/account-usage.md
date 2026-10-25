# Accounts and usage

Open **账号与额度** from the sidebar. The panel is available with or without an open task. Use **管理账号与连接** to import an account, log in or configure existing connections.

| Source | Available information | Allowance query |
| --- | --- | --- |
| Imported Codex account | Saved credential state, expiry, past inference verification | Manual query of reported usage windows |
| Independent ChatGPT authorization | Saved credential state, expiry/renewal capability | Not supported by the current authorization route |
| Native OpenCode, WorkBuddy, WorkBuddy AI, Doubao | Installation and previously recorded protocol-check state | Not supported; account remains managed by the original Agent |
| API / local service | Connection model and past inference verification | Not supported |

Imported Codex allowance is shown as remaining percentage, duration when reported, reset time and last query time. It is not a remaining token count or monetary balance. Missing information is never rendered as zero. Windows whose reset time has passed remain historical records until refreshed.

Opening the panel does not query providers or invoke models. **刷新额度** explicitly requests the existing allowance endpoint; simultaneous requests for one account are deduplicated. Query failures retain the last successful snapshot and display an error. Saved credentials and a past successful inference do not guarantee current model access.

Tokens are never rendered. Existing local encryption, original-Agent authentication and explicit account import/login flows remain unchanged.
